import type { Database } from "bun:sqlite";

export function deleteHouseholdCascade(db: Database, houseId: string): void {
  db.transaction(() => {
    const chunkIds = db.prepare(
      "SELECT id FROM chunks WHERE household_id = ?"
    ).all(houseId) as Array<{ id: string }>;
    for (const { id } of chunkIds) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(id);
    }
    db.prepare("DELETE FROM chunks           WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM documents        WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM connections      WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM suggestions      WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM session_tokens   WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM auth_pins        WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM guests           WHERE household_id = ?").run(houseId);

    const placeholderIds = db.prepare(`
      SELECT p.id FROM household_members hm
      JOIN persons p ON p.id = hm.person_id
      WHERE hm.household_id = ? AND p.email LIKE '__placeholder__-%'
    `).all(houseId) as Array<{ id: string }>;

    db.prepare("DELETE FROM household_members WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM households        WHERE id = ?").run(houseId);

    for (const { id } of placeholderIds) {
      db.prepare("DELETE FROM persons WHERE id = ?").run(id);
    }
  })();
}
