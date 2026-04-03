// src/routes/household.ts
import type Database from "better-sqlite3";

export function handleUpdateHousehold(
  db: Database.Database,
  householdId: string,
  body: { name: string }
): { status: number; body: any } {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  db.prepare("UPDATE households SET name = ? WHERE id = ?").run(body.name.trim(), householdId);
  const household = db.prepare("SELECT id, name FROM households WHERE id = ?").get(householdId) as any;

  return { status: 200, body: { id: household.id, name: household.name } };
}
