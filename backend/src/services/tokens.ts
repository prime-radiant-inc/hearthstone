import type Database from "better-sqlite3";
import { randomBytes } from "crypto";

function generateToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function generateInviteToken(
  db: Database.Database,
  householdId: string,
  guestId: string
): { token: string; expiresAt: string } {
  const token = generateToken("hsi_");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  db.prepare(
    "INSERT INTO invite_tokens (id, token, household_id, guest_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(generateId(), token, householdId, guestId, expiresAt.toISOString(), now.toISOString());

  return { token, expiresAt: expiresAt.toISOString() };
}

export function redeemInviteToken(
  db: Database.Database,
  token: string
): { token: string; guestId: string; householdId: string } {
  const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(token) as any;

  if (!row) throw new Error("not_found");
  if (row.used_at) throw new Error("already_used");
  if (new Date(row.expires_at) < new Date()) throw new Error("expired");

  const now = new Date().toISOString();

  db.prepare("UPDATE invite_tokens SET used_at = ? WHERE id = ?").run(now, row.id);

  const sessionToken = generateToken("hss_");
  db.prepare(
    "INSERT INTO session_tokens (id, token, household_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(generateId(), sessionToken, row.household_id, row.guest_id, now);

  db.prepare("UPDATE guests SET status = 'active' WHERE id = ?").run(row.guest_id);

  return { token: sessionToken, guestId: row.guest_id, householdId: row.household_id };
}

export function validateSessionToken(
  db: Database.Database,
  token: string
): { guestId: string; householdId: string } | null {
  const row = db
    .prepare("SELECT * FROM session_tokens WHERE token = ? AND revoked_at IS NULL")
    .get(token) as any;

  if (!row) return null;
  return { guestId: row.guest_id, householdId: row.household_id };
}

export function revokeGuestTokens(db: Database.Database, guestId: string): string {
  const now = new Date().toISOString();
  db.prepare("UPDATE session_tokens SET revoked_at = ? WHERE guest_id = ? AND revoked_at IS NULL").run(now, guestId);
  db.prepare("UPDATE guests SET status = 'revoked' WHERE id = ?").run(guestId);
  db.prepare("UPDATE invite_tokens SET used_at = ? WHERE guest_id = ? AND used_at IS NULL").run(now, guestId);
  return now;
}
