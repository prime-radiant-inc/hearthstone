import "../../src/db/setup-sqlite";
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";

function seed(db: Database) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "o@t", now);
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h1", "p1", "Home", now);
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("d1", "h1", "drive1", "House Ops", "# Doc", "ready", now);
}

function insertChunk(db: Database, id: string, text: string, heading: string = "") {
  db.prepare(
    "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, "d1", "h1", 0, heading, text, new Date().toISOString());
}

describe("chunks_fts virtual table", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("indexes inserted chunks", () => {
    insertChunk(db, "c1", "The garage code is 4827", "Access");
    const rows = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?").all("garage") as any[];
    expect(rows.length).toBe(1);
  });

  it("removes deleted chunks from the index", () => {
    insertChunk(db, "c1", "The garage code is 4827", "Access");
    db.prepare("DELETE FROM chunks WHERE id = ?").run("c1");
    const rows = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?").all("garage") as any[];
    expect(rows.length).toBe(0);
  });

  it("updates the index when a chunk is updated", () => {
    insertChunk(db, "c1", "The garage code is 4827", "Access");
    db.prepare("UPDATE chunks SET text = ? WHERE id = ?").run("The basement code is 9999", "c1");
    const oldHits = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?").all("garage") as any[];
    const newHits = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?").all("basement") as any[];
    expect(oldHits.length).toBe(0);
    expect(newHits.length).toBe(1);
  });
});
