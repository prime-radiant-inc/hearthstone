// tests/routes/connections.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import {
  handleListConnections,
  handleDeleteConnection,
} from "../../src/routes/connections";

describe("connection routes", () => {
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
  });

  describe("GET /connections", () => {
    it("returns empty list when no connections exist", () => {
      const result = handleListConnections(db, "h1");
      expect(result.status).toBe(200);
      expect(result.body.connections).toHaveLength(0);
    });

    it("returns all connections for household", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("c1", "h1", "google_drive", "rt_abc", "fred@gmail.com", now);

      db.prepare(
        "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("c2", "h1", "google_drive", "rt_def", "jane@gmail.com", now);

      const result = handleListConnections(db, "h1");
      expect(result.status).toBe(200);
      expect(result.body.connections).toHaveLength(2);
      expect(result.body.connections[0].email).toBe("fred@gmail.com");
      // refresh_token should not be exposed in list
      expect(result.body.connections[0].refresh_token).toBeUndefined();
    });

    it("does not return connections for other households", () => {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
        "p2", "other@test.com", now
      );
      db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "h2", "p2", "Other Home", now
      );
      db.prepare(
        "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("c1", "h2", "google_drive", "rt_abc", "other@gmail.com", now);

      const result = handleListConnections(db, "h1");
      expect(result.status).toBe(200);
      expect(result.body.connections).toHaveLength(0);
    });
  });

  describe("DELETE /connections/:id", () => {
    it("deletes a connection and returns 204", () => {
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("c1", "h1", "google_drive", "rt_abc", "fred@gmail.com", now);

      const result = handleDeleteConnection(db, "h1", "c1");
      expect(result.status).toBe(204);

      const row = db.prepare("SELECT * FROM connections WHERE id = ?").get("c1");
      expect(row).toBeNull();
    });

    it("returns 404 for nonexistent connection", () => {
      const result = handleDeleteConnection(db, "h1", "nope");
      expect(result.status).toBe(404);
    });

    it("returns 404 when connection belongs to different household", () => {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
        "p2", "other@test.com", now
      );
      db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "h2", "p2", "Other Home", now
      );
      db.prepare(
        "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("c1", "h2", "google_drive", "rt_abc", "other@gmail.com", now);

      const result = handleDeleteConnection(db, "h1", "c1");
      expect(result.status).toBe(404);
    });
  });
});
