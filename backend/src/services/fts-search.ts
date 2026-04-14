import type { Database } from "bun:sqlite";
import type { SearchResult } from "./search";

export function ftsSearch(
  db: Database,
  householdId: string,
  query: string,
  limit: number = 5
): SearchResult[] {
  if (!query.trim()) return [];

  // FTS5 is sensitive to syntax characters in user input. Strip anything
  // that isn't a word char or whitespace so a query like "garage code?"
  // does not get parsed as an FTS5 expression.
  const safeQuery = query.replace(/[^\w\s]/g, " ").trim();
  if (!safeQuery) return [];

  const rows = db
    .prepare(
      `
      SELECT
        c.id           AS chunk_id,
        c.document_id,
        c.household_id,
        c.chunk_index,
        c.heading,
        c.text,
        d.title        AS document_title,
        chunks_fts.rank AS rank
      FROM chunks_fts
      JOIN chunks c    ON c.rowid = chunks_fts.rowid
      JOIN documents d ON d.id = c.document_id
      WHERE chunks_fts MATCH ?
        AND c.household_id = ?
      ORDER BY chunks_fts.rank
      LIMIT ?
      `
    )
    .all(safeQuery, householdId, limit) as any[];

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    heading: r.heading || "",
    text: r.text,
    householdId: r.household_id,
    distance: -r.rank, // FTS5 rank is negative log probability; lower is better
  }));
}
