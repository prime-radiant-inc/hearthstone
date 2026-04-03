import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { authenticateGuest } from "../../src/middleware/guest-auth";
import { generateInviteToken, redeemInviteToken, revokeGuestTokens } from "../../src/services/tokens";

describe("guest auth middleware", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("g1", "h1", "Maria", "maria@test.com", "email", "pending", new Date().toISOString());
  });

  it("returns guest info for valid hss_ token", () => {
    const invite = generateInviteToken(db, "h1", "g1");
    const session = redeemInviteToken(db, invite.token);
    const result = authenticateGuest(db, `Bearer ${session.token}`);
    expect(result.guestId).toBe("g1");
    expect(result.householdId).toBe("h1");
  });

  it("throws for revoked token", () => {
    const invite = generateInviteToken(db, "h1", "g1");
    const session = redeemInviteToken(db, invite.token);
    revokeGuestTokens(db, "g1");
    expect(() => authenticateGuest(db, `Bearer ${session.token}`)).toThrow("session_expired");
  });

  it("throws for missing header", () => {
    expect(() => authenticateGuest(db, undefined)).toThrow("unauthorized");
  });
});
