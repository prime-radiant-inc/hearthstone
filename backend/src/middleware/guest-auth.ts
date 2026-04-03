import type Database from "better-sqlite3";
import { validateSessionToken } from "../services/tokens";

export interface GuestContext {
  guestId: string;
  householdId: string;
}

export function authenticateGuest(
  db: Database.Database,
  authHeader: string | undefined | null
): GuestContext {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("unauthorized");
  }

  const token = authHeader.slice(7);
  const result = validateSessionToken(db, token);

  if (!result) {
    throw new Error("session_expired");
  }

  return result;
}
