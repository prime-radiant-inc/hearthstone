import type { Database } from "bun:sqlite";
import { randomInt } from "crypto";
import { generateId } from "../utils";

const PIN_EXPIRY_DAYS = 7;

function generatePin(db: Database): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pin = String(randomInt(100000, 999999));
    const existing = db.prepare(
      "SELECT id FROM auth_pins WHERE pin = ? AND used_at IS NULL AND expires_at > ?"
    ).get(pin, new Date().toISOString());
    if (!existing) return pin;
  }
  throw new Error("Failed to generate unique PIN after 10 attempts");
}

export function createAuthPin(
  db: Database,
  opts: {
    role: "owner" | "guest";
    personId: string;
    householdId: string;
    guestId?: string;
  }
): { pin: string; expiresAt: string } {
  const pin = generatePin(db);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(
    "INSERT INTO auth_pins (id, pin, role, person_id, household_id, guest_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    generateId(),
    pin,
    opts.role,
    opts.personId,
    opts.householdId,
    opts.guestId ?? null,
    expiresAt.toISOString(),
    now.toISOString()
  );

  return { pin, expiresAt: expiresAt.toISOString() };
}

export function redeemPin(
  db: Database,
  pin: string
): { role: "owner" | "guest"; personId: string; householdId: string; guestId: string | null } {
  const row = db.prepare("SELECT * FROM auth_pins WHERE pin = ?").get(pin) as any;

  if (!row) throw new Error("not_found");
  if (row.used_at) throw new Error("already_used");
  if (new Date(row.expires_at) < new Date()) throw new Error("expired");

  db.prepare("UPDATE auth_pins SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);

  return {
    role: row.role,
    personId: row.person_id,
    householdId: row.household_id,
    guestId: row.guest_id,
  };
}
