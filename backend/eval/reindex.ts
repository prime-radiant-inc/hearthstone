#!/usr/bin/env bun
/**
 * Re-index all documents with current chunker settings.
 * Deletes existing chunks/embeddings and regenerates them.
 */

import "../src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chunkMarkdown, buildEmbeddingText } from "../src/services/chunker";

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
  // Ensure heading column exists
  const columns = db.prepare("PRAGMA table_info(chunks)").all() as any[];
  if (!columns.some((c: any) => c.name === "heading")) {
    db.exec("ALTER TABLE chunks ADD COLUMN heading TEXT NOT NULL DEFAULT ''");
  }

  const docs = db.prepare("SELECT id, title, markdown FROM documents ORDER BY title").all() as any[];
  console.log(`Re-indexing ${docs.length} documents...\n`);

  for (const doc of docs) {
    // Delete old chunks and embeddings
    const oldChunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(doc.id) as any[];
    for (const chunk of oldChunks) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
    }
    db.prepare("DELETE FROM chunks WHERE document_id = ?").run(doc.id);

    // Generate new chunks
    const chunks = chunkMarkdown(doc.markdown);
    console.log(`  ${doc.title}: ${oldChunks.length} chunks → ${chunks.length} chunks`);

    if (chunks.length === 0) continue;

    // Build embedding texts and preview chunk sizes
    const embeddingTexts = chunks.map(c => buildEmbeddingText(c, doc.title));
    for (let i = 0; i < chunks.length; i++) {
      console.log(`    chunk ${i}: ${chunks[i].text.length} chars (heading: "${chunks[i].heading}")`);
    }

    // Embed and store
    const embeddings = await embedBatch(embeddingTexts);
    const now = new Date().toISOString();
    const hid = (db.prepare("SELECT id FROM households LIMIT 1").get() as any).id;

    const insertChunk = db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertEmbedding = db.prepare(
      "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)"
    );

    const transaction = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = generateId();
        insertChunk.run(chunkId, doc.id, hid, i, chunks[i].heading, chunks[i].text, now);
        insertEmbedding.run(chunkId, new Float32Array(embeddings[i]));
      }
    });
    transaction();

    // Update document
    db.prepare("UPDATE documents SET chunk_count = ?, last_synced = ? WHERE id = ?")
      .run(chunks.length, now, doc.id);

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
