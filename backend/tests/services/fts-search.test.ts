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

import { ftsSearch } from "../../src/services/fts-search";

describe("ftsSearch", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
    insertChunk(db, "c1", "The garage code is 4827", "Access");
    insertChunk(db, "c2", "Bedtime is 8pm on weeknights", "Kids > Bedtime");
    insertChunk(db, "c3", "Trash pickup is Tuesday morning", "House");
  });

  it("returns chunks matching a literal token, ranked by relevance", () => {
    const results = ftsSearch(db, "h1", "garage", 5);
    expect(results.length).toBe(1);
    expect(results[0].chunkId).toBe("c1");
    expect(results[0].text).toContain("garage");
  });

  it("returns multiple results when several chunks match", () => {
    insertChunk(db, "c4", "Garage door opener is on the fridge", "House");
    const results = ftsSearch(db, "h1", "garage", 5);
    expect(results.length).toBe(2);
    expect(results.map(r => r.chunkId).sort()).toEqual(["c1", "c4"]);
  });

  it("scopes by household_id", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "x@t", now);
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h2", "p2", "Other", now);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h2", "drive2", "Other Doc", "# Doc", "ready", now);
    db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("c99", "d2", "h2", 0, "", "garage code is 1111", now);

    const h1Results = ftsSearch(db, "h1", "garage", 5);
    const h2Results = ftsSearch(db, "h2", "garage", 5);
    expect(h1Results.map(r => r.chunkId)).toEqual(["c1"]);
    expect(h2Results.map(r => r.chunkId)).toEqual(["c99"]);
  });

  it("returns empty array when no matches", () => {
    const results = ftsSearch(db, "h1", "spaceship", 5);
    expect(results.length).toBe(0);
  });

  it("populates the SearchResult shape", () => {
    const results = ftsSearch(db, "h1", "garage", 5);
    const r = results[0];
    expect(r.chunkId).toBe("c1");
    expect(r.documentId).toBe("d1");
    expect(r.documentTitle).toBe("House Ops");
    expect(r.heading).toBe("Access");
    expect(r.text).toBe("The garage code is 4827");
    expect(r.householdId).toBe("h1");
    expect(typeof r.distance).toBe("number");
  });
});
