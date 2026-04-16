// tests/routes/guests.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleDeleteGuest } from "../../src/routes/guests";
import { redeemPin } from "../../src/services/pins";

describe("guest routes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
      "h1", "Test Home", new Date().toISOString()
    );
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run(
      "hm1", "h1", "p1", new Date().toISOString()
    );
  });

  describe("POST /guests", () => {
    it("creates a guest with pending status and returns pin", async () => {
      const result = await handleCreateGuest(db, "h1", "p1", {
        name: "Maria",
        email: "maria@test.com",
      });
      expect(result.status).toBe(200);
      expect(result.body.guest.name).toBe("Maria");
      expect(result.body.guest.status).toBe("pending");
      expect(result.body.pin).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(result.body.expires_at).toBeTruthy();
    });

    it("returns 422 when name is missing", async () => {
      const result = await handleCreateGuest(db, "h1", "p1", {
        name: "",
        email: "maria@test.com",
      });
      expect(result.status).toBe(422);
    });
  });

  describe("GET /guests", () => {
    it("lists all guests for the household", async () => {
      await handleCreateGuest(db, "h1", "p1", { name: "Maria", email: "maria@test.com" });
      await handleCreateGuest(db, "h1", "p1", { name: "James", email: "james@test.com" });
      const result = handleListGuests(db, "h1");
      expect(result.body.guests).toHaveLength(2);
    });
  });

  describe("POST /guests/:id/revoke", () => {
    it("revokes an active guest", async () => {
      const created = await handleCreateGuest(db, "h1", "p1", { name: "Maria", email: "maria@test.com" });
      const guestId = created.body.guest.id;

      // Activate the guest by redeeming the PIN
      redeemPin(db, created.body.pin);

      const result = handleRevokeGuest(db, "h1", guestId);
      expect(result.status).toBe(200);
      expect(result.body.revoked_at).toBeTruthy();
    });

    it("returns 409 for already-revoked guest", async () => {
      const created = await handleCreateGuest(db, "h1", "p1", { name: "Maria", email: "maria@test.com" });
      const guestId = created.body.guest.id;
      redeemPin(db, created.body.pin);

      handleRevokeGuest(db, "h1", guestId);
      const result = handleRevokeGuest(db, "h1", guestId);
      expect(result.status).toBe(409);
    });
  });

  describe("DELETE /guests/:id", () => {
    it("deletes a revoked guest", async () => {
      const created = await handleCreateGuest(db, "h1", "p1", { name: "Maria", email: "maria@test.com" });
      const guestId = created.body.guest.id;
      redeemPin(db, created.body.pin);
      handleRevokeGuest(db, "h1", guestId);

      const result = handleDeleteGuest(db, "h1", guestId);
      expect(result.status).toBe(204);
    });

    it("returns 409 if guest is still active", async () => {
      const created = await handleCreateGuest(db, "h1", "p1", { name: "Maria", email: "maria@test.com" });
      const guestId = created.body.guest.id;
      redeemPin(db, created.body.pin);

      const result = handleDeleteGuest(db, "h1", guestId);
      expect(result.status).toBe(409);
    });
  });
});
