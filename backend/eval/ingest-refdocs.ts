#!/usr/bin/env bun
/**
 * Ingest the Castillo-Park sample docs from refdocs/sample into the eval
 * database. Reads each .docx, runs it through the full production pipeline
 * (pandoc → chunker → embeddings → chunks/chunk_embeddings tables), and
 * upserts by title so re-running is idempotent.
 *
 * Usage: bun eval/ingest-refdocs.ts
 */

import "../src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { chunkMarkdown, buildEmbeddingText } from "../src/services/chunker";
import { docxToMarkdown } from "../src/services/pandoc";
import { runMigrations } from "../src/db/migrations";

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

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in backend/.env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const dbPath = resolve(import.meta.dirname, "..", "hearthstone.db");
const db = new Database(dbPath);
sqliteVec.load(db);
runMigrations(db);

// --- Ingest pipeline ---

const REFDOCS_DIR = resolve(import.meta.dirname, "..", "..", "refdocs", "sample");
const TITLE_PREFIX = "Castillo-Park Household - ";

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return resp.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.docx$/, "");
  return base.startsWith(TITLE_PREFIX) ? base.slice(TITLE_PREFIX.length) : base;
}

async function main() {
  // Ensure a household exists; reuse the first one or bail.
  const household = db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string } | undefined;
  if (!household) {
    console.error("No household in the eval database. Run the bootstrap first.");
    process.exit(1);
  }
  const householdId = household.id;

  const files = readdirSync(REFDOCS_DIR).filter((f) => f.endsWith(".docx"));
  if (files.length === 0) {
    console.error(`No .docx files found in ${REFDOCS_DIR}`);
    process.exit(1);
  }

  console.log(`Ingesting ${files.length} documents from ${REFDOCS_DIR}\n`);

  const now = new Date().toISOString();

  for (const filename of files) {
    const title = titleFromFilename(filename);
    const buffer = readFileSync(resolve(REFDOCS_DIR, filename));

    console.log(`• ${title}`);

    // Pandoc → markdown
    const markdown = await docxToMarkdown(buffer);
    console.log(`  markdown: ${markdown.length} chars`);

    // Upsert document (match by title within the household)
    let doc = db
      .prepare("SELECT id FROM documents WHERE household_id = ? AND title = ?")
      .get(householdId, title) as { id: string } | undefined;

    if (doc) {
      // Clear old chunks and their embeddings
      const oldChunks = db
        .prepare("SELECT id FROM chunks WHERE document_id = ?")
        .all(doc.id) as Array<{ id: string }>;
      const deleteEmbedding = db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?");
      for (const c of oldChunks) deleteEmbedding.run(c.id);
      db.prepare("DELETE FROM chunks WHERE document_id = ?").run(doc.id);
      db.prepare("UPDATE documents SET markdown = ?, status = 'indexing', last_synced = ? WHERE id = ?")
        .run(markdown, now, doc.id);
      console.log(`  (updating existing doc ${doc.id}, cleared ${oldChunks.length} chunks)`);
    } else {
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, chunk_count, created_at, last_synced) VALUES (?, ?, ?, ?, ?, 'indexing', 0, ?, ?)"
      ).run(id, householdId, `eval:${id}`, title, markdown, now, now);
      doc = { id };
      console.log(`  (created new doc ${id})`);
    }

    // Chunk
    const chunks = chunkMarkdown(markdown);
    console.log(`  chunks: ${chunks.length}`);
    if (chunks.length === 0) {
      db.prepare("UPDATE documents SET status = 'ready', chunk_count = 0 WHERE id = ?").run(doc.id);
      console.log();
      continue;
    }

    // Embed
    const embeddingTexts = chunks.map((c) => buildEmbeddingText(c, title));
    const embeddings = await embedBatch(embeddingTexts);

    // Insert
    const insertChunk = db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertEmbedding = db.prepare(
      "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)"
    );

    const transaction = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = crypto.randomUUID();
        insertChunk.run(chunkId, doc!.id, householdId, i, chunks[i].heading, chunks[i].text, now);
        insertEmbedding.run(chunkId, new Float32Array(embeddings[i]));
      }
    });
    transaction();

    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ? WHERE id = ?")
      .run(chunks.length, doc.id);

    console.log(`  ✓ ready (${chunks.length} chunks embedded)`);
    console.log();
  }

  // Summary
  const totalChunks = db.prepare("SELECT COUNT(*) as n FROM chunks").get() as { n: number };
  const totalDocs = db
    .prepare("SELECT COUNT(*) as n FROM documents WHERE status = 'ready'")
    .get() as { n: number };
  console.log(`Done. ${totalDocs.n} ready documents, ${totalChunks.n} total chunks.`);

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
