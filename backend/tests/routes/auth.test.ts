// tests/routes/auth.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleInviteRedeem } from "../../src/routes/auth";
import { generateInviteToken } from "../../src/services/tokens";

describe("POST /auth/invite/redeem", () => {
  let db: Database.Database;

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
