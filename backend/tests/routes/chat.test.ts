// tests/routes/chat.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { handleGetSuggestions } from "../../src/routes/chat";

describe("chat routes", () => {
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
  });

  describe("GET /chat/suggestions", () => {
    it("returns empty array when no suggestions exist", () => {
      const result = handleGetSuggestions(db, "h1");
      expect(result.body.suggestions).toEqual([]);
    });

    it("returns stored suggestions", () => {
      db.prepare("INSERT INTO suggestions (id, household_id, chips, created_at) VALUES (?, ?, ?, ?)").run(
        "s1", "h1", JSON.stringify(["What's the WiFi?", "Where are the keys?"]), new Date().toISOString()
      );

      const result = handleGetSuggestions(db, "h1");
      expect(result.body.suggestions).toHaveLength(2);
      expect(result.body.suggestions[0]).toBe("What's the WiFi?");
    });
  });
});
