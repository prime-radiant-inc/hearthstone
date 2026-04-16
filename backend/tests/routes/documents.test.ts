// tests/routes/documents.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";
import { handleListDocuments, handleDeleteDocument, handleGetContent } from "../../src/routes/documents";

describe("document routes", () => {
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

  describe("GET /documents", () => {
    it("lists all documents for household", () => {
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("d1", "h1", "drive1", "House Ops", "# Ops", "ready", 5, new Date().toISOString());

      const result = handleListDocuments(db, "h1");
      expect(result.body.documents).toHaveLength(1);
      expect(result.body.documents[0].title).toBe("House Ops");
      expect(result.body.documents[0].chunk_count).toBe(5);
    });
  });

  describe("DELETE /documents/:id", () => {
    it("removes document and returns 204", () => {
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("d1", "h1", "drive1", "House Ops", "# Ops", "ready", new Date().toISOString());

      const result = handleDeleteDocument(db, "h1", "d1");
      expect(result.status).toBe(204);

      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1");
      expect(doc).toBeNull();
    });

    it("returns 404 for nonexistent document", () => {
      const result = handleDeleteDocument(db, "h1", "nope");
      expect(result.status).toBe(404);
    });
  });

  describe("GET /documents/:id/content", () => {
    it("returns cached markdown", () => {
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("d1", "h1", "drive1", "House Ops", "## Emergency Contacts\n| Name | Phone |", "ready", new Date().toISOString());

      const result = handleGetContent(db, "h1", "d1");
      expect(result.status).toBe(200);
      expect(result.body.title).toBe("House Ops");
      expect(result.body.markdown).toContain("Emergency Contacts");
    });
  });
});
