import type Database from "better-sqlite3";
import { jwtVerify } from "jose";

export interface OwnerContext {
  personId: string;
  householdId: string;
}

export async function authenticateOwner(
  db: Database.Database,
  authHeader: string | undefined | null,
  jwtSecret: string
): Promise<OwnerContext> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("unauthorized");
  }

  const token = authHeader.slice(7);

  try {
    const encoder = new TextEncoder();
    const { payload } = await jwtVerify(token, encoder.encode(jwtSecret));
    const personId = payload.personId as string;

    if (!personId) throw new Error("unauthorized");

    const person = db.prepare("SELECT id FROM persons WHERE id = ?").get(personId);
    if (!person) throw new Error("unauthorized");

    // Always look up household by owner_id — handles JWTs issued before
    // household creation without needing to re-issue tokens
    const household = db
      .prepare("SELECT id FROM households WHERE owner_id = ?")
      .get(personId) as any;

    return { personId, householdId: household?.id ?? "" };
  } catch {
    throw new Error("unauthorized");
  }
}
