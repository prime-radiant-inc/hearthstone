import "../../src/db/setup-sqlite";
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { indexDocument, refreshDocument } from "../../src/services/indexer";

describe("indexer", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[1536]
      );
    `);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
      "h1", "Test Home", new Date().toISOString()
    );
  });

  it("stores chunks and embeddings for a new document", async () => {
    const fakeEmbed = async (ctx: any, texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random()));

    await indexDocument(undefined, db, {
      documentId: "d1",
      householdId: "h1",
      driveFileId: "drive1",
      title: "Test Doc",
      markdown: "## Section 1\nContent here. " + "Details about section one. ".repeat(10) + "\n\n## Section 2\nMore content. " + "Details about section two. ".repeat(10),
      embedBatch: fakeEmbed,
    });

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1") as any;
    expect(doc.status).toBe("ready");
    expect(doc.chunk_count).toBe(2);

    const chunks = db.prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index").all("d1") as any[];
    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading).toBe("Section 1");
    expect(chunks[0].text).toContain("Content here");
    expect(chunks[1].heading).toBe("Section 2");
    expect(chunks[1].text).toContain("More content");
  });

  it("atomically replaces chunks on refresh", async () => {
    const fakeEmbed = async (ctx: any, texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random()));

    await indexDocument(undefined, db, {
      documentId: "d1",
      householdId: "h1",
      driveFileId: "drive1",
      title: "Test Doc",
      markdown: "## Section 1\nOld content.",
      embedBatch: fakeEmbed,
    });

    await refreshDocument(undefined, db, {
      documentId: "d1",
      householdId: "h1",
      markdown: "## New Section\nNew content. " + "New section details here. ".repeat(10) + "\n\n## Another\nMore new. " + "Another section details. ".repeat(10),
      embedBatch: fakeEmbed,
    });

    const chunks = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all("d1") as any[];
    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading).toBe("New Section");
    expect(chunks[0].text).toContain("New content");

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1") as any;
    expect(doc.chunk_count).toBe(2);
  });
});
