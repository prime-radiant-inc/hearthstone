// Load helpers first to set env vars before config is imported
import "../helpers";
import { describe, it, expect, beforeEach, mock } from "bun:test";

// Stub the embeddings module so tests don't hit OpenAI.
mock.module("../../src/services/embeddings", () => ({
  embed: async (_ctx: any, _text: string) => {
    const v = new Float32Array(1536);
    v[0] = 1.0;
    return Array.from(v);
  },
}));

import "../../src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { runHybridSearch } from "../../src/services/hybrid-search";

function seed(db: Database) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "o@t", now);
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h1", "p1", "Home", now);
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("d1", "h1", "drive1", "House Ops", "# Doc", "ready", now);

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[1536]
    );
  `);

  for (let i = 0; i < 5; i++) {
    const v = new Float32Array(1536);
    v[i] = 1.0;
    db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(`c${i}`, "d1", "h1", i, "", `Chunk ${i} about garage code 482${i}`, now);
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      `c${i}`, Buffer.from(v.buffer)
    );
  }
}

describe("runHybridSearch", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("returns SearchResult-shaped results", async () => {
    const results = await runHybridSearch(undefined, db, "h1", "garage", 5);
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r).toHaveProperty("chunkId");
    expect(r).toHaveProperty("documentId");
    expect(r).toHaveProperty("documentTitle");
    expect(r).toHaveProperty("chunkIndex");
    expect(r).toHaveProperty("heading");
    expect(r).toHaveProperty("text");
    expect(r).toHaveProperty("householdId");
  });

  it("respects the limit", async () => {
    const results = await runHybridSearch(undefined, db, "h1", "garage", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns chunks that match by FTS even when vector would not surface them", async () => {
    // c4's text contains "4824", which only FTS5 would surface for that exact token.
    const results = await runHybridSearch(undefined, db, "h1", "4824", 5);
    expect(results.some(r => r.chunkId === "c4")).toBe(true);
  });

  it("scopes by household_id", async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "x@t", now);
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h2", "p2", "Other", now);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h2", "drive2", "Other", "# Doc", "ready", now);
    db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("c99", "d2", "h2", 0, "", "garage code 1111", now);

    const results = await runHybridSearch(undefined, db, "h1", "garage", 10);
    expect(results.every(r => r.householdId === "h1")).toBe(true);
    expect(results.some(r => r.chunkId === "c99")).toBe(false);
  });
});
