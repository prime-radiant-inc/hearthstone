// tests/routes/auth.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import {
  handleRegister,
  handleRegisterVerify,
  handleLoginEmail,
  handleLoginEmailVerify,
  handleLoginPasskeyChallenge,
  handleInviteRedeem,
} from "../../src/routes/auth";
import { generateInviteToken } from "../../src/services/tokens";

// --- Registration flow ---

describe("POST /auth/register", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("sends verification code for valid email", async () => {
    const result = await handleRegister(db, { email: "alice@test.com" });
    expect(result.status).toBe(200);
    expect(result.body.message).toBe("Verification code sent");
    expect(result.body.email).toBe("alice@test.com");
  });

  it("returns 422 for invalid email", async () => {
    const result = await handleRegister(db, { email: "not-an-email" });
    expect(result.status).toBe(422);
  });

  it("returns 422 for empty email", async () => {
    const result = await handleRegister(db, { email: "" });
    expect(result.status).toBe(422);
  });

  it("returns 409 if email already exists", async () => {
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "alice@test.com", new Date().toISOString()
    );
    const result = await handleRegister(db, { email: "alice@test.com" });
    expect(result.status).toBe(409);
  });

  it("normalizes email to lowercase", async () => {
    const result = await handleRegister(db, { email: "Alice@Test.COM" });
    expect(result.status).toBe(200);
    expect(result.body.email).toBe("alice@test.com");
  });
});

describe("POST /auth/register/verify", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("creates a person and returns JWT on valid code", async () => {
    // First send a code
    await handleRegister(db, { email: "alice@test.com" });

    // Get the code from the DB
    const row = db
      .prepare("SELECT code FROM email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1")
      .get("alice@test.com") as any;

    const result = await handleRegisterVerify(db, {
      email: "alice@test.com",
      code: row.code,
    });
    expect(result.status).toBe(200);
    expect(result.body.token).toBeTruthy();
    expect(result.body.person.email).toBe("alice@test.com");
    expect(result.body.household).toBeNull();
    expect(result.body.is_new).toBe(true);

    // Person should exist in DB
    const person = db
      .prepare("SELECT * FROM persons WHERE email = ?")
      .get("alice@test.com") as any;
    expect(person).toBeTruthy();
  });

  it("returns 401 for wrong code", async () => {
    await handleRegister(db, { email: "alice@test.com" });
    const result = await handleRegisterVerify(db, {
      email: "alice@test.com",
      code: "000000",
    });
    expect(result.status).toBe(401);
  });

  it("returns 422 for missing fields", async () => {
    const result = await handleRegisterVerify(db, {
      email: "",
      code: "",
    });
    expect(result.status).toBe(422);
  });
});

// --- Login flow: email ---

describe("POST /auth/login/email", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "alice@test.com", new Date().toISOString()
    );
  });

  it("sends verification code for existing user", async () => {
    const result = await handleLoginEmail(db, { email: "alice@test.com" });
    expect(result.status).toBe(200);
    expect(result.body.message).toBe("Verification code sent");
  });

  it("returns 404 for unknown email", async () => {
    const result = await handleLoginEmail(db, { email: "nobody@test.com" });
    expect(result.status).toBe(404);
  });
});

describe("POST /auth/login/email/verify", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "alice@test.com", new Date().toISOString()
    );
  });

  it("issues JWT for valid login code", async () => {
    await handleLoginEmail(db, { email: "alice@test.com" });
    const row = db
      .prepare("SELECT code FROM email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1")
      .get("alice@test.com") as any;

    const result = await handleLoginEmailVerify(db, {
      email: "alice@test.com",
      code: row.code,
    });
    expect(result.status).toBe(200);
    expect(result.body.token).toBeTruthy();
    expect(result.body.person.id).toBe("p1");
    expect(result.body.person.email).toBe("alice@test.com");
  });

  it("includes household if exists", async () => {
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
    await handleLoginEmail(db, { email: "alice@test.com" });
    const row = db
      .prepare("SELECT code FROM email_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1")
      .get("alice@test.com") as any;

    const result = await handleLoginEmailVerify(db, {
      email: "alice@test.com",
      code: row.code,
    });
    expect(result.status).toBe(200);
    expect(result.body.household.id).toBe("h1");
    expect(result.body.household.name).toBe("Test Home");
  });

  it("returns 401 for wrong code", async () => {
    await handleLoginEmail(db, { email: "alice@test.com" });
    const result = await handleLoginEmailVerify(db, {
      email: "alice@test.com",
      code: "000000",
    });
    expect(result.status).toBe(401);
  });

  it("returns 404 for unknown email", async () => {
    const result = await handleLoginEmailVerify(db, {
      email: "nobody@test.com",
      code: "123456",
    });
    expect(result.status).toBe(404);
  });
});

// --- Login flow: passkey ---

describe("POST /auth/login/passkey/challenge", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("returns 404 for unknown email", async () => {
    const result = await handleLoginPasskeyChallenge(db, { email: "nobody@test.com" });
    expect(result.status).toBe(404);
  });

  it("returns 404 if no passkeys registered", async () => {
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "alice@test.com", new Date().toISOString()
    );
    const result = await handleLoginPasskeyChallenge(db, { email: "alice@test.com" });
    expect(result.status).toBe(404);
    expect(result.body.message).toBe("No passkeys registered");
  });

  it("returns authentication options when passkeys exist", async () => {
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "alice@test.com", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO passkey_credentials (id, person_id, credential_id, public_key, counter, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("cred1", "p1", "cred-id-abc", "AQID", 0, new Date().toISOString());

    const result = await handleLoginPasskeyChallenge(db, { email: "alice@test.com" });
    expect(result.status).toBe(200);
    expect(result.body.authentication_options).toBeTruthy();
    expect(result.body.authentication_options.challenge).toBeTruthy();
  });
});

// --- Invite redeem (unchanged) ---

describe("POST /auth/invite/redeem", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("g1", "h1", "Maria", "maria@test.com", "email", "pending", new Date().toISOString());
  });

  it("returns hss_ token and guest info for valid invite", async () => {
    const invite = generateInviteToken(db, "h1", "g1");
    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(200);
    expect(result.body.session_token).toMatch(/^hss_/);
    expect(result.body.guest.id).toBe("g1");
    expect(result.body.guest.name).toBe("Maria");
  });

  it("returns 410 for used token", async () => {
    const invite = generateInviteToken(db, "h1", "g1");
    await handleInviteRedeem(db, { invite_token: invite.token });
    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(410);
    expect(result.body.message).toBe("This invite has already been used");
  });

  it("returns 410 for expired token", async () => {
    const invite = generateInviteToken(db, "h1", "g1");
    db.prepare("UPDATE invite_tokens SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      invite.token
    );
    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(410);
    expect(result.body.message).toBe("This invite has expired");
  });

  it("returns 404 for unknown token", async () => {
    const result = await handleInviteRedeem(db, { invite_token: "hsi_fake" });
    expect(result.status).toBe(404);
  });
});
