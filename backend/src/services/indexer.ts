import type { Database } from "bun:sqlite";
import { chunkMarkdown, buildEmbeddingText } from "./chunker";
import { generateId } from "../utils";
import { startSpan, spanContext, SpanStatusCode, type Context } from "../tracing";

interface IndexParams {
  documentId: string;
  householdId: string;
  driveFileId: string;
  title: string;
  markdown: string;
  embedBatch: (texts: string[], ctx?: Context) => Promise<number[][]>;
}

interface RefreshParams {
  documentId: string;
  householdId: string;
  markdown: string;
  embedBatch: (texts: string[], ctx?: Context) => Promise<number[][]>;
}

export async function indexDocument(db: Database, params: IndexParams, ctx?: Context): Promise<void> {
  const span = startSpan("indexer.index_document", ctx);
  const { documentId, householdId, driveFileId, title, markdown, embedBatch } = params;
  span.setAttribute("app.document_id", documentId);
  span.setAttribute("app.household_id", householdId);
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, 'indexing', ?)"
  ).run(documentId, householdId, driveFileId, title, markdown, now);

  try {
    const childCtx = spanContext(span);
    await storeChunks(db, documentId, householdId, markdown, embedBatch, title, childCtx);
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?").get(documentId) as any;
    span.setAttribute("app.chunk_count", chunkCount.count);
    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ?, last_synced = ? WHERE id = ?").run(
      chunkCount.count, now, documentId
    );
  } catch (err: any) {
    db.prepare("UPDATE documents SET status = 'error' WHERE id = ?").run(documentId);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

export async function refreshDocument(db: Database, params: RefreshParams, ctx?: Context): Promise<void> {
  const span = startSpan("indexer.refresh_document", ctx);
  const { documentId, householdId, markdown, embedBatch } = params;
  span.setAttribute("app.document_id", documentId);
  span.setAttribute("app.household_id", householdId);
  const now = new Date().toISOString();

  const doc = db.prepare("SELECT title FROM documents WHERE id = ?").get(documentId) as any;
  db.prepare("UPDATE documents SET status = 'indexing', markdown = ? WHERE id = ?").run(markdown, documentId);

  try {
    const oldChunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as any[];
    for (const chunk of oldChunks) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
    }
    db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);

    const childCtx = spanContext(span);
    await storeChunks(db, documentId, householdId, markdown, embedBatch, doc?.title, childCtx);
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?").get(documentId) as any;
    span.setAttribute("app.chunk_count", chunkCount.count);
    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ?, last_synced = ? WHERE id = ?").run(
      chunkCount.count, now, documentId
    );
  } catch (err: any) {
    db.prepare("UPDATE documents SET status = 'error' WHERE id = ?").run(documentId);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

async function storeChunks(
  db: Database,
  documentId: string,
  householdId: string,
  markdown: string,
  embedBatch: (texts: string[], ctx?: Context) => Promise<number[][]>,
  title?: string,
  ctx?: Context,
): Promise<void> {
  const chunks = chunkMarkdown(markdown);
  if (chunks.length === 0) return;

  const embeddingTexts = chunks.map(c => buildEmbeddingText(c, title || ""));
  const embeddings = await embedBatch(embeddingTexts, ctx);
  const now = new Date().toISOString();

  const insertChunk = db.prepare(
    "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertEmbedding = db.prepare(
    "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)"
  );

  const transaction = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = generateId();
      insertChunk.run(chunkId, documentId, householdId, i, chunks[i].heading, chunks[i].text, now);
      insertEmbedding.run(chunkId, new Float32Array(embeddings[i]));
    }
  });

  transaction();
}
