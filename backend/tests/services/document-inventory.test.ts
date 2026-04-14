import "../../src/db/setup-sqlite";
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { buildDocumentInventory } from "../../src/services/document-inventory";

function seed(db: Database) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "o@t", now);
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h1", "p1", "Home", now);
}

function addDoc(db: Database, id: string, title: string, chunkCount: number) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, "h1", `drive-${id}`, title, "# Doc", "ready", now);
  for (let i = 0; i < chunkCount; i++) {
    db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(`${id}-c${i}`, id, "h1", i, "", `chunk ${i}`, now);
  }
}

describe("buildDocumentInventory", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("returns an empty inventory for a household with no documents", () => {
    const inv = buildDocumentInventory(db, "h1");
    expect(inv).toBe("Available documents in this household: (none)");
  });

  it("lists documents with id and chunk count", () => {
    addDoc(db, "d1", "House Operations", 18);
    addDoc(db, "d2", "Kid Routines", 12);

    const inv = buildDocumentInventory(db, "h1");
    expect(inv).toContain("Available documents in this household:");
    expect(inv).toContain('"House Operations"');
    expect(inv).toContain("id: d1");
    expect(inv).toContain("18 chunks");
    expect(inv).toContain('"Kid Routines"');
    expect(inv).toContain("id: d2");
    expect(inv).toContain("12 chunks");
  });

  it("only includes documents in status='ready'", () => {
    const now = new Date().toISOString();
    addDoc(db, "d1", "Ready Doc", 5);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h1", "drive-d2", "Indexing Doc", "# Doc", "indexing", now);

    const inv = buildDocumentInventory(db, "h1");
    expect(inv).toContain("Ready Doc");
    expect(inv).not.toContain("Indexing Doc");
  });

  it("scopes by household_id", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "x@t", now);
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h2", "p2", "Other", now);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d99", "h2", "drive99", "Other Home Doc", "# Doc", "ready", now);

    const inv = buildDocumentInventory(db, "h1");
    expect(inv).not.toContain("Other Home Doc");
  });
});
