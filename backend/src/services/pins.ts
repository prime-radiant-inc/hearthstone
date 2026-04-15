import type { Database } from "bun:sqlite";
import { randomBytes } from "crypto";
import { generateId } from "../utils";

const PIN_EXPIRY_DAYS = 7;

// Crockford base32: 10 digits + 22 letters (no I, L, O, or U).
// Chosen for ~30 bits of entropy at 6 characters, no visually ambiguous
// characters, URL-safe without encoding, and "unlikely to spell a bad word."
// Matches PIN_ALPHABET_REGEX below. Keep these in sync.
const PIN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PIN_LENGTH = 6;

/** Valid PIN after normalization: 6 Crockford base32 chars, uppercase. */
export const PIN_REGEX = /^[0-9A-HJKMNP-TV-Z]{6}$/;

/** Accept either case on input; store and compare uppercase. */
export function normalizePin(raw: string): string {
  return raw.trim().toUpperCase();
}

function randomPin(): string {
  // 256 % 32 === 0, so masking with 0x1f is uniform with no rejection needed.
  const bytes = randomBytes(PIN_LENGTH);
  let out = "";
  for (let i = 0; i < PIN_LENGTH; i++) {
    out += PIN_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

function generatePin(db: Database): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pin = randomPin();
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
  rawPin: string
): { role: "owner" | "guest"; personId: string; householdId: string; guestId: string | null } {
  const pin = normalizePin(rawPin);
  if (!PIN_REGEX.test(pin)) throw new Error("not_found");

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
