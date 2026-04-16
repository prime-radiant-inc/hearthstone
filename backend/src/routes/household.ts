// src/routes/household.ts
import type { Database } from "bun:sqlite";
import { deleteHouseholdCascade } from "../services/household-deletion";

export function handleDeleteHousehold(
  db: Database,
  householdId: string
): { status: number; body: any } {
  deleteHouseholdCascade(db, householdId);
  return { status: 204, body: null };
}

export function handleUpdateHousehold(
  db: Database,
  householdId: string,
  body: { name: string }
): { status: number; body: any } {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  db.prepare("UPDATE households SET name = ? WHERE id = ?").run(body.name.trim(), householdId);
  const household = db.prepare("SELECT id, name, created_at FROM households WHERE id = ?").get(householdId) as any;

  return { status: 200, body: { id: household.id, name: household.name, created_at: household.created_at } };
}
