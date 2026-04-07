// src/routes/documents.ts
import type { Database } from "bun:sqlite";
import type { Context } from "../tracing";
import { marked } from "marked";
import { fetchDocAsMarkdown } from "../services/google-drive";
import { indexDocument, refreshDocument } from "../services/indexer";
import { embedBatch } from "../services/embeddings";
import { generateSuggestions } from "../services/suggestions";
import { docxToMarkdown } from "../services/pandoc";
import { generateId } from "../utils";

export function handleListDocuments(
  db: Database,
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
  ctx: Context | undefined,
  db: Database,
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
    const { title, markdown } = await fetchDocAsMarkdown(ctx, connection.refresh_token, body.drive_file_id);

    await indexDocument(ctx, db, {
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
  ctx: Context | undefined,
  db: Database,
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
    const { markdown } = await fetchDocAsMarkdown(ctx, connection.refresh_token, doc.drive_file_id);

    await refreshDocument(ctx, db, {
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
  db: Database,
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
  db: Database,
  householdId: string,
  documentId: string
): { status: number; body: any } {
  const doc = db
    .prepare("SELECT id, title, markdown FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  // Get chunks for this document so we can wrap each in an anchorable section
  const chunks = db
    .prepare("SELECT chunk_index, heading, text FROM chunks WHERE document_id = ? ORDER BY chunk_index")
    .all(documentId) as any[];

  const html = renderStyledHtml(doc.markdown, chunks);

  return {
    status: 200,
    body: { id: doc.id, title: doc.title, markdown: doc.markdown, html },
  };
}

function renderStyledHtml(markdown: string, chunks: Array<{ chunk_index: number; heading: string; text: string }>): string {
  let bodyHtml: string;

  if (chunks.length > 0) {
    // Render each chunk as a section with an anchor ID
    bodyHtml = chunks.map((chunk) => {
      let headingHtml = "";

      if (chunk.heading) {
        const parts = chunk.heading.split(" > ");
        const heading = parts[parts.length - 1];
        const level = Math.min(parts.length + 1, 4);
        headingHtml = `<h${level}>${heading}</h${level}>`;
      }

      const chunkHtml = marked(chunk.text);
      return `<section id="chunk-${chunk.chunk_index}" class="chunk">${headingHtml}${chunkHtml}</section>`;
    }).join("\n");
  } else {
    bodyHtml = marked(markdown);
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #2C2520;
    padding: 20px;
    background: #FBF7F0;
  }
  h1, h2, h3, h4 {
    font-family: Georgia, serif;
    font-weight: 600;
    color: #2C2520;
    margin-top: 24px;
    margin-bottom: 8px;
  }
  h1 { font-size: 24px; }
  h2 { font-size: 20px; border-bottom: 1px solid #EDE3D1; padding-bottom: 6px; }
  h3 { font-size: 17px; }
  p { margin-bottom: 12px; }
  strong { font-weight: 600; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 15px;
  }
  th, td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid #EDE3D1;
  }
  th {
    font-weight: 600;
    color: #5C524A;
    background: #F5EDE0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  ul, ol { margin: 12px 0; padding-left: 24px; }
  li { margin-bottom: 6px; }
  code { background: #F5EDE0; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
  pre { background: #F5EDE0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #EDE3D1; margin: 24px 0; }
  .chunk { padding: 4px 0; }
  .chunk.highlighted {
    background: rgba(181, 113, 45, 0.08);
    border-left: 3px solid #B5712D;
    margin-left: -12px;
    padding-left: 12px;
    border-radius: 0 4px 4px 0;
  }
  @keyframes fade-highlight {
    0% { background: rgba(181, 113, 45, 0.15); }
    100% { background: rgba(181, 113, 45, 0.06); }
  }
  .chunk.highlighted {
    animation: fade-highlight 2s ease-out forwards;
  }
</style>
</head>
<body>${bodyHtml}
<script>
function scrollToChunk(index) {
  const el = document.getElementById('chunk-' + index);
  if (!el) return;
  el.classList.add('highlighted');
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}
</script>
</body>
</html>`;
}

export async function handleUploadDocument(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  title: string,
  docxBuffer: Buffer
): Promise<{ status: number; body: any }> {
  if (!title?.trim()) {
    return { status: 422, body: { message: "Title is required" } };
  }
  if (!docxBuffer || docxBuffer.length === 0) {
    return { status: 422, body: { message: "File is required" } };
  }

  const documentId = generateId();

  try {
    const markdown = await docxToMarkdown(docxBuffer);

    await indexDocument(ctx, db, {
      documentId,
      householdId,
      driveFileId: `upload:${documentId}`,
      title: title.trim(),
      markdown,
      embedBatch,
    });

    // Regenerate suggestion chips
    generateSuggestions(db, householdId).catch(() => {});

    const doc = db
      .prepare("SELECT id, title, status, chunk_count FROM documents WHERE id = ?")
      .get(documentId) as any;
    return {
      status: 200,
      body: { id: doc.id, title: doc.title, status: doc.status, chunk_count: doc.chunk_count },
    };
  } catch (err: any) {
    return { status: 500, body: { message: `Document conversion failed: ${err.message}` } };
  }
}
