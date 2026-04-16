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

  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
    id, body.name.trim(), now
  );

  db.prepare(
    "INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
  ).run(generateId(), id, personId, now);

  return {
    status: 200,
    body: { id, name: body.name.trim(), created_at: now },
  };
}
