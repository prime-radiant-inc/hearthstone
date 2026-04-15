import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { authenticateGuest } from "../../src/middleware/guest-auth";
import { generateToken, revokeGuestTokens } from "../../src/services/tokens";
import { generateId } from "../../src/utils";

function issueSessionToken(db: Database, householdId: string, guestId: string): string {
  const token = generateToken("hss_");
  db.prepare(
    "INSERT INTO session_tokens (id, token, household_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(generateId(), token, householdId, guestId, new Date().toISOString());
  return token;
}

describe("guest auth middleware", () => {
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
    ).run("g1", "h1", "Maria", "maria@test.com", "email", "active", new Date().toISOString());
  });

  it("returns guest info for valid hss_ token", () => {
    const token = issueSessionToken(db, "h1", "g1");
    const result = authenticateGuest(db, `Bearer ${token}`);
    expect(result.guestId).toBe("g1");
    expect(result.householdId).toBe("h1");
  });

  it("throws for revoked token", () => {
    const token = issueSessionToken(db, "h1", "g1");
    revokeGuestTokens(db, "g1");
    expect(() => authenticateGuest(db, `Bearer ${token}`)).toThrow("session_expired");
  });

  it("throws for missing header", () => {
    expect(() => authenticateGuest(db, undefined)).toThrow("unauthorized");
  });
});
