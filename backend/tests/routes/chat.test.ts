// tests/routes/chat.test.ts
import "../helpers";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { handleGetSuggestions } from "../../src/routes/chat";

describe("chat routes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  describe("GET /chat/suggestions", () => {
    it("returns empty array when no suggestions exist", () => {
      const result = handleGetSuggestions(db, "h1");
      expect(result.body.suggestions).toEqual([]);
    });

    it("returns stored suggestions", () => {
      db.prepare("INSERT INTO suggestions (id, household_id, chips, created_at) VALUES (?, ?, ?, ?)").run(
        "s1", "h1", JSON.stringify(["What's the WiFi?", "Where are the keys?"]), new Date().toISOString()
      );

      const result = handleGetSuggestions(db, "h1");
      expect(result.body.suggestions).toHaveLength(2);
      expect(result.body.suggestions[0]).toBe("What's the WiFi?");
    });
  });
});

mock.module("../../src/services/embeddings", () => ({
  embed: async (_ctx: any, _text: string) => {
    const v = new Float32Array(1536);
    v[0] = 1.0;
    return Array.from(v);
  },
}));

import { handleChat } from "../../src/routes/chat";

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
    ).run(`c${i}`, "d1", "h1", i, "", `garage code 482${i}`, now);
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      `c${i}`, Buffer.from(v.buffer)
    );
  }
}

async function readSseEvents(response: Response): Promise<any[]> {
  const text = await response.text();
  const events: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") {
      events.push({ done: true });
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      // ignore
    }
  }
  return events;
}

// A programmable fake that returns a single final answer with a citation
// to chunk index 1 (which the seed search will produce from the seeded data).
const fakeChatComplete = async (_ctx: any, _messages: any, _tools: any) => ({
  role: "assistant" as const,
  content: "The garage code is 4820. Sources: [1]",
  tool_calls: undefined,
});

describe("handleChat", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("returns an SSE stream with delta, sources, and [DONE]", async () => {
    const response = await handleChat(
      undefined,
      db,
      "h1",
      { message: "garage code?", history: [] },
      { chatLoopOptions: { chatComplete: fakeChatComplete } }
    );
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSseEvents(response);
    const deltas = events.filter((e) => "delta" in e);
    const sources = events.filter((e) => "sources" in e);
    const done = events.filter((e) => "done" in e);

    expect(deltas.length).toBeGreaterThan(0);
    expect(sources.length).toBe(1);
    expect(done.length).toBe(1);
  });

  it("resolves [1] citation to a source pill from the seeded search", async () => {
    const response = await handleChat(
      undefined,
      db,
      "h1",
      { message: "garage code?", history: [] },
      { chatLoopOptions: { chatComplete: fakeChatComplete } }
    );
    const events = await readSseEvents(response);
    const sourcesEv = events.find((e) => "sources" in e);
    expect(sourcesEv.sources.length).toBe(1);
    const src = sourcesEv.sources[0];
    expect(src).toHaveProperty("document_id");
    expect(src).toHaveProperty("title");
    expect(src).toHaveProperty("chunk_index");
    expect(src.title).toBe("House Ops");
  });

  it("does not leak chunks events to the SSE stream", async () => {
    const response = await handleChat(
      undefined,
      db,
      "h1",
      { message: "garage code?", history: [] },
      { chatLoopOptions: { chatComplete: fakeChatComplete } }
    );
    const events = await readSseEvents(response);
    expect(events.find((e) => "chunks" in e)).toBeUndefined();
  });
});
