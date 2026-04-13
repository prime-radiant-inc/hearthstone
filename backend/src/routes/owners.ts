// src/routes/owners.ts
import type { Database } from "bun:sqlite";
import { createAuthPin } from "../services/pins";
import { generateId } from "../utils";

export function handleListOwners(
  db: Database,
  householdId: string
): { status: number; body: any } {
  const owners = db.prepare(`
    SELECT p.id, p.name, p.email, hm.created_at
    FROM household_members hm
    JOIN persons p ON p.id = hm.person_id
    WHERE hm.household_id = ? AND hm.role = 'owner'
    ORDER BY hm.created_at
  `).all(householdId);

  return { status: 200, body: { owners } };
}

export function handleInviteOwner(
  db: Database,
  householdId: string,
  inviterPersonId: string,
  body: { name: string; email: string },
  publicUrl: string
): { status: number; body: any } {
  if (!body.email || !body.email.trim()) {
    return { status: 422, body: { message: "Email is required" } };
  }

  const email = body.email.trim().toLowerCase();
  const name = body.name?.trim() || "";

  // Check if already an owner
  const existing = db.prepare(`
    SELECT hm.id FROM household_members hm
    JOIN persons p ON p.id = hm.person_id
    WHERE hm.household_id = ? AND p.email = ? AND hm.role = 'owner'
  `).get(householdId, email);

  if (existing) {
    return { status: 409, body: { message: "This person is already an owner" } };
  }

  // Find or create person
  let person = db.prepare("SELECT id, name FROM persons WHERE email = ?").get(email) as any;
  if (!person) {
    const personId = generateId();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      personId, email, name, now
    );
    person = { id: personId, name };
  } else if (name && !person.name) {
    db.prepare("UPDATE persons SET name = ? WHERE id = ?").run(name, person.id);
  }

  const { pin, expiresAt } = createAuthPin(db, {
    role: "owner",
    personId: person.id,
    householdId,
  });

  return {
    status: 200,
    body: { pin, join_url: `${publicUrl}/join/${pin}`, expires_at: expiresAt },
  };
}

export function handleRemoveOwner(
  db: Database,
  householdId: string,
  targetPersonId: string
): { status: number; body: any } {
  const member = db.prepare(
    "SELECT id FROM household_members WHERE household_id = ? AND person_id = ? AND role = 'owner'"
  ).get(householdId, targetPersonId);

  if (!member) {
    return { status: 404, body: { message: "Owner not found" } };
  }

  // Cannot remove the last owner
  const count = db.prepare(
    "SELECT COUNT(*) as count FROM household_members WHERE household_id = ? AND role = 'owner'"
  ).get(householdId) as any;

  if (count.count <= 1) {
    return { status: 422, body: { message: "Cannot remove the last owner" } };
  }

  db.prepare(
    "DELETE FROM household_members WHERE household_id = ? AND person_id = ? AND role = 'owner'"
  ).run(householdId, targetPersonId);

  return { status: 204, body: null };
}
