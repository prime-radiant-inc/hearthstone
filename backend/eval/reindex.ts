#!/usr/bin/env npx tsx
/**
 * Re-index all documents with current chunker settings.
 * Deletes existing chunks/embeddings and regenerates them.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chunkMarkdown } from "../src/services/chunker";

// --- Env loading ---
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const dbPath = resolve(import.meta.dirname, "..", "hearthstone.db");
const db = new Database(dbPath);
sqliteVec.load(db);

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return resp.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

function generateId(): string {
  return crypto.randomUUID();
}

async function main() {
  const docs = db.prepare("SELECT id, title, markdown FROM documents ORDER BY title").all() as any[];
  console.log(`Re-indexing ${docs.length} documents...\n`);

  for (const doc of docs) {
    // Delete old chunks and embeddings
    const oldChunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(doc.id) as any[];
    for (const chunk of oldChunks) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
    }
    db.prepare("DELETE FROM chunks WHERE document_id = ?").run(doc.id);

    // Generate new chunks with document title
    const texts = chunkMarkdown(doc.markdown, doc.title);
    console.log(`  ${doc.title}: ${oldChunks.length} chunks → ${texts.length} chunks`);

    if (texts.length === 0) continue;

    // Preview chunk sizes
    for (let i = 0; i < texts.length; i++) {
      console.log(`    chunk ${i}: ${texts[i].length} chars`);
    }

    // Embed and store
    const embeddings = await embedBatch(texts);
    const now = new Date().toISOString();
    const hid = (db.prepare("SELECT id FROM households LIMIT 1").get() as any).id;

    const insertChunk = db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertEmbedding = db.prepare(
      "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)"
    );

    const transaction = db.transaction(() => {
      for (let i = 0; i < texts.length; i++) {
        const chunkId = generateId();
        insertChunk.run(chunkId, doc.id, hid, i, texts[i], now);
        const vec = new Float32Array(embeddings[i]);
        insertEmbedding.run(chunkId, Buffer.from(vec.buffer));
      }
    });
    transaction();

    // Update document
    db.prepare("UPDATE documents SET chunk_count = ?, last_synced = ? WHERE id = ?")
      .run(texts.length, now, doc.id);

    console.log();
  }

  const total = db.prepare("SELECT COUNT(*) as count FROM chunks").get() as any;
  console.log(`Done. Total chunks: ${total.count}`);
  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
