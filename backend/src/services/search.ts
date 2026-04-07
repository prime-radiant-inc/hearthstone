import type Database from "better-sqlite3";

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  heading: string;
  text: string;
  householdId: string;
  distance: number;
}

export function searchChunks(
  db: Database.Database,
  householdId: string,
  queryEmbedding: Float32Array,
  limit: number = 5
): SearchResult[] {
  // sqlite-vec KNN queries require the MATCH + k = ? pattern on the virtual table.
  // Inline JOINs with WHERE filters on joined columns are not supported by sqlite-vec,
  // so we do the KNN scan first as a subquery, then join and filter by household_id.
  const rows = db
    .prepare(
      `
      SELECT
        c.id          AS chunk_id,
        ce.distance,
        c.document_id,
        c.household_id,
        c.chunk_index,
        c.heading,
        c.text,
        d.title       AS document_title
      FROM (
        SELECT chunk_id, distance
        FROM chunk_embeddings
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      ) ce
      JOIN chunks c    ON c.id = ce.chunk_id
      JOIN documents d ON d.id = c.document_id
      WHERE c.household_id = ?
      ORDER BY ce.distance
      LIMIT ?
      `
    )
    .all(
      Buffer.from(queryEmbedding.buffer),
      limit,
      householdId,
      limit
    ) as any[];

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    heading: r.heading || "",
    text: r.text,
    householdId: r.household_id,
    distance: r.distance,
  }));
}
