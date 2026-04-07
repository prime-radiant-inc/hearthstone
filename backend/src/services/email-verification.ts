// src/services/email-verification.ts
import type { Database } from "bun:sqlite";
import { randomInt } from "crypto";
import { generateId } from "../utils";

function generateCode(): string {
  return String(randomInt(100000, 999999));
}

const EXPIRY_MINUTES = 10;

export function createVerification(
  db: Database,
  email: string,
  purpose: "register" | "login"
): { code: string } {
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_MINUTES * 60 * 1000);

  db.prepare(
    "INSERT INTO email_verifications (id, email, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(generateId(), email, code, purpose, expiresAt.toISOString(), now.toISOString());

  // Console-based delivery for now (Resend integration later)
  console.log(`[EMAIL VERIFICATION] ${email} code=${code} purpose=${purpose}`);

  return { code };
}

export function verifyCode(
  db: Database,
  email: string,
  code: string,
  purpose: "register" | "login"
): boolean {
  // Find the most recent unused, unexpired code for this email+purpose
  const row = db
    .prepare(
      `SELECT id, code, expires_at FROM email_verifications
       WHERE email = ? AND purpose = ? AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(email, purpose) as
    | { id: string; code: string; expires_at: string }
    | undefined;

  if (!row) return false;
  if (row.code !== code) return false;
  if (new Date(row.expires_at) < new Date()) return false;

  // Mark as used
  db.prepare("UPDATE email_verifications SET used_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id
  );

  return true;
}
