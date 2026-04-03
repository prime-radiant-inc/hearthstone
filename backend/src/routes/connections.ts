// src/routes/connections.ts
import type Database from "better-sqlite3";
import { getDriveAuthUrl, exchangeCodeForDrive } from "../services/google-auth";
import { config } from "../config";
import { randomBytes } from "crypto";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function handleListConnections(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const connections = db
    .prepare(
      "SELECT id, provider, email, created_at FROM connections WHERE household_id = ?"
    )
    .all(householdId);

  return { status: 200, body: { connections } };
}

export function handleConnectGoogleDrive(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const state = Buffer.from(JSON.stringify({ householdId })).toString("base64url");
  const redirectUri = `${config.appBaseUrl}/connections/google-drive/callback`;
  const authUrl = getDriveAuthUrl(state, redirectUri);

  return { status: 200, body: { auth_url: authUrl } };
}

export async function handleGoogleDriveCallback(
  db: Database.Database,
  code: string,
  state: string
): Promise<{ status: number; body: any }> {
  if (!code || !state) {
    return { status: 422, body: { message: "Missing code or state" } };
  }

  let householdId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    householdId = decoded.householdId;
    if (!householdId) throw new Error("missing householdId");
  } catch {
    return { status: 422, body: { message: "Invalid state parameter" } };
  }

  const household = db
    .prepare("SELECT id FROM households WHERE id = ?")
    .get(householdId);
  if (!household) {
    return { status: 404, body: { message: "Household not found" } };
  }

  const redirectUri = `${config.appBaseUrl}/connections/google-drive/callback`;

  try {
    const { refreshToken, email } = await exchangeCodeForDrive(code, redirectUri);

    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, householdId, "google_drive", refreshToken, email ?? null, now);

    const connection = db
      .prepare("SELECT id, provider, email, created_at FROM connections WHERE id = ?")
      .get(id);

    return { status: 200, body: { connection } };
  } catch (err) {
    return { status: 502, body: { message: "Failed to exchange Google authorization code" } };
  }
}

export function handleDeleteConnection(
  db: Database.Database,
  householdId: string,
  connectionId: string
): { status: number; body: any } {
  const connection = db
    .prepare("SELECT id FROM connections WHERE id = ? AND household_id = ?")
    .get(connectionId, householdId);

  if (!connection) {
    return { status: 404, body: { message: "Connection not found" } };
  }

  db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);

  return { status: 204, body: null };
}
