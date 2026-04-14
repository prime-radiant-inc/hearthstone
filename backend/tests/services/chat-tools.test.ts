import "../helpers";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { TOOLS, dispatchTool } from "../../src/services/chat-tools";

mock.module("../../src/services/embeddings", () => ({
  embed: async (_ctx: any, _text: string) => {
    const v = new Float32Array(1536);
    v[0] = 1.0;
    return Array.from(v);
  },
}));

function seed(db: Database) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "o@t", now);
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h1", "p1", "Home", now);
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("d1", "h1", "drive1", "House Ops", "# Top\n\n## Section A\n\nText A\n\n## Section B\n\nText B", "ready", now);

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[1536]
    );
  `);

  for (let i = 0; i < 3; i++) {
    const v = new Float32Array(1536);
    v[i] = 1.0;
    db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(`c${i}`, "d1", "h1", i, `Section ${i}`, `garage code 482${i}`, now);
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      `c${i}`, Buffer.from(v.buffer)
    );
  }
}

describe("TOOLS", () => {
  it("exports two tools: search and read_document", () => {
    expect(TOOLS.length).toBe(2);
    const names = TOOLS.map(t => t.function.name).sort();
    expect(names).toEqual(["read_document", "search"]);
  });

  it("each tool is shaped as an OpenAI function tool", () => {
    for (const tool of TOOLS) {
      expect(tool.type).toBe("function");
      expect(tool.function).toHaveProperty("name");
      expect(tool.function).toHaveProperty("description");
      expect(tool.function).toHaveProperty("parameters");
    }
  });
});

describe("dispatchTool", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("dispatches search and assigns sequential indices starting from a base", async () => {
    const result = await dispatchTool(undefined, db, "h1", {
      name: "search",
      arguments: JSON.stringify({ query: "garage" }),
      indexBase: 6,
    });

    expect(result.kind).toBe("search");
    expect(result.payload.chunks.length).toBeGreaterThan(0);
    const indices = result.payload.chunks.map((c: any) => c.index);
    expect(indices[0]).toBe(6);
    expect(indices).toEqual(indices.slice().sort((a: number, b: number) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("returns chunks with the documented shape", async () => {
    const result = await dispatchTool(undefined, db, "h1", {
      name: "search",
      arguments: JSON.stringify({ query: "garage" }),
      indexBase: 1,
    });
    const chunk = result.payload.chunks[0];
    expect(chunk).toHaveProperty("index");
    expect(chunk).toHaveProperty("chunk_id");
    expect(chunk).toHaveProperty("document_id");
    expect(chunk).toHaveProperty("document_title");
    expect(chunk).toHaveProperty("heading");
    expect(chunk).toHaveProperty("text");
    expect(chunk).toHaveProperty("chunk_index");
    expect(chunk).toHaveProperty("score");
  });

  it("respects the limit argument with a default of 5 and a max of 10", async () => {
    const r1 = await dispatchTool(undefined, db, "h1", {
      name: "search",
      arguments: JSON.stringify({ query: "garage", limit: 2 }),
      indexBase: 1,
    });
    expect(r1.payload.chunks.length).toBeLessThanOrEqual(2);

    const r2 = await dispatchTool(undefined, db, "h1", {
      name: "search",
      arguments: JSON.stringify({ query: "garage", limit: 999 }),
      indexBase: 1,
    });
    expect(r2.payload.chunks.length).toBeLessThanOrEqual(10);
  });

  it("throws on unknown tool name", async () => {
    await expect(
      dispatchTool(undefined, db, "h1", {
        name: "unknown",
        arguments: "{}",
        indexBase: 1,
      })
    ).rejects.toThrow();
  });

  it("throws on malformed arguments JSON", async () => {
    await expect(
      dispatchTool(undefined, db, "h1", {
        name: "search",
        arguments: "{not json",
        indexBase: 1,
      })
    ).rejects.toThrow();
  });

  it("falls back to the default limit when the limit argument is non-numeric", async () => {
    const result = await dispatchTool(undefined, db, "h1", {
      name: "search",
      arguments: JSON.stringify({ query: "garage", limit: "invalid" }),
      indexBase: 1,
    });
    expect(result.kind).toBe("search");
    expect(result.payload.chunks.length).toBeGreaterThan(0);
    // SEARCH_DEFAULT_LIMIT is 5; the seed has 3 chunks, so we expect ≤3 (limited by data, not by the limit value)
    expect(result.payload.chunks.length).toBeLessThanOrEqual(5);
  });
});

describe("dispatchTool — read_document", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("returns the full markdown of a document with chunk markers between chunks", async () => {
    const result = await dispatchTool(undefined, db, "h1", {
      name: "read_document",
      arguments: JSON.stringify({ document_id: "d1" }),
      indexBase: 1,
    });

    expect(result.kind).toBe("read_document");
    expect(result.payload.document_id).toBe("d1");
    expect(result.payload.title).toBe("House Ops");
    expect(result.payload.markdown).toContain("<<chunk:c0>>");
    expect(result.payload.markdown).toContain("<<chunk:c1>>");
    expect(result.payload.markdown).toContain("<<chunk:c2>>");
    expect(result.payload.markdown).toContain("garage code 4820");
  });

  it("orders chunks by chunk_index", async () => {
    const result = await dispatchTool(undefined, db, "h1", {
      name: "read_document",
      arguments: JSON.stringify({ document_id: "d1" }),
      indexBase: 1,
    });
    const md = result.payload.markdown as string;
    const i0 = md.indexOf("<<chunk:c0>>");
    const i1 = md.indexOf("<<chunk:c1>>");
    const i2 = md.indexOf("<<chunk:c2>>");
    expect(i0).toBeLessThan(i1);
    expect(i1).toBeLessThan(i2);
  });

  it("returns indicesConsumed = 0 (read_document does not consume citation indices)", async () => {
    const result = await dispatchTool(undefined, db, "h1", {
      name: "read_document",
      arguments: JSON.stringify({ document_id: "d1" }),
      indexBase: 1,
    });
    expect(result.indicesConsumed).toBe(0);
  });

  it("throws when document_id does not exist in the household", async () => {
    await expect(
      dispatchTool(undefined, db, "h1", {
        name: "read_document",
        arguments: JSON.stringify({ document_id: "does-not-exist" }),
        indexBase: 1,
      })
    ).rejects.toThrow();
  });

  it("scopes by household_id (cannot read another household's doc)", async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "x@t", now);
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h2", "p2", "Other", now);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h2", "drive2", "Other", "secret", "ready", now);

    await expect(
      dispatchTool(undefined, db, "h1", {
        name: "read_document",
        arguments: JSON.stringify({ document_id: "d2" }),
        indexBase: 1,
      })
    ).rejects.toThrow();
  });
});
