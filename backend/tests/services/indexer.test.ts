import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { indexDocument, refreshDocument } from "../../src/services/indexer";

describe("indexer", () => {
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
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh_tok", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  it("stores chunks and embeddings for a new document", async () => {
    const fakeEmbed = async (texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random()));

    await indexDocument(db, {
      documentId: "d1",
      householdId: "h1",
      driveFileId: "drive1",
      title: "Test Doc",
      markdown: "## Section 1\nContent here.\n\n## Section 2\nMore content.",
      embedBatch: fakeEmbed,
    });

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1") as any;
    expect(doc.status).toBe("ready");
    expect(doc.chunk_count).toBe(2);

    const chunks = db.prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index").all("d1") as any[];
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("Section 1");
    expect(chunks[1].text).toContain("Section 2");
  });

  it("atomically replaces chunks on refresh", async () => {
    const fakeEmbed = async (texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random()));

    await indexDocument(db, {
      documentId: "d1",
      householdId: "h1",
      driveFileId: "drive1",
      title: "Test Doc",
      markdown: "## Section 1\nOld content.",
      embedBatch: fakeEmbed,
    });

    await refreshDocument(db, {
      documentId: "d1",
      householdId: "h1",
      markdown: "## New Section\nNew content.\n\n## Another\nMore new.",
      embedBatch: fakeEmbed,
    });

    const chunks = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all("d1") as any[];
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("New Section");

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1") as any;
    expect(doc.chunk_count).toBe(2);
  });
});
