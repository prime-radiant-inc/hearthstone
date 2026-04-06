import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { RAG_SYSTEM, FULL_SYSTEM } from "../src/services/prompt";

// --- Env loading (same approach as cli-chat.ts) ---

const envPath = resolve(import.meta.dirname, "..", ".env");
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
export const CHAT_MODEL = process.env.EVAL_CHAT_MODEL || "gpt-5.4";

// --- Types ---

export type Mode = "rag" | "full";

export interface EvalResult {
  questionId: string;
  mode: Mode;
  response: string;
  retrievedDocs: string[];
  retrievedChunkCount?: number;
  latencyMs: number;
}

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

// --- Database ---

const dbPath = resolve(import.meta.dirname, "..", "hearthstone.db");
const db = new Database(dbPath, { readonly: true });
sqliteVec.load(db);

// --- Data loading ---

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

// --- Prompts ---
// Single source of truth: eval/prompt.txt → src/services/prompt.ts
// (import is at top of file)

// --- Chat (non-streaming) ---

async function chatComplete(systemContent: string, question: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: CHAT_MODEL,
    ...(CHAT_MODEL.startsWith("gpt-5") ? {} : { temperature: 0 }),
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: question },
    ],
  });
  return resp.choices[0]?.message?.content || "";
}

// --- Unique doc names helper ---

function uniqueDocNames(chunks: DocChunk[]): string[] {
  const seen = new Set<string>();
  return chunks.filter(r => {
    if (seen.has(r.documentTitle)) return false;
    seen.add(r.documentTitle);
    return true;
  }).map(r => r.documentTitle);
}

// --- Mode runners ---

const allChunks = loadAllChunks();
const allDocs = loadAllDocs();
const fullContextDoc = allDocs
  .map(d => `--- Document: "${d.title}" ---\n\n${d.markdown}`)
  .join("\n\n" + "=".repeat(40) + "\n\n");

async function runRag(question: string): Promise<EvalResult> {
  const start = Date.now();
  const emb = await embedText(question);
  const results = searchChunks(new Float32Array(emb), 5);
  const context = results.map((r, i) => `[${i + 1}] (from "${r.documentTitle}")\n${r.text}`).join("\n\n---\n\n");
  const response = await chatComplete(RAG_SYSTEM + context, question);
  return {
    questionId: "",
    mode: "rag",
    response,
    retrievedDocs: uniqueDocNames(results),
    retrievedChunkCount: results.length,
    latencyMs: Date.now() - start,
  };
}

async function runFull(question: string): Promise<EvalResult> {
  const start = Date.now();
  const response = await chatComplete(FULL_SYSTEM + fullContextDoc, question);
  return {
    questionId: "",
    mode: "full",
    response,
    retrievedDocs: allDocs.map(d => d.title),
    latencyMs: Date.now() - start,
  };
}

// --- Public API ---

const MODE_RUNNERS: Record<Mode, (q: string) => Promise<EvalResult>> = {
  rag: runRag,
  full: runFull,
};

export async function runQuestion(question: string, mode: Mode, questionId: string): Promise<EvalResult> {
  const result = await MODE_RUNNERS[mode](question);
  result.questionId = questionId;
  return result;
}

export function closeDb() {
  db.close();
}
