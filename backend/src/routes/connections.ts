// src/routes/connections.ts
import type Database from "better-sqlite3";
import { getDriveAuthUrl, exchangeCodeForDrive } from "../services/google-auth";
import { listDriveFiles } from "../services/google-drive";
import { config } from "../config";
import { generateId } from "../utils";

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
): Promise<{ status: number; body: any; redirect?: string }> {
  if (!code || !state) {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Missing+code+or+state" };
  }

  let householdId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    householdId = decoded.householdId;
    if (!householdId) throw new Error("missing householdId");
  } catch {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Invalid+state" };
  }

  const household = db
    .prepare("SELECT id FROM households WHERE id = ?")
    .get(householdId);
  if (!household) {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Household+not+found" };
  }

  const redirectUri = `${config.appBaseUrl}/connections/google-drive/callback`;

  try {
    const { refreshToken, email } = await exchangeCodeForDrive(code, redirectUri);

    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, householdId, "google_drive", refreshToken, email ?? null, now);

    return { status: 302, body: null, redirect: `hearthstone://drive-connected?connection_id=${id}` };
  } catch (err) {
    return { status: 302, body: null, redirect: "hearthstone://drive-error?message=Google+authorization+failed" };
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
