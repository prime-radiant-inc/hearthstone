// src/routes/auth.ts
import type Database from "better-sqlite3";
import { SignJWT } from "jose";
import { getAuthUrl, exchangeCode } from "../services/google-auth";
import { redeemInviteToken } from "../services/tokens";
import { randomBytes } from "crypto";
import { config } from "../config";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function handleGoogleAuthStart(): Response {
  const state = randomBytes(16).toString("hex");
  const url = getAuthUrl(state);
  return Response.redirect(url, 302);
}

export async function handleGoogleCallback(
  db: Database.Database,
  code: string,
  _state: string
): Promise<{ status: number; body: any }> {
  try {
    const { email, refreshToken } = await exchangeCode(code);

    let person = db.prepare("SELECT * FROM persons WHERE email = ?").get(email) as any;
    let isNew = false;

    if (!person) {
      const personId = generateId();
      db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
        personId, email, refreshToken, new Date().toISOString()
      );
      person = { id: personId, email };
      isNew = true;
    } else {
      db.prepare("UPDATE persons SET google_refresh_token = ? WHERE id = ?").run(refreshToken, person.id);
    }

    const household = db.prepare("SELECT * FROM households WHERE owner_id = ?").get(person.id) as any;

    const encoder = new TextEncoder();
    const token = await new SignJWT({
      personId: person.id,
      householdId: household?.id || null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(encoder.encode(config.jwtSecret));

    return {
      status: 200,
      body: {
        token,
        household: household
          ? { id: household.id, name: household.name, created_at: household.created_at }
          : null,
        is_new: isNew,
      },
    };
  } catch (err) {
    return { status: 500, body: { message: "Authentication failed" } };
  }
}

export async function handleInviteRedeem(
  db: Database.Database,
  body: { invite_token: string }
): Promise<{ status: number; body: any }> {
  try {
    const result = redeemInviteToken(db, body.invite_token);
    const guest = db.prepare("SELECT id, name, household_id FROM guests WHERE id = ?").get(result.guestId) as any;

    return {
      status: 200,
      body: {
        session_token: result.token,
        guest: {
          id: guest.id,
          name: guest.name,
          household_id: guest.household_id,
        },
      },
    };
  } catch (err: any) {
    if (err.message === "already_used") {
      return { status: 410, body: { message: "This invite has already been used" } };
    }
    if (err.message === "expired") {
      return { status: 410, body: { message: "This invite has expired" } };
    }
    if (err.message === "not_found") {
      return { status: 404, body: { message: "Invite not found" } };
    }
    return { status: 500, body: { message: "Something went wrong" } };
  }
}
