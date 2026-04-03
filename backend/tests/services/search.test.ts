import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { searchChunks } from "../../src/services/search";

function seedWithChunks(db: Database.Database) {
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
    "p1", "owner@test.com", new Date().toISOString()
  );
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    "h1", "p1", "Test Home", new Date().toISOString()
  );
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("d1", "h1", "drive1", "House Doc", "# Full doc", "ready", new Date().toISOString());

  for (let i = 0; i < 10; i++) {
    const embedding = new Float32Array(1536);
    embedding[i] = 1.0;
    db.prepare("INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      `c${i}`, "d1", "h1", i, `Chunk ${i} content about topic ${i}`, new Date().toISOString()
    );
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      `c${i}`, Buffer.from(embedding.buffer)
    );
  }
}

describe("searchChunks", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[1536]
      );
    `);
    seedWithChunks(db);
  });

  it("returns top K chunks for a household sorted by similarity", () => {
    const queryEmbedding = new Float32Array(1536);
    queryEmbedding[3] = 1.0;

    const results = searchChunks(db, "h1", queryEmbedding, 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results[0].chunkId).toBe("c3");
    expect(results[0].text).toContain("Chunk 3");
    expect(results[0].documentId).toBe("d1");
    expect(results[0].documentTitle).toBe("House Doc");
  });

  it("only returns chunks from the specified household", () => {
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p2", "other@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h2", "p2", "Other Home", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h2", "drive2", "Other Doc", "# Other", "ready", new Date().toISOString());

    const embedding = new Float32Array(1536);
    embedding[3] = 1.0;
    db.prepare("INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "other_c", "d2", "h2", 0, "Other household chunk", new Date().toISOString()
    );
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      "other_c", Buffer.from(embedding.buffer)
    );

    const queryEmbedding = new Float32Array(1536);
    queryEmbedding[3] = 1.0;

    const results = searchChunks(db, "h1", queryEmbedding, 5);
    const householdIds = results.map((r) => r.householdId);
    expect(householdIds.every((id) => id === "h1")).toBe(true);
  });
});
