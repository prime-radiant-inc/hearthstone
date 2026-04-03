// src/routes/documents.ts
import type Database from "better-sqlite3";
import { fetchDocAsMarkdown } from "../services/google-drive";
import { indexDocument, refreshDocument } from "../services/indexer";
import { embedBatch } from "../services/embeddings";
import { generateSuggestions } from "../services/suggestions";
import { generateId } from "../utils";

export function handleListDocuments(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const docs = db
    .prepare(
      "SELECT id, title, drive_file_id, status, chunk_count, last_synced FROM documents WHERE household_id = ?"
    )
    .all(householdId);

  return { status: 200, body: { documents: docs } };
}

export async function handleConnectDocument(
  db: Database.Database,
  householdId: string,
  body: { drive_file_id: string; title?: string }
): Promise<{ status: number; body: any }> {
  if (!body.drive_file_id) {
    return { status: 422, body: { message: "Missing drive_file_id" } };
  }

  const connection = db.prepare(
    "SELECT refresh_token FROM connections WHERE household_id = ? AND provider = 'google_drive' LIMIT 1"
  ).get(householdId) as any;

  if (!connection) {
    return { status: 422, body: { message: "No Google Drive connected" } };
  }

  const documentId = generateId();

  try {
    const { title, markdown } = await fetchDocAsMarkdown(connection.refresh_token, body.drive_file_id);

    await indexDocument(db, {
      documentId,
      householdId,
      driveFileId: body.drive_file_id,
      title: body.title || title,
      markdown,
      embedBatch,
    });

    generateSuggestions(db, householdId).catch(() => {});

    const doc = db.prepare("SELECT id, title, status FROM documents WHERE id = ?").get(documentId) as any;
    return { status: 200, body: { id: doc.id, title: doc.title, status: doc.status } };
  } catch (err) {
    return { status: 502, body: { message: "Drive API unreachable" } };
  }
}

export async function handleRefreshDocument(
  db: Database.Database,
  householdId: string,
  documentId: string
): Promise<{ status: number; body: any }> {
  const doc = db
    .prepare("SELECT * FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  const connection = db.prepare(
    "SELECT refresh_token FROM connections WHERE household_id = ? AND provider = 'google_drive' LIMIT 1"
  ).get(householdId) as any;

  if (!connection) {
    return { status: 422, body: { message: "No Google Drive connected" } };
  }

  try {
    const { markdown } = await fetchDocAsMarkdown(connection.refresh_token, doc.drive_file_id);

    await refreshDocument(db, {
      documentId,
      householdId,
      markdown,
      embedBatch,
    });

    generateSuggestions(db, householdId).catch(() => {});

    return { status: 200, body: { id: documentId, status: "indexing" } };
  } catch (err) {
    return { status: 502, body: { message: "Drive API unreachable" } };
  }
}

export function handleDeleteDocument(
  db: Database.Database,
  householdId: string,
  documentId: string
): { status: number; body: any } {
  const doc = db
    .prepare("SELECT id FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  const chunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as any[];
  for (const chunk of chunks) {
    db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
  }
  db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
  db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);

  return { status: 204, body: null };
}

export function handleGetContent(
  db: Database.Database,
  householdId: string,
  documentId: string
): { status: number; body: any } {
  const doc = db
    .prepare("SELECT id, title, markdown FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  return {
    status: 200,
    body: { id: doc.id, title: doc.title, markdown: doc.markdown },
  };
}
