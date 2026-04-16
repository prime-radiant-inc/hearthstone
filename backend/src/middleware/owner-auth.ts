import type { Database } from "bun:sqlite";
import { jwtVerify } from "jose";
import { HouseholdGoneError } from "../services/household-deletion";

export interface OwnerContext {
  personId: string;
  householdId: string;
}

export async function authenticateOwner(
  db: Database,
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

    if (!personId) throw new Error("unauthorized");

    const person = db.prepare("SELECT id FROM persons WHERE id = ?").get(personId);
    if (!person) throw new Error("unauthorized");

    // Check membership in the specific household from the JWT
    if (householdId) {
      const member = db.prepare(
        "SELECT id FROM household_members WHERE person_id = ? AND household_id = ? AND role = 'owner'"
      ).get(personId, householdId);
      if (member) return { personId, householdId };

      // Membership check failed — distinguish deleted household from removed owner
      const houseExists = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
      if (!houseExists) throw new HouseholdGoneError();
      throw new Error("unauthorized");
    }

    // Fallback: find any household this person owns (for legacy JWTs without householdId)
    const member = db.prepare(
      "SELECT household_id FROM household_members WHERE person_id = ? AND role = 'owner' LIMIT 1"
    ).get(personId) as any;

    return { personId, householdId: member?.household_id ?? "" };
  } catch (err) {
    if (err instanceof HouseholdGoneError) throw err;
    throw new Error("unauthorized");
  }
}
