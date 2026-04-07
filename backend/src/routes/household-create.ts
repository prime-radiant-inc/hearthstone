// src/routes/household-create.ts
import type { Database } from "bun:sqlite";
import { generateId } from "../utils";

export function handleCreateHousehold(
  db: Database,
  personId: string,
  body: { name: string }
): { status: number; body: any } {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Household name is required" } };
  }

  const id = generateId();
  const now = new Date().toISOString();

  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    id, personId, body.name.trim(), now
  );

  return {
    status: 200,
    body: { id, name: body.name.trim(), created_at: now },
  };
}
