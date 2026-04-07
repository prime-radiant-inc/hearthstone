// src/routes/guests.ts
import type { Database } from "bun:sqlite";
import { revokeGuestTokens } from "../services/tokens";
import { createAuthPin } from "../services/pins";
import { config } from "../config";
import { generateId } from "../utils";

export function handleListGuests(
  db: Database,
  householdId: string
): { status: number; body: any } {
  const guests = db
    .prepare("SELECT id, name, contact, contact_type, status, created_at FROM guests WHERE household_id = ?")
    .all(householdId);

  return { status: 200, body: { guests } };
}

export async function handleCreateGuest(
  db: Database,
  householdId: string,
  personId: string,
  body: { name: string | null; email: string | null }
): Promise<{ status: number; body: any }> {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  const guestId = generateId();
  const contact = body.email?.trim() || "";
  const contactType = "email";
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ).run(guestId, householdId, body.name.trim(), contact, contactType, now);

  const { pin, expiresAt } = createAuthPin(db, {
    role: "guest",
    personId,
    householdId,
    guestId,
  });

  return {
    status: 200,
    body: {
      guest: { id: guestId, name: body.name.trim(), status: "pending" },
      pin,
      expires_at: expiresAt,
    },
  };
}

export function handleRevokeGuest(
  db: Database,
  householdId: string,
  guestId: string
): { status: number; body: any } {
  const guest = db
    .prepare("SELECT * FROM guests WHERE id = ? AND household_id = ?")
    .get(guestId, householdId) as any;

  if (!guest) {
    return { status: 404, body: { message: "Guest not found" } };
  }
  if (guest.status === "revoked") {
    return { status: 409, body: { message: "Guest already revoked" } };
  }

  const revokedAt = revokeGuestTokens(db, guestId);
  return { status: 200, body: { guest_id: guestId, revoked_at: revokedAt } };
}

export function handleReinviteGuest(
  db: Database,
  householdId: string,
  personId: string,
  guestId: string
): { status: number; body: any } {
  const guest = db
    .prepare("SELECT * FROM guests WHERE id = ? AND household_id = ?")
    .get(guestId, householdId) as any;

  if (!guest) {
    return { status: 404, body: { message: "Guest not found" } };
  }

  if (guest.status === "revoked") {
    db.prepare("UPDATE guests SET status = 'pending' WHERE id = ?").run(guestId);
  }

  const { pin, expiresAt } = createAuthPin(db, {
    role: "guest",
    personId,
    householdId,
    guestId,
  });

  return {
    status: 200,
    body: { pin, expires_at: expiresAt },
  };
}

export function handleDeleteGuest(
  db: Database,
  householdId: string,
  guestId: string
): { status: number; body: any } {
  const guest = db
    .prepare("SELECT * FROM guests WHERE id = ? AND household_id = ?")
    .get(guestId, householdId) as any;

  if (!guest) {
    return { status: 404, body: { message: "Guest not found" } };
  }
  if (guest.status !== "revoked") {
    return { status: 409, body: { message: "Guest is still active; revoke first" } };
  }

  db.prepare("DELETE FROM session_tokens WHERE guest_id = ?").run(guestId);
  db.prepare("DELETE FROM invite_tokens WHERE guest_id = ?").run(guestId);
  db.prepare("DELETE FROM auth_pins WHERE guest_id = ?").run(guestId);
  db.prepare("DELETE FROM guests WHERE id = ?").run(guestId);

  return { status: 204, body: null };
}
