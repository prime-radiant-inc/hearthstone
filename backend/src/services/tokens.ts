import type { Database } from "bun:sqlite";
import { randomBytes } from "crypto";

export function generateToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function validateSessionToken(
  db: Database,
  token: string
): { guestId: string; householdId: string } | null {
  const row = db
    .prepare("SELECT * FROM session_tokens WHERE token = ? AND revoked_at IS NULL")
    .get(token) as any;

  if (!row) return null;
  return { guestId: row.guest_id, householdId: row.household_id };
}

export function revokeGuestTokens(db: Database, guestId: string): string {
  const now = new Date().toISOString();
  db.prepare("UPDATE session_tokens SET revoked_at = ? WHERE guest_id = ? AND revoked_at IS NULL").run(now, guestId);
  db.prepare("UPDATE guests SET status = 'revoked' WHERE id = ?").run(guestId);
  return now;
}
