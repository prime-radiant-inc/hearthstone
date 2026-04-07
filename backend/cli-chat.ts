#!/usr/bin/env bun
/**
 * Hearthstone CLI Chat — retrieval strategy experiments
 *
 * Usage (from backend/):
 *   bun run chat:rag       # Embed query → top 5 chunks → chat
 *   bun run chat:mrag      # Expand query → search each → union chunks → chat
 *   bun run chat:mfrag     # Expand query → find docs → full doc context → chat
 *   bun run chat:full      # All docs, every time
 *   bun run chat:both      # RAG vs FULL side-by-side
 *   bun run chat:all       # All modes side-by-side
 */

import "./src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import * as readline from "node:readline";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// --- Config ---

const envPath = resolve(import.meta.dirname, ".env");
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
const dbPath = resolve(import.meta.dirname, "hearthstone.db");

// --- Args ---

const MODES = ["rag", "full", "both"] as const;
type Mode = typeof MODES[number];

const args = process.argv.slice(2);
const modeArg = (args.find(a => a.startsWith("--mode="))?.split("=")[1]
  ?? args[args.indexOf("--mode") + 1]
  ?? "both") as Mode;

if (!MODES.includes(modeArg)) {
  console.error(`Usage: bun run chat:[${MODES.join("|")}]`);
  process.exit(1);
}

// --- Database ---

const db = new Database(dbPath, { readonly: true });
sqliteVec.load(db);

// --- Data loading ---

interface DocChunk {
  documentTitle: string;
  documentId: string;
  chunkIndex: number;
  text: string;
}

interface Doc {
  id: string;
  title: string;
  markdown: string;
}

function loadAllChunks(): DocChunk[] {
  return (db.prepare(`
    SELECT c.document_id, c.chunk_index, c.text, d.title as document_title
    FROM chunks c JOIN documents d ON d.id = c.document_id
    ORDER BY d.title, c.chunk_index
  `).all() as any[]).map(r => ({
    documentTitle: r.document_title,
    documentId: r.document_id,
    chunkIndex: r.chunk_index,
    text: r.text,
  }));
}

function loadAllDocs(): Doc[] {
  return db.prepare("SELECT id, title, markdown FROM documents ORDER BY title").all() as any[];
}

// --- Embedding + Search ---

async function embedText(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
  return resp.data[0].embedding;
}

function searchChunks(queryEmbedding: Float32Array, limit: number = 5): DocChunk[] {
  const rows = db.prepare(`
    SELECT ce.chunk_id, ce.distance FROM chunk_embeddings ce
    WHERE ce.embedding MATCH ? AND k = ? ORDER BY ce.distance
  `).all(queryEmbedding, limit) as any[];

  const chunks = loadAllChunks();
  const chunkMap = new Map(chunks.map(c => [`${c.documentId}-${c.chunkIndex}`, c]));

  return rows
    .map(r => {
      const chunk = db.prepare("SELECT document_id, chunk_index FROM chunks WHERE id = ?").get(r.chunk_id) as any;
      if (!chunk) return null;
      return chunkMap.get(`${chunk.document_id}-${chunk.chunk_index}`) ?? null;
    })
    .filter((c): c is DocChunk => c !== null);
}

type Message = { role: "system" | "user" | "assistant"; content: string };

// --- Prompts ---

import { RAG_SYSTEM, FULL_SYSTEM } from "./src/services/prompt";

// --- Streaming chat ---

async function chatStream(messages: Message[], label: string): Promise<string> {
  process.stdout.write(`\n\x1b[1;33m[${label}]\x1b[0m `);
  const stream = await openai.chat.completions.create({ model: "gpt-5.4", messages, stream: true });
  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) { process.stdout.write(delta); full += delta; }
  }
  process.stdout.write("\n");
  return full;
}

function logDim(text: string) {
  console.log(`\x1b[2m  ${text}\x1b[0m`);
}

function uniqueDocNames(chunks: DocChunk[]): string[] {
  const seen = new Set<string>();
  return chunks.filter(r => { if (seen.has(r.documentTitle)) return false; seen.add(r.documentTitle); return true; }).map(r => r.documentTitle);
}

// --- Mode runners ---

function shouldRun(mode: Mode, ...modes: Mode[]): boolean {
  if (mode === "all") return true;
  if (mode === "both" && modes.some(m => m === "rag" || m === "full")) return modes.includes(mode) || modes.includes("rag") || modes.includes("full");
  return modes.includes(mode);
}

// --- Main ---

async function main() {
  const allChunks = loadAllChunks();
  const allDocs = loadAllDocs();

  const totalChunkTokens = allChunks.reduce((sum, c) => sum + Math.ceil(c.text.length / 4), 0);
  const totalDocTokens = allDocs.reduce((sum, d) => sum + Math.ceil(d.markdown.length / 4), 0);

  console.log(`\x1b[1;36mHearthstone CLI Chat\x1b[0m`);
  console.log(`Mode: \x1b[1m${modeArg}\x1b[0m`);
  console.log(`Documents: ${allDocs.length} (${allDocs.map(d => d.title).join(", ")})`);
  console.log(`Chunks: ${allChunks.length} (~${totalChunkTokens.toLocaleString()} tokens)`);
  console.log(`Full corpus: ~${totalDocTokens.toLocaleString()} tokens`);
  console.log(`\nType your questions. /clear to reset. Ctrl+C to exit.\n`);

  const fullContextDoc = allDocs
    .map(d => `--- Document: "${d.title}" ---\n\n${d.markdown}`)
    .join("\n\n" + "=".repeat(40) + "\n\n");

  const histories: Record<string, Message[]> = {
    rag: [], full: [],
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\x1b[1;32m❯ \x1b[0m" });
  rl.prompt();

  rl.on("line", async (line) => {
    const query = line.trim();
    if (!query) { rl.prompt(); return; }
    if (query === "/clear") {
      Object.values(histories).forEach(h => h.length = 0);
      console.log("History cleared.");
      rl.prompt();
      return;
    }

    try {
      // --- RAG ---
      if (modeArg === "rag" || modeArg === "both" || modeArg === "all") {
        const emb = await embedText(query);
        const results = searchChunks(new Float32Array(emb), 5);
        const context = results.map((r, i) => `[${i + 1}] (from "${r.documentTitle}")\n${r.text}`).join("\n\n---\n\n");

        histories.rag.push({ role: "user", content: query });
        const resp = await chatStream([{ role: "system", content: RAG_SYSTEM + context }, ...histories.rag], "RAG");
        logDim(`Retrieved from: ${uniqueDocNames(results).join(", ")}`);
        histories.rag.push({ role: "assistant", content: resp });
      }

      // --- FULL ---
      if (modeArg === "full" || modeArg === "both" || modeArg === "all") {
        histories.full.push({ role: "user", content: query });
        const resp = await chatStream([{ role: "system", content: FULL_SYSTEM + fullContextDoc }, ...histories.full], "FULL");
        histories.full.push({ role: "assistant", content: resp });
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
