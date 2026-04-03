#!/usr/bin/env npx tsx
/**
 * Hearthstone CLI Chat — RAG vs Full Context experiment
 *
 * Usage:
 *   npx tsx cli/chat.ts --mode rag        # RAG: embed query → top 5 chunks → chat
 *   npx tsx cli/chat.ts --mode full       # Full: stuff all docs into context
 *   npx tsx cli/chat.ts --mode both       # Side-by-side comparison (sequential)
 *
 * Reads docs from the backend's SQLite DB directly.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import * as readline from "node:readline";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// --- Config ---

// Load .env from backend
const envPath = resolve(import.meta.dirname, "../backend/.env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in backend/.env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const dbPath = resolve(import.meta.dirname, "../backend/hearthstone.db");

// --- Args ---

const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith("--mode="))?.split("=")[1]
  ?? args[args.indexOf("--mode") + 1]
  ?? "both";

if (!["rag", "full", "both"].includes(modeArg)) {
  console.error("Usage: npx tsx cli/chat.ts --mode [rag|full|both]");
  process.exit(1);
}

// --- Database ---

const db = new Database(dbPath, { readonly: true });
sqliteVec.load(db);

// --- Load all documents and chunks ---

interface DocChunk {
  documentTitle: string;
  documentId: string;
  chunkIndex: number;
  text: string;
}

function loadAllChunks(): DocChunk[] {
  const rows = db.prepare(`
    SELECT c.document_id, c.chunk_index, c.text, d.title as document_title
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    ORDER BY d.title, c.chunk_index
  `).all() as any[];

  return rows.map(r => ({
    documentTitle: r.document_title,
    documentId: r.document_id,
    chunkIndex: r.chunk_index,
    text: r.text,
  }));
}

function loadAllDocMarkdown(): Array<{ title: string; markdown: string }> {
  return db.prepare("SELECT title, markdown FROM documents ORDER BY title").all() as any[];
}

// --- Embedding + Search ---

async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

function searchChunks(queryEmbedding: Float32Array, limit: number = 5): DocChunk[] {
  const rows = db.prepare(`
    SELECT ce.chunk_id, ce.distance
    FROM chunk_embeddings ce
    WHERE ce.embedding MATCH ?
    AND k = ?
    ORDER BY ce.distance
  `).all(Buffer.from(queryEmbedding.buffer), limit) as any[];

  const chunks = loadAllChunks();
  const chunkMap = new Map(chunks.map(c => [`${c.documentId}-${c.chunkIndex}`, c]));

  return rows.map(r => {
    const chunk = db.prepare("SELECT document_id, chunk_index FROM chunks WHERE id = ?").get(r.chunk_id) as any;
    const key = `${chunk.document_id}-${chunk.chunk_index}`;
    return chunkMap.get(key)!;
  }).filter(Boolean);
}

// --- Chat ---

const RAG_SYSTEM = `You are a helpful household assistant. Answer questions using ONLY the provided document excerpts below. If the answer is not present in the excerpts, say exactly: "I don't have that information in the household docs." Do not make up information.

After your answer, on a new line, list which sources you used: Sources: [1], [3]

Document excerpts:
`;

const FULL_SYSTEM = `You are a helpful household assistant. Answer questions using ONLY the provided household documents below. If the answer is not present in the documents, say exactly: "I don't have that information in the household docs." Do not make up information.

When you reference information, mention which document it came from.

Household documents:
`;

type Message = { role: "system" | "user" | "assistant"; content: string };

async function chatStream(messages: Message[], label: string): Promise<string> {
  process.stdout.write(`\n\x1b[1;33m[${label}]\x1b[0m `);

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      process.stdout.write(delta);
      full += delta;
    }
  }
  process.stdout.write("\n");
  return full;
}

// --- Main ---

async function main() {
  const allChunks = loadAllChunks();
  const allDocs = loadAllDocMarkdown();

  const totalChunkTokens = allChunks.reduce((sum, c) => sum + Math.ceil(c.text.length / 4), 0);
  const totalDocTokens = allDocs.reduce((sum, d) => sum + Math.ceil(d.markdown.length / 4), 0);

  console.log(`\x1b[1;36mHearthstone CLI Chat\x1b[0m`);
  console.log(`Mode: \x1b[1m${modeArg}\x1b[0m`);
  console.log(`Documents: ${allDocs.length} (${allDocs.map(d => d.title).join(", ")})`);
  console.log(`Chunks: ${allChunks.length} (~${totalChunkTokens.toLocaleString()} tokens)`);
  console.log(`Full doc corpus: ~${totalDocTokens.toLocaleString()} tokens`);
  console.log(`\nType your questions. Ctrl+C to exit.\n`);

  // Build full-context system message once
  const fullContextDoc = allDocs
    .map(d => `--- Document: "${d.title}" ---\n\n${d.markdown}`)
    .join("\n\n" + "=".repeat(60) + "\n\n");

  const ragHistory: Message[] = [];
  const fullHistory: Message[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[1;32m❯ \x1b[0m",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const query = line.trim();
    if (!query) { rl.prompt(); return; }

    if (query === "/clear") {
      ragHistory.length = 0;
      fullHistory.length = 0;
      console.log("History cleared.");
      rl.prompt();
      return;
    }

    if (query === "/chunks") {
      console.log(`\n${allChunks.length} chunks across ${allDocs.length} documents:`);
      allChunks.forEach(c => {
        const preview = c.text.slice(0, 80).replace(/\n/g, " ");
        console.log(`  [${c.documentTitle}#${c.chunkIndex}] ${preview}...`);
      });
      console.log();
      rl.prompt();
      return;
    }

    try {
      // --- RAG mode ---
      if (modeArg === "rag" || modeArg === "both") {
        const queryEmb = await embedText(query);
        const results = searchChunks(new Float32Array(queryEmb), 5);

        const context = results
          .map((r, i) => `[${i + 1}] (from "${r.documentTitle}")\n${r.text}`)
          .join("\n\n---\n\n");

        ragHistory.push({ role: "user", content: query });

        const ragMessages: Message[] = [
          { role: "system", content: RAG_SYSTEM + context },
          ...ragHistory,
        ];

        const ragResponse = await chatStream(ragMessages, "RAG");

        // Show which chunks were retrieved
        const seen = new Set<string>();
        const uniqueDocs = results.filter(r => {
          if (seen.has(r.documentTitle)) return false;
          seen.add(r.documentTitle);
          return true;
        });
        console.log(`\x1b[2m  Retrieved from: ${uniqueDocs.map(d => d.documentTitle).join(", ")}\x1b[0m`);

        ragHistory.push({ role: "assistant", content: ragResponse });
      }

      // --- Full context mode ---
      if (modeArg === "full" || modeArg === "both") {
        fullHistory.push({ role: "user", content: query });

        const fullMessages: Message[] = [
          { role: "system", content: FULL_SYSTEM + fullContextDoc },
          ...fullHistory,
        ];

        const fullResponse = await chatStream(fullMessages, "FULL");
        fullHistory.push({ role: "assistant", content: fullResponse });
      }

      if (modeArg === "both") {
        console.log("\x1b[2m" + "─".repeat(60) + "\x1b[0m");
      }
    } catch (err: any) {
      console.error(`\x1b[1;31mError:\x1b[0m ${err.message}`);
    }

    rl.prompt();
  });
}

main();
