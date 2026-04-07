import type { Database } from "bun:sqlite";
import { redeemPin } from "../services/pins";
import { generateToken } from "../services/tokens";
import { generateId } from "../utils";

async function issueOwnerJwt(personId: string, householdId: string, jwtSecret: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(jwtSecret);
  return new SignJWT({ personId, householdId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret);
}

export async function handlePinRedeem(
  db: Database,
  body: { pin: string },
  jwtSecret: string
): Promise<{ status: number; body: any }> {
  if (!body.pin || typeof body.pin !== "string") {
    return { status: 422, body: { message: "PIN is required" } };
  }

  try {
    const result = redeemPin(db, body.pin.trim());

    if (result.role === "owner") {
      const person = db.prepare("SELECT id, email, name FROM persons WHERE id = ?").get(result.personId) as any;
      const household = db.prepare("SELECT id, name, created_at FROM households WHERE id = ?").get(result.householdId) as any;
      const token = await issueOwnerJwt(result.personId, result.householdId, jwtSecret);

      // Ensure the person is a member of the household
      db.prepare(`
        INSERT OR IGNORE INTO household_members (id, household_id, person_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `).run(generateId(), result.householdId, result.personId, new Date().toISOString());

      return {
        status: 200,
        body: {
          token,
          role: "owner",
          person: { id: person.id, email: person.email, name: person.name || "" },
          household: { id: household.id, name: household.name, created_at: household.created_at },
        },
      };
    } else {
      const guest = db.prepare("SELECT id, name, household_id FROM guests WHERE id = ?").get(result.guestId!) as any;
      const household = db.prepare("SELECT name FROM households WHERE id = ?").get(result.householdId) as any;

      const sessionToken = generateToken("hss_");
      db.prepare(
        "INSERT INTO session_tokens (id, token, household_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(generateId(), sessionToken, result.householdId, result.guestId!, new Date().toISOString());

      db.prepare("UPDATE guests SET status = 'active' WHERE id = ?").run(result.guestId!);

      return {
        status: 200,
        body: {
          token: sessionToken,
          role: "guest",
          guest: { id: guest.id, name: guest.name, household_id: guest.household_id },
          household_name: household?.name || "",
        },
      };
    }
  } catch (err: any) {
    if (err.message === "not_found") {
      return { status: 404, body: { message: "PIN not found" } };
    }
    if (err.message === "already_used") {
      return { status: 410, body: { message: "This PIN has already been used" } };
    }
    if (err.message === "expired") {
      return { status: 410, body: { message: "This PIN has expired" } };
    }
    return { status: 500, body: { message: "Something went wrong" } };
  }
}
