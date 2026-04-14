import "../helpers";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";

mock.module("../../src/services/embeddings", () => ({
  embed: async (_ctx: any, _text: string) => {
    const v = new Float32Array(1536);
    v[0] = 1.0;
    return Array.from(v);
  },
}));

import { runChatLoop } from "../../src/services/chat-loop";

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
    ).run(`c${i}`, "d1", "h1", i, "", `chunk ${i} text about garage`, now);
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      `c${i}`, Buffer.from(v.buffer)
    );
  }
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("runChatLoop", () => {
  let db: Database;
  const mockResponses: any[] = [];

  const mockChatComplete = async (_ctx: any, _messages: any, _tools: any) => {
    const next = mockResponses.shift();
    if (!next) throw new Error("no mock response queued");
    return next;
  };

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
    mockResponses.length = 0;
  });

  it("emits a final delta when the model answers without calling any tools", async () => {
    mockResponses.push({ role: "assistant", content: "Garage code is 4820. Sources: [1]", tool_calls: undefined });
    const events = await collect(runChatLoop(undefined, db, "h1", "garage code?", [], { chatComplete: mockChatComplete }));
    const deltas = events.filter(e => e.type === "delta").map(e => (e as any).delta).join("");
    expect(deltas).toContain("Garage code is 4820");
  });

  it("emits a status event for each tool call before the final answer", async () => {
    mockResponses.push({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: JSON.stringify({ query: "weekend bedtime" }) },
      }],
    });
    mockResponses.push({ role: "assistant", content: "Bedtime on weekends is 9pm. Sources: [6]", tool_calls: undefined });

    const events = await collect(runChatLoop(undefined, db, "h1", "bedtime?", [], { chatComplete: mockChatComplete }));
    const statusEvents = events.filter(e => e.type === "status");
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents.some((e: any) => e.status === "searching")).toBe(true);
    expect(statusEvents.some((e: any) => e.query === "weekend bedtime")).toBe(true);
  });

  it("terminates the loop when the model returns no tool_calls", async () => {
    mockResponses.push({ role: "assistant", content: "Done. Sources: [1]", tool_calls: undefined });
    const events = await collect(runChatLoop(undefined, db, "h1", "q", [], { chatComplete: mockChatComplete }));
    expect(events.filter(e => e.type === "delta").length).toBeGreaterThan(0);
  });

  it("terminates when the tool call cap is reached even if the model keeps calling tools", async () => {
    // Queue 5 tool-calling responses + 1 final. Cap is 4 tool calls; the 5th
    // should not be dispatched and the loop should emit a forced final answer.
    for (let i = 0; i < 5; i++) {
      mockResponses.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: `call_${i}`,
          type: "function",
          function: { name: "search", arguments: JSON.stringify({ query: `q${i}` }) },
        }],
      });
    }
    // Forced answer when cap is hit
    mockResponses.push({ role: "assistant", content: "OK final.", tool_calls: undefined });

    const events = await collect(runChatLoop(undefined, db, "h1", "q", [], { chatComplete: mockChatComplete }));
    const statusEvents = events.filter(e => e.type === "status" && (e as any).status === "searching");
    // Seed search is not a status event (it runs synthetically before the loop),
    // so status count is exactly the number of model-issued tool calls = 4 cap.
    expect(statusEvents.length).toBe(4);
  });

  it("seeds the conversation with a synthetic tool_use before the first model call", async () => {
    let receivedMessages: any[] | null = null;
    const captureMock = async (_ctx: any, messages: any[], _tools: any) => {
      receivedMessages = messages;
      return { role: "assistant", content: "ok", tool_calls: undefined };
    };

    await collect(runChatLoop(undefined, db, "h1", "garage", [], { chatComplete: captureMock }));

    expect(receivedMessages).not.toBeNull();
    const msgs = receivedMessages as any[];
    const hasSyntheticAssistant = msgs.some(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls[0]?.function?.name === "search"
    );
    const hasToolResult = msgs.some((m) => m.role === "tool");
    expect(hasSyntheticAssistant).toBe(true);
    expect(hasToolResult).toBe(true);
  });
});
