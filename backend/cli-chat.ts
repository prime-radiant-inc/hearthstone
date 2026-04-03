#!/usr/bin/env npx tsx
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

import Database from "better-sqlite3";
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

const MODES = ["rag", "mrag", "mfrag", "full", "both", "all"] as const;
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
  `).all(Buffer.from(queryEmbedding.buffer), limit) as any[];

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

// --- Query Expansion ---

type Message = { role: "system" | "user" | "assistant"; content: string };

async function expandQuery(query: string, history: Message[]): Promise<string[]> {
  const historyContext = history.length > 0
    ? `\nRecent conversation:\n${history.slice(-4).map(m => `${m.role}: ${m.content}`).join("\n")}\n`
    : "";

  const resp = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [{
      role: "system",
      content: `You expand search queries for a household knowledge base (home info, pet care, childcare, emergency contacts, schedules).

Given the question, generate 3-5 diverse search queries. Think about:
- Synonyms (doctor → pediatrician, physician, medical)
- What section might contain this (emergency contacts, vet info)
- Implicit context (baby's doctor → pediatrician, medical contacts)

Return ONLY a JSON array of strings.`
    }, {
      role: "user",
      content: `${historyContext}Question: "${query}"`
    }],
    temperature: 0.3,
  });

  try {
    const text = resp.choices[0]?.message?.content || "[]";
    const queries = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || "[]") as string[];
    return [query, ...queries];
  } catch {
    return [query];
  }
}

// --- Prompts ---

const CHAT_STYLE = `Response style:
- You're a knowledgeable friend, not a search engine. A babysitter at 10pm needs quick, clear answers.
- Lead with the answer. No preamble, no "According to the document..."
- Bold key details: names, phone numbers, times, addresses.
- Bullet points for lists. Keep it short.
- Do not mention document titles in your answer.
- Do not invent names, numbers, or details. Ever.`;

const HELPFULNESS = `If the documents don't directly answer the question but contain clearly relevant information (emergency contacts, vet numbers, related procedures), share what IS there and briefly note what's not covered. Be helpful, not rigid — a question about a sick pet deserves the vet's number even if there's no "sick pet protocol."

Only say "I don't have that information in the household docs" if the documents contain genuinely nothing relevant.`;

const RAG_SYSTEM = `You are a helpful household assistant. Answer using ONLY the provided excerpts. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

After your answer, on a new line: Sources: [1], [3]

Document excerpts:
`;

const FULL_SYSTEM = `You are a helpful household assistant. Answer using ONLY the provided documents. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

After your answer, on a new line: Sources: "Document Title"

Household documents:
`;

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
    rag: [], mrag: [], mfrag: [], full: [],
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

      // --- mRAG ---
      if (modeArg === "mrag" || modeArg === "all") {
        const expanded = await expandQuery(query, histories.mrag);
        logDim(`┌ mRAG queries: ${expanded.map(q => `"${q}"`).join(", ")}`);

        const seen = new Set<string>();
        const allResults: DocChunk[] = [];
        for (const q of expanded) {
          const results = searchChunks(new Float32Array(await embedText(q)), 3);
          for (const r of results) {
            const key = `${r.documentId}-${r.chunkIndex}`;
            if (!seen.has(key)) { seen.add(key); allResults.push(r); }
          }
        }
        const top = allResults.slice(0, 10);
        const context = top.map((r, i) => `[${i + 1}] (from "${r.documentTitle}")\n${r.text}`).join("\n\n---\n\n");

        histories.mrag.push({ role: "user", content: query });
        const resp = await chatStream([{ role: "system", content: RAG_SYSTEM + context }, ...histories.mrag], "mRAG");
        logDim(`Retrieved ${top.length} chunks from: ${uniqueDocNames(top).join(", ")}`);
        histories.mrag.push({ role: "assistant", content: resp });
      }

      // --- mFRAG: expand → find docs → full doc context ---
      if (modeArg === "mfrag" || modeArg === "all") {
        const expanded = await expandQuery(query, histories.mfrag);
        logDim(`┌ mFRAG queries: ${expanded.map(q => `"${q}"`).join(", ")}`);

        const docHits = new Map<string, number>();
        for (const q of expanded) {
          const results = searchChunks(new Float32Array(await embedText(q)), 3);
          for (const r of results) {
            docHits.set(r.documentId, (docHits.get(r.documentId) || 0) + 1);
          }
        }

        const selectedDocs = [...docHits.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => allDocs.find(d => d.id === id))
          .filter((d): d is Doc => d !== null);

        logDim(`┌ Selected docs: ${selectedDocs.map(d => d.title).join(", ")}`);

        const context = selectedDocs
          .map(d => `--- Document: "${d.title}" ---\n\n${d.markdown}`)
          .join("\n\n" + "=".repeat(40) + "\n\n");

        histories.mfrag.push({ role: "user", content: query });
        const resp = await chatStream([{ role: "system", content: FULL_SYSTEM + context }, ...histories.mfrag], "mFRAG");
        histories.mfrag.push({ role: "assistant", content: resp });
      }

      // --- FULL ---
      if (modeArg === "full" || modeArg === "both" || modeArg === "all") {
        histories.full.push({ role: "user", content: query });
        const resp = await chatStream([{ role: "system", content: FULL_SYSTEM + fullContextDoc }, ...histories.full], "FULL");
        histories.full.push({ role: "assistant", content: resp });
      }

      if (["both", "all"].includes(modeArg)) {
        console.log("\x1b[2m" + "─".repeat(60) + "\x1b[0m");
      }
    } catch (err: any) {
      console.error(`\x1b[1;31mError:\x1b[0m ${err.message}`);
    }

    rl.prompt();
  });
}

main();
