// src/routes/auth.ts
import type Database from "better-sqlite3";
import { SignJWT } from "jose";
import { redeemInviteToken } from "../services/tokens";
import { createVerification, verifyCode } from "../services/email-verification";
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
} from "../services/passkey";
import { randomBytes } from "crypto";
import { config } from "../config";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function issueJwt(
  personId: string,
  householdId: string | null
): Promise<string> {
  const encoder = new TextEncoder();
  return new SignJWT({ personId, householdId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(encoder.encode(config.jwtSecret));
}

// --- Registration flow ---

export async function handleRegister(
  db: Database.Database,
  body: { email: string }
): Promise<{ status: number; body: any }> {
  const email = body.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { status: 422, body: { message: "Invalid email address" } };
  }

  const existing = db
    .prepare("SELECT id FROM persons WHERE email = ?")
    .get(email);
  if (existing) {
    return { status: 409, body: { message: "Email already registered" } };
  }

  createVerification(db, email, "register");
  return { status: 200, body: { message: "Verification code sent", email } };
}

export async function handleRegisterVerify(
  db: Database.Database,
  body: { email: string; code: string }
): Promise<{ status: number; body: any }> {
  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();

  if (!email || !code) {
    return { status: 422, body: { message: "Email and code are required" } };
  }

  const valid = verifyCode(db, email, code, "register");
  if (!valid) {
    return { status: 401, body: { message: "Invalid or expired code" } };
  }

  // Create the person
  const personId = generateId();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
    personId,
    email,
    now
  );

  // Return WebAuthn registration options
  const options = await getRegistrationOptions(personId, email);
  return {
    status: 200,
    body: { person_id: personId, registration_options: options },
  };
}

export async function handleRegisterPasskey(
  db: Database.Database,
  body: { person_id: string; credential: any }
): Promise<{ status: number; body: any }> {
  const { person_id, credential } = body;

  if (!person_id || !credential) {
    return {
      status: 422,
      body: { message: "person_id and credential are required" },
    };
  }

  const person = db
    .prepare("SELECT * FROM persons WHERE id = ?")
    .get(person_id) as any;
  if (!person) {
    return { status: 404, body: { message: "Person not found" } };
  }

  try {
    const verification = await verifyRegistration(person_id, credential);
    if (!verification.verified || !verification.registrationInfo) {
      return { status: 401, body: { message: "Passkey verification failed" } };
    }

    const { credential: regCredential } = verification.registrationInfo;

    const credId = generateId();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO passkey_credentials (id, person_id, credential_id, public_key, counter, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      credId,
      person_id,
      regCredential.id,
      Buffer.from(regCredential.publicKey).toString("base64"),
      regCredential.counter,
      now
    );

    const household = db
      .prepare("SELECT * FROM households WHERE owner_id = ?")
      .get(person_id) as any;

    const token = await issueJwt(person_id, household?.id || null);

    return {
      status: 200,
      body: {
        token,
        person: { id: person.id, email: person.email },
        household: household
          ? { id: household.id, name: household.name, created_at: household.created_at }
          : null,
        is_new: true,
      },
    };
  } catch (err: any) {
    return { status: 401, body: { message: "Passkey verification failed" } };
  }
}

// --- Login flow: passkey ---

export async function handleLoginPasskeyChallenge(
  db: Database.Database,
  body: { email: string }
): Promise<{ status: number; body: any }> {
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return { status: 422, body: { message: "Email is required" } };
  }

  const person = db
    .prepare("SELECT id FROM persons WHERE email = ?")
    .get(email) as any;
  if (!person) {
    return { status: 404, body: { message: "Email not found" } };
  }

  const credentials = db
    .prepare("SELECT credential_id FROM passkey_credentials WHERE person_id = ?")
    .all(person.id) as Array<{ credential_id: string }>;

  if (credentials.length === 0) {
    return { status: 404, body: { message: "No passkeys registered" } };
  }

  const options = await getAuthenticationOptions(email, credentials);
  return { status: 200, body: { authentication_options: options } };
}

export async function handleLoginPasskeyVerify(
  db: Database.Database,
  body: { email: string; credential: any }
): Promise<{ status: number; body: any }> {
  const email = body.email?.trim().toLowerCase();
  const { credential } = body;

  if (!email || !credential) {
    return {
      status: 422,
      body: { message: "Email and credential are required" },
    };
  }

  const person = db
    .prepare("SELECT * FROM persons WHERE email = ?")
    .get(email) as any;
  if (!person) {
    return { status: 404, body: { message: "Email not found" } };
  }

  // Find the matching stored credential
  const storedCred = db
    .prepare(
      "SELECT * FROM passkey_credentials WHERE person_id = ? AND credential_id = ?"
    )
    .get(person.id, credential.id) as any;

  if (!storedCred) {
    return { status: 401, body: { message: "Credential not found" } };
  }

  try {
    const verification = await verifyAuthentication(
      email,
      credential,
      storedCred
    );

    if (!verification.verified) {
      return { status: 401, body: { message: "Passkey verification failed" } };
    }

    // Update counter
    db.prepare(
      "UPDATE passkey_credentials SET counter = ? WHERE id = ?"
    ).run(verification.authenticationInfo.newCounter, storedCred.id);

    const household = db
      .prepare("SELECT * FROM households WHERE owner_id = ?")
      .get(person.id) as any;

    const token = await issueJwt(person.id, household?.id || null);

    return {
      status: 200,
      body: {
        token,
        person: { id: person.id, email: person.email },
        household: household
          ? { id: household.id, name: household.name, created_at: household.created_at }
          : null,
      },
    };
  } catch (err: any) {
    return { status: 401, body: { message: "Passkey verification failed" } };
  }
}

// --- Login flow: email fallback ---

export async function handleLoginEmail(
  db: Database.Database,
  body: { email: string }
): Promise<{ status: number; body: any }> {
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return { status: 422, body: { message: "Email is required" } };
  }

  const person = db
    .prepare("SELECT id FROM persons WHERE email = ?")
    .get(email) as any;
  if (!person) {
    return { status: 404, body: { message: "Email not found" } };
  }

  createVerification(db, email, "login");
  return { status: 200, body: { message: "Verification code sent", email } };
}

export async function handleLoginEmailVerify(
  db: Database.Database,
  body: { email: string; code: string }
): Promise<{ status: number; body: any }> {
  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();

  if (!email || !code) {
    return { status: 422, body: { message: "Email and code are required" } };
  }

  const person = db
    .prepare("SELECT * FROM persons WHERE email = ?")
    .get(email) as any;
  if (!person) {
    return { status: 404, body: { message: "Email not found" } };
  }

  const valid = verifyCode(db, email, code, "login");
  if (!valid) {
    return { status: 401, body: { message: "Invalid or expired code" } };
  }

  const household = db
    .prepare("SELECT * FROM households WHERE owner_id = ?")
    .get(person.id) as any;

  const token = await issueJwt(person.id, household?.id || null);

  return {
    status: 200,
    body: {
      token,
      person: { id: person.id, email: person.email },
      household: household
        ? { id: household.id, name: household.name, created_at: household.created_at }
        : null,
    },
  };
}

// --- Invite redeem (unchanged) ---

export async function handleInviteRedeem(
  db: Database.Database,
  body: { invite_token: string }
): Promise<{ status: number; body: any }> {
  try {
    const result = redeemInviteToken(db, body.invite_token);
    const guest = db
      .prepare("SELECT id, name, household_id FROM guests WHERE id = ?")
      .get(result.guestId) as any;

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
      return {
        status: 410,
        body: { message: "This invite has already been used" },
      };
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
