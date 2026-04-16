import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations";

describe("database schema", () => {
  it("creates all required tables", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("persons");
    expect(tables).toContain("households");
    expect(tables).toContain("guests");
    expect(tables).toContain("session_tokens");
    expect(tables).toContain("auth_pins");
    expect(tables).toContain("household_members");
    expect(tables).toContain("documents");
    expect(tables).toContain("chunks");
  });

  it("enforces household_id foreign key on guests", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    expect(() => {
      db.prepare(
        "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("g1", "nonexistent", "Test", "test@test.com", "email", "pending", new Date().toISOString());
    }).toThrow();
  });

  it("scopes documents to household_id", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
      "h1", "Test Home", new Date().toISOString()
    );

    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d1", "h1", "drive123", "Test Doc", "# Hello", "ready", new Date().toISOString());

    const doc = db.prepare("SELECT * FROM documents WHERE household_id = ?").get("h1") as any;
    expect(doc.title).toBe("Test Doc");
  });
});
