// tests/routes/guests.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleDeleteGuest } from "../../src/routes/guests";

describe("guest routes", () => {
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
  });

  describe("POST /guests", () => {
    it("creates a guest with pending status and returns magic link", async () => {
      const result = await handleCreateGuest(db, "h1", {
        name: "Maria",
        email: "maria@test.com",
        phone: null,
      });
      expect(result.status).toBe(200);
      expect(result.body.guest.name).toBe("Maria");
      expect(result.body.guest.status).toBe("pending");
      expect(result.body.magic_link).toContain("hsi_");
      expect(result.body.invite_token).toMatch(/^hsi_/);
    });

    it("returns 422 when name is missing", async () => {
      const result = await handleCreateGuest(db, "h1", {
        name: "",
        email: "maria@test.com",
        phone: null,
      });
      expect(result.status).toBe(422);
    });

    it("returns 422 when neither email nor phone provided", async () => {
      const result = await handleCreateGuest(db, "h1", {
        name: "Maria",
        email: null,
        phone: null,
      });
      expect(result.status).toBe(422);
    });
  });

  describe("GET /guests", () => {
    it("lists all guests for the household", async () => {
      await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      await handleCreateGuest(db, "h1", { name: "James", email: "james@test.com", phone: null });
      const result = handleListGuests(db, "h1");
      expect(result.body.guests).toHaveLength(2);
    });
  });

  describe("POST /guests/:id/revoke", () => {
    it("revokes an active guest", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;

      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);

      const result = handleRevokeGuest(db, "h1", guestId);
      expect(result.status).toBe(200);
      expect(result.body.revoked_at).toBeTruthy();
    });

    it("returns 409 for already-revoked guest", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);

      handleRevokeGuest(db, "h1", guestId);
      const result = handleRevokeGuest(db, "h1", guestId);
      expect(result.status).toBe(409);
    });
  });

  describe("DELETE /guests/:id", () => {
    it("deletes a revoked guest", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);
      handleRevokeGuest(db, "h1", guestId);

      const result = handleDeleteGuest(db, "h1", guestId);
      expect(result.status).toBe(204);
    });

    it("returns 409 if guest is still active", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);

      const result = handleDeleteGuest(db, "h1", guestId);
      expect(result.status).toBe(409);
    });
  });
});
