import type { Database } from "bun:sqlite";
import { chatCompleteWithTools, type LoopMessage, type AssistantMessage } from "./chat-provider";
import { TOOLS, dispatchTool, type ToolResult } from "./chat-tools";
import { runHybridSearch } from "./hybrid-search";
import { buildDocumentInventory } from "./document-inventory";
import { buildToolCallSystemPrompt } from "./prompt";
import { startSpan, SpanStatusCode, type Context } from "../tracing";

const MAX_TOOL_CALLS = 4;
const SEED_LIMIT = 5;

export interface RunChatLoopOptions {
  /**
   * Override the OpenAI tool-call function. Used in tests to inject a
   * programmable mock without globally mocking the chat-provider module
   * (which leaks across test files).
   */
  chatComplete?: typeof chatCompleteWithTools;
}

export interface ChunkRef {
  index: number;
  chunk_id: string;
  document_id: string;
  title: string;
  chunk_index: number;
}

export type ChatLoopEvent =
  | { type: "delta"; delta: string }
  | { type: "status"; status: "searching" | "reading" | "thinking"; query?: string; document_id?: string; title?: string }
  | { type: "chunks"; chunks: ChunkRef[] };

interface HistoryItem {
  role: string;
  content: string;
}

export async function* runChatLoop(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  userMessage: string,
  history: HistoryItem[],
  options: RunChatLoopOptions = {}
): AsyncGenerator<ChatLoopEvent> {
  const chatComplete = options.chatComplete ?? chatCompleteWithTools;
  const span = startSpan("chat.loop", ctx);
  try {
    // 1. System prompt with document inventory
    const inventory = buildDocumentInventory(db, householdId);
    const system = buildToolCallSystemPrompt(inventory);

    // 2. Seed search using the existing pipeline. This is the synthetic
    // tool_use — no model call, just pre-fetched chunks presented as if
    // the model had called search() with the user's message.
    const seedChunks = await runHybridSearch(ctx, db, householdId, userMessage, SEED_LIMIT);
    const seedToolCallId = "seed_" + crypto.randomUUID().slice(0, 8);
    const seedPayload = {
      chunks: seedChunks.map((r, i) => ({
        index: i + 1,
        chunk_id: r.chunkId,
        document_id: r.documentId,
        document_title: r.documentTitle,
        heading: r.heading,
        text: r.text,
        chunk_index: r.chunkIndex,
        score: r.distance,
      })),
    };
    let nextIndex = seedChunks.length + 1;

    // Publish seed chunk metadata for source-pill resolution downstream.
    yield {
      type: "chunks",
      chunks: seedPayload.chunks.map((c) => ({
        index: c.index,
        chunk_id: c.chunk_id,
        document_id: c.document_id,
        title: c.document_title,
        chunk_index: c.chunk_index,
      })),
    };

    // 3. Build the message list
    const messages: LoopMessage[] = [
      { role: "system", content: system },
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })) as LoopMessage[],
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: seedToolCallId,
          type: "function",
          function: { name: "search", arguments: JSON.stringify({ query: userMessage }) },
        }],
      },
      { role: "tool", tool_call_id: seedToolCallId, content: JSON.stringify(seedPayload) },
    ];

    // 4. Loop
    let toolCallsRemaining = MAX_TOOL_CALLS;
    while (true) {
      const response: AssistantMessage = await chatComplete(ctx, messages, TOOLS);

      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // Model produced a final answer naturally. Emit and exit.
        if (response.content) {
          yield { type: "delta", delta: response.content };
        }
        return;
      }
      if (toolCallsRemaining === 0) {
        // Cap exhausted — force a text-only final answer with one extra
        // call that has no tools available. Without this, we'd silently
        // return with no delta event because the model is still in
        // tool-calling mode and response.content would be null.
        const finalResponse = await chatComplete(ctx, messages, []);
        if (finalResponse.content) {
          yield { type: "delta", delta: finalResponse.content };
        }
        return;
      }

      messages.push(response);

      for (const call of toolCalls) {
        if (toolCallsRemaining === 0) break;

        // Status event
        if (call.function.name === "search") {
          let q = "";
          try { q = JSON.parse(call.function.arguments)?.query ?? ""; } catch {}
          yield { type: "status", status: "searching", query: q };
        } else if (call.function.name === "read_document") {
          let id = "";
          try { id = JSON.parse(call.function.arguments)?.document_id ?? ""; } catch {}
          const doc = db.prepare("SELECT title FROM documents WHERE id = ? AND household_id = ? AND status = 'ready'").get(id, householdId) as { title: string } | undefined;
          yield { type: "status", status: "reading", document_id: id, title: doc?.title };
        }

        // Dispatch
        let result: ToolResult;
        try {
          result = await dispatchTool(ctx, db, householdId, {
            name: call.function.name,
            arguments: call.function.arguments,
            indexBase: nextIndex,
          });
        } catch (err: any) {
          // Surface the error to the model as a tool result so it can recover
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: err?.message ?? "tool failed" }),
          });
          toolCallsRemaining -= 1;
          continue;
        }

        nextIndex += result.indicesConsumed;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result.payload),
        });

        // Publish chunk metadata so the route can resolve [N] citations.
        if (result.kind === "search") {
          yield {
            type: "chunks",
            chunks: result.payload.chunks.map((c) => ({
              index: c.index,
              chunk_id: c.chunk_id,
              document_id: c.document_id,
              title: c.document_title,
              chunk_index: c.chunk_index,
            })),
          };
        }

        toolCallsRemaining -= 1;
      }
    }
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
