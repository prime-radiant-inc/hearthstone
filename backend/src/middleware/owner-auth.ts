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
    const householdId = payload.householdId as string;

    if (!personId || !householdId) throw new Error("unauthorized");

    const person = db.prepare("SELECT id FROM persons WHERE id = ?").get(personId);
    const household = db
      .prepare("SELECT id FROM households WHERE id = ? AND owner_id = ?")
      .get(householdId, personId);

    if (!person || !household) throw new Error("unauthorized");

    return { personId, householdId };
  } catch {
    throw new Error("unauthorized");
  }
}
