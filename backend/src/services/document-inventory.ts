import type { Database } from "bun:sqlite";

interface InventoryRow {
  id: string;
  title: string;
  chunk_count: number;
}

export function buildDocumentInventory(db: Database, householdId: string): string {
  const rows = db
    .prepare(
      `
      SELECT d.id, d.title, COUNT(c.id) AS chunk_count
      FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id
      WHERE d.household_id = ? AND d.status = 'ready'
      GROUP BY d.id, d.title
      ORDER BY d.title
      `
    )
    .all(householdId) as InventoryRow[];

  if (rows.length === 0) {
    return "Available documents in this household: (none)";
  }

  const lines = rows.map(
    (r) => `- "${r.title}" (id: ${r.id}, ${r.chunk_count} chunks)`
  );

  return ["Available documents in this household:", ...lines].join("\n");
}
