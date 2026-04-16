import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import {
  generateToken,
  validateSessionToken,
  revokeGuestTokens,
} from "../../src/services/tokens";
import { generateId } from "../../src/utils";

function seedHousehold(db: Database) {
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
    "p1", "owner@test.com", new Date().toISOString()
  );
  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
    "h1", "Test Home", new Date().toISOString()
  );
  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("g1", "h1", "Maria", "maria@test.com", "email", "active", new Date().toISOString());
}

function issueSessionToken(db: Database, householdId: string, guestId: string): string {
  const token = generateToken("hss_");
  db.prepare(
    "INSERT INTO session_tokens (id, token, household_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(generateId(), token, householdId, guestId, new Date().toISOString());
  return token;
}

describe("token service", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    seedHousehold(db);
  });

  describe("generateToken", () => {
    it("returns a token with the requested prefix", () => {
      expect(generateToken("hss_")).toMatch(/^hss_/);
      expect(generateToken("foo_")).toMatch(/^foo_/);
    });
  });

  describe("validateSessionToken", () => {
    it("returns guest and household for a live hss_ token", () => {
      const token = issueSessionToken(db, "h1", "g1");
      const result = validateSessionToken(db, token);
      expect(result?.guestId).toBe("g1");
      expect(result?.householdId).toBe("h1");
    });

    it("returns null for a revoked token", () => {
      const token = issueSessionToken(db, "h1", "g1");
      revokeGuestTokens(db, "g1");
      expect(validateSessionToken(db, token)).toBeNull();
    });

    it("returns null for an unknown token", () => {
      expect(validateSessionToken(db, "hss_unknown")).toBeNull();
    });
  });

  describe("revokeGuestTokens", () => {
    it("marks live session tokens revoked and flips guest status", () => {
      issueSessionToken(db, "h1", "g1");
      const revokedAt = revokeGuestTokens(db, "g1");
      expect(revokedAt).toBeTruthy();

      const guest = db.prepare("SELECT status FROM guests WHERE id = ?").get("g1") as any;
      expect(guest.status).toBe("revoked");
    });
  });
});
