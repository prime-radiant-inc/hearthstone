import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import {
  generateInviteToken,
  redeemInviteToken,
  validateSessionToken,
  revokeGuestTokens,
} from "../../src/services/tokens";

function seedHousehold(db: Database.Database) {
  db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
    "p1", "owner@test.com", "refresh", new Date().toISOString()
  );
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    "h1", "p1", "Test Home", new Date().toISOString()
  );
  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("g1", "h1", "Maria", "maria@test.com", "email", "pending", new Date().toISOString());
}

describe("token service", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    seedHousehold(db);
  });

  describe("generateInviteToken", () => {
    it("creates an hsi_ prefixed token with 7-day expiry", () => {
      const result = generateInviteToken(db, "h1", "g1");
      expect(result.token).toMatch(/^hsi_/);
      const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(result.token) as any;
      expect(row).toBeTruthy();
      expect(row.guest_id).toBe("g1");
      const expiry = new Date(row.expires_at);
      const now = new Date();
      const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });
  });

  describe("redeemInviteToken", () => {
    it("exchanges valid hsi_ for hss_ and marks used", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      const session = redeemInviteToken(db, invite.token);
      expect(session.token).toMatch(/^hss_/);
      expect(session.guestId).toBe("g1");
      expect(session.householdId).toBe("h1");

      const row = db.prepare("SELECT used_at FROM invite_tokens WHERE token = ?").get(invite.token) as any;
      expect(row.used_at).toBeTruthy();

      const guest = db.prepare("SELECT status FROM guests WHERE id = ?").get("g1") as any;
      expect(guest.status).toBe("active");
    });

    it("rejects already-used token with 'already_used' error", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      redeemInviteToken(db, invite.token);
      expect(() => redeemInviteToken(db, invite.token)).toThrow("already_used");
    });

    it("rejects expired token with 'expired' error", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      db.prepare("UPDATE invite_tokens SET expires_at = ? WHERE token = ?").run(
        new Date(Date.now() - 1000).toISOString(),
        invite.token
      );
      expect(() => redeemInviteToken(db, invite.token)).toThrow("expired");
    });

    it("rejects unknown token with 'not_found' error", () => {
      expect(() => redeemInviteToken(db, "hsi_nonexistent")).toThrow("not_found");
    });
  });

  describe("validateSessionToken", () => {
    it("returns guest and household for valid hss_ token", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      const session = redeemInviteToken(db, invite.token);
      const result = validateSessionToken(db, session.token);
      expect(result.guestId).toBe("g1");
      expect(result.householdId).toBe("h1");
    });

    it("returns null for revoked token", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      const session = redeemInviteToken(db, invite.token);
      revokeGuestTokens(db, "g1");
      const result = validateSessionToken(db, session.token);
      expect(result).toBeNull();
    });
  });

  describe("revokeGuestTokens", () => {
    it("sets revoked_at on all session tokens and updates guest status", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      redeemInviteToken(db, invite.token);
      const revokedAt = revokeGuestTokens(db, "g1");
      expect(revokedAt).toBeTruthy();

      const guest = db.prepare("SELECT status FROM guests WHERE id = ?").get("g1") as any;
      expect(guest.status).toBe("revoked");
    });
  });
});
