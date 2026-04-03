import type Database from "better-sqlite3";
import { chunkMarkdown } from "./chunker";
import { randomBytes } from "crypto";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

interface IndexParams {
  documentId: string;
  householdId: string;
  driveFileId: string;
  title: string;
  markdown: string;
  embedBatch: (texts: string[]) => Promise<number[][]>;
}

interface RefreshParams {
  documentId: string;
  householdId: string;
  markdown: string;
  embedBatch: (texts: string[]) => Promise<number[][]>;
}

export async function indexDocument(db: Database.Database, params: IndexParams): Promise<void> {
  const { documentId, householdId, driveFileId, title, markdown, embedBatch } = params;
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, 'indexing', ?)"
  ).run(documentId, householdId, driveFileId, title, markdown, now);

  try {
    await storeChunks(db, documentId, householdId, markdown, embedBatch);
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?").get(documentId) as any;
    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ?, last_synced = ? WHERE id = ?").run(
      chunkCount.count, now, documentId
    );
  } catch (err) {
    db.prepare("UPDATE documents SET status = 'error' WHERE id = ?").run(documentId);
    throw err;
  }
}

export async function refreshDocument(db: Database.Database, params: RefreshParams): Promise<void> {
  const { documentId, householdId, markdown, embedBatch } = params;
  const now = new Date().toISOString();

  db.prepare("UPDATE documents SET status = 'indexing', markdown = ? WHERE id = ?").run(markdown, documentId);

  try {
    const oldChunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as any[];
    for (const chunk of oldChunks) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
    }
    db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);

    await storeChunks(db, documentId, householdId, markdown, embedBatch);
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?").get(documentId) as any;
    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ?, last_synced = ? WHERE id = ?").run(
      chunkCount.count, now, documentId
    );
  } catch (err) {
    db.prepare("UPDATE documents SET status = 'error' WHERE id = ?").run(documentId);
    throw err;
  }
}

async function storeChunks(
  db: Database.Database,
  documentId: string,
  householdId: string,
  markdown: string,
  embedBatch: (texts: string[]) => Promise<number[][]>
): Promise<void> {
  const texts = chunkMarkdown(markdown);
  if (texts.length === 0) return;

  const embeddings = await embedBatch(texts);
  const now = new Date().toISOString();

  const insertChunk = db.prepare(
    "INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertEmbedding = db.prepare(
    "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)"
  );

  const transaction = db.transaction(() => {
    for (let i = 0; i < texts.length; i++) {
      const chunkId = generateId();
      insertChunk.run(chunkId, documentId, householdId, i, texts[i], now);
      const vec = new Float32Array(embeddings[i]);
      insertEmbedding.run(chunkId, Buffer.from(vec.buffer));
    }
  });

  transaction();
}
