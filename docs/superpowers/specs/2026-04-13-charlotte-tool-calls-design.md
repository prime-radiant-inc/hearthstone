# Charlotte Tool Calls Design

## Goal

Give Charlotte agentic retrieval — the ability to call `search` and `read_document` as tools during a chat turn, and to carry tool results across turns — without regressing the latency or quality of the current pipeline on the easy questions that make up most of the eval. Ship in two phases so Phase A's value can be measured before Phase B's iOS contract changes are paid for.

## Problem

Today's `/chat` flow is a one-shot: embed the user's message, run vector search, jam the top 5 chunks into a system prompt, stream a response. The model gets exactly one swing at retrieval per user message and cannot revisit. Two specific limits fall out of that:

1. **No second strategy when vector search misses.** Embeddings handle paraphrase well and exact tokens (garage codes, brand names, phone numbers) badly. The only escape hatch today is "wait for the user to rephrase the question."
2. **No accumulated context across turns.** Each user message starts retrieval from scratch. If turn 1 retrieved good chunks about bedtime, turn 2's "what about weekends?" has to re-retrieve and may miss material that was right there a moment ago. The chat transcript survives; the chunks that powered it do not.

The eval sits at 99% on the existing 30/39-question set, which is real — but the questions in that set are mostly single-hop and well-suited to vector search. The interesting headroom is on multi-hop questions, exact-token lookups, and follow-ups that build on what was just said.

## Design Decisions

These were settled during brainstorming and are load-bearing for everything below.

- **Two phases.** Phase A: backend-only tool-call loop within a single user message. Phase B: server-stored conversations with tool calls and results persisted across turns. Phase A ships, gets evaluated, then Phase B builds on it. We do not ship B without first measuring A.
- **Two tools, not four.** `search(query, limit?)` is a single hybrid retrieval — vector + FTS5 fused with reciprocal rank fusion in TypeScript, returning chunks. `read_document(document_id)` returns the full markdown of a doc with chunk markers. The model never picks an index strategy; the backend does.
- **Document inventory lives in the system prompt, not a tool.** Titles, IDs, and chunk counts are injected on every `/chat` call. No round trip to enumerate. Households have small document sets and the data is cheap.
- **FTS5 indexes chunks, not raw document text.** Same unit of retrieval as vector search. Both sides of the hybrid return the same `{chunk_id, document_id, chunk_index, heading, text, score}` shape, and the existing source-pill UI in iOS works unchanged.
- **Pre-seed via synthetic `tool_use`.** Every `/chat` call begins with a fabricated assistant turn that "called" `search` with the user's message, plus a `tool_result` containing the chunks the existing pipeline would have fetched. The easy case answers in zero round trips (same latency as today). The model is primed to call `search` again on its own when seeded chunks aren't enough.
- **Status events in SSE.** New event types (`{"status": "searching", "query": "..."}`) flow through the existing stream so iOS can render "Charlotte is searching for *weekend bedtime*..." while round trips happen. No iOS contract change beyond rendering new event types.
- **Hard cap on the loop.** Max 4 tool calls per user message (≈5 model inferences). After the cap, the model is forced to respond with what it has.
- **Phase B uses server-stored conversations.** `conversations` and `conversation_messages` tables, scoped to `household_id`. iOS sends `conversation_id` instead of `history`. Clear-chat becomes `DELETE /conversations/:id`.

## Tools

### `search(query, limit?)`

Hybrid retrieval over the household's chunks. Runs vector search and FTS5 in parallel, fuses with reciprocal rank fusion, returns the top N chunks.

**Arguments:**
- `query` (string, required) — the search query, in the language the user would use
- `limit` (integer, optional, default 5, max 10) — number of chunks to return

**Returns:**
```json
{
  "chunks": [
    {
      "index": 6,
      "chunk_id": "abc123",
      "document_id": "doc-uuid",
      "document_title": "House Operations",
      "heading": "Kids > Bedtime",
      "text": "Bedtime is 8pm on weeknights...",
      "score": 0.87
    }
  ]
}
```

`index` is a monotonically increasing citation number assigned by the chat loop, not by the search service. Each tool result gets the next contiguous block of indices (seed = `[1]`–`[5]`, second `search` call = `[6]`–`[10]`, etc.), so the model can cite via the existing `Sources: [1], [3]` format and the source-extraction regex in the route handler keeps working unchanged.

**Tool description (sent to the model):**
> Use this when you need to find information from the household's documents to answer a question. Works for both concept questions ("when do the kids go to bed") and questions with exact tokens like codes, phone numbers, or brand names ("garage code", "5551234"). You can call this multiple times with different queries if the first results don't fully answer the question. Prefer specific queries over broad ones.

### `read_document(document_id)`

Fetch the full markdown of a single document, with chunk boundary markers preserved so citations still resolve to specific sections.

**Arguments:**
- `document_id` (string, required) — the document's UUID, taken from the document inventory in the system prompt or from a previous `search` result

**Returns:**
```json
{
  "document_id": "doc-uuid",
  "title": "House Operations",
  "markdown": "<<chunk:abc123>>\n## Kids\n### Bedtime\nBedtime is 8pm...\n\n<<chunk:def456>>\n### Wake-up\n..."
}
```

The `<<chunk:id>>` markers are inline so the model can still cite a specific chunk when answering from a full-document read. They are stripped from the rendered markdown if iOS ever needs to display the raw text directly (it does not, in v1).

**Tool description (sent to the model):**
> Use this when search has identified the right document but you need the full structure of it to answer well. Best for questions that need a long list, an ordered procedure, a schedule, or a recipe — anything where the right answer is "the whole section" rather than "a few sentences." Prefer `search` first; only `read_document` when you already know which document is right.

### Document inventory in the system prompt

Injected into every `/chat` call after the existing `RAG_SYSTEM` text:

```
Available documents in this household:
- "House Operations" (id: doc-uuid-1, 18 chunks)
- "Kid Routines" (id: doc-uuid-2, 12 chunks)
- "Emergency Contacts" (id: doc-uuid-3, 4 chunks)
```

Computed on every request from `documents` and `chunks`. No caching in v1 — recomputing is a single SQL query and households have small document sets.

## Phase A — Backend Implementation

### New file: `backend/src/services/chat-loop.ts`

Owns the model loop. Takes a user message, runs the seed + tool loop, streams the final response. Replaces the inline logic in `routes/chat.ts`.

Sketch:

```ts
export async function* runChatLoop(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  userMessage: string,
  history: ChatMessage[]
): AsyncGenerator<ChatLoopEvent> {
  // 1. Build system prompt with document inventory
  const inventory = listDocumentInventory(db, householdId);
  const system = buildSystemPrompt(inventory);

  // 2. Run the seed search and fabricate the synthetic tool_use
  const seedQuery = userMessage;
  const seedChunks = await runHybridSearch(ctx, db, householdId, seedQuery, 5);
  const seedToolCallId = "seed_" + crypto.randomUUID();

  const messages: Message[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userMessage },
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: seedToolCallId,
        type: "function",
        function: { name: "search", arguments: JSON.stringify({ query: seedQuery }) },
      }],
    },
    {
      role: "tool",
      tool_call_id: seedToolCallId,
      content: JSON.stringify({ chunks: seedChunks }),
    },
  ];

  // 3. Loop: model inference, dispatch any tool calls, repeat until model returns plain content or cap is hit
  let toolCallsRemaining = 4;
  while (true) {
    const response = await chatComplete(ctx, messages, TOOLS);

    if (!response.tool_calls?.length || toolCallsRemaining === 0) {
      yield* emitFinalResponse(ctx, messages, response);
      return;
    }

    messages.push(response.assistantMessage);
    for (const toolCall of response.tool_calls) {
      yield { type: "status", status: statusForTool(toolCall), query: extractQuery(toolCall) };
      const result = await dispatchTool(ctx, db, householdId, toolCall);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      toolCallsRemaining -= 1;
    }
  }
}
```

`emitFinalResponse` has two reasonable implementations and the design does not pin one — pick whichever feels right at implementation time:

1. **Emit the already-completed response as a single delta event.** The non-streaming `chatComplete` call already returned the model's final content; just yield it as one `delta` event. Cost: one inference. Tradeoff: iOS sees the full answer at once instead of token by token.
2. **Re-issue as a streaming call.** Pay one extra inference to get character-by-character streaming on the final answer. Cost: two inferences for the final round. Tradeoff: nicer felt UX, modest cost bump.

The status events from the loop already cover the "Charlotte is working" UX, so option 1 is probably fine. Option 2 is available if the felt experience needs it.

We deliberately do not handle OpenAI's streamed tool-call argument deltas. The non-streaming `chatComplete` is used for every round where the model might call a tool, and streaming-with-tool-calls remains unsupported in v1. Status events are the streaming surface during the loop.

### Updated: `backend/src/services/chat-provider.ts`

Grows two functions alongside the existing `chat()` streaming generator:

- `chatComplete(ctx, messages, tools)` — non-streaming completion that supports tool definitions and returns the full response message including any `tool_calls`. Used inside the loop for the rounds where the model might call a tool.
- `chat(ctx, messages, tools?)` — the existing streaming generator, now optionally accepts tools. The tool-call loop only uses it for the final round (after the model has decided not to call any more tools), so streaming-with-tool-calls remains unsupported in v1.

Both go through the same OpenAI client. Both have OTel spans. The `chat-loop` service is the only caller that uses tools.

### New file: `backend/src/services/hybrid-search.ts`

Wraps the existing `searchChunks` (vector) plus a new `ftsSearch` and fuses with reciprocal rank fusion. Returns the same `SearchResult` shape `searchChunks` uses today, so downstream code (source pills, contract tests) doesn't care how a result was found.

Sketch:

```ts
export async function runHybridSearch(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const queryEmbedding = await embed(ctx, query);
  const queryVec = new Float32Array(queryEmbedding);

  const [vectorResults, ftsResults] = await Promise.all([
    Promise.resolve(searchChunks(db, householdId, queryVec, limit * 2)),
    Promise.resolve(ftsSearch(db, householdId, query, limit * 2)),
  ]);

  return reciprocalRankFusion(vectorResults, ftsResults, limit);
}
```

RRF constant `k = 60` (the standard default). Fusion is a few lines of TypeScript: walk both ranked lists, accumulate `1 / (k + rank)` per chunk_id, sort by score, return the top N.

### Database changes

One migration adds the FTS5 virtual table and triggers:

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, heading,
  content='chunks',
  content_rowid='rowid'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, heading)
  VALUES (new.rowid, new.text, new.heading);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
  VALUES('delete', old.rowid, old.text, old.heading);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
  VALUES('delete', old.rowid, old.text, old.heading);
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
  VALUES (new.rowid, new.text, new.heading);
END;

INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
```

The `rebuild` line backfills FTS5 from the existing `chunks` rows. After the migration, the chunker and indexer don't need to know FTS5 exists — the triggers handle sync.

The `chunks` table schema is unchanged. `household_id` filtering happens in the FTS5 query path the same way it does for vector search:

```sql
SELECT c.id, c.document_id, c.chunk_index, c.heading, c.text, d.title AS document_title
FROM chunks_fts
JOIN chunks c    ON c.rowid = chunks_fts.rowid
JOIN documents d ON d.id = c.document_id
WHERE chunks_fts MATCH ? AND c.household_id = ?
ORDER BY rank
LIMIT ?
```

### Updated: `backend/src/routes/chat.ts`

Becomes a thin wrapper. Parses the request, calls `runChatLoop`, pumps events into the SSE stream:

```ts
for await (const event of runChatLoop(ctx, db, householdId, body.message, body.history)) {
  if (event.type === "status") {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: event.status, query: event.query })}\n\n`));
  } else if (event.type === "delta") {
    fullResponse += event.delta;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: event.delta })}\n\n`));
  }
}
// existing source extraction + sources event + [DONE]
```

The source extraction logic stays: regex `Sources: [1], [3]` out of the full response. Chunks are renumbered as they arrive across the loop — the seed gets `[1]`–`[5]`, the next `search` call gets `[6]`–`[N]`, and so on. The numbering is maintained inside `chat-loop` as it builds up the visible-to-the-model index. The model never knows there's a stitching layer underneath.

### Tool descriptions are decision rules

The `search` and `read_document` descriptions above are written as decision rules ("Use this when…"), not API documentation. This is deliberate. The model already knows what `search_chunks` does from the name and signature; what it needs from the description is "when should I reach for this instead of the other one." Both descriptions reference each other where the choice is non-obvious.

### Observability

Each tool call gets its own OTel span as a child of the chat span:

- `chat.loop.iteration` — one per loop turn, with attributes for tool count and remaining budget
- `chat.tool.search` — one per `search` call, with attributes for query, fused chunk count, vector hits, FTS hits
- `chat.tool.read_document` — one per `read_document` call, with the doc_id and chunk count

This is the debugging surface that makes the loop legible after the fact.

## Phase A — API and Spec Changes

### `.brainstorm/spec.md`

The `POST /chat` endpoint gains new SSE event types. The request and response shapes are otherwise unchanged.

New events in the SSE stream:

```
data: {"status": "searching", "query": "weekend bedtime"}
data: {"status": "reading", "document_id": "doc-uuid", "title": "House Operations"}
data: {"status": "thinking"}
```

Order: arbitrary number of `status` events interleaved with eventual `delta` events, then `sources`, then `[DONE]`. iOS treats unknown event types as no-ops, so older clients still work.

### Contract tests

`tests/api-contract.test.ts` adds:
- A test that asserts `status` events have exactly the documented fields
- A test that the existing `delta`/`sources`/`[DONE]` shape is unchanged
- A test that the seed search runs even when the model would not have called `search` on its own (verified by intercepting the OpenAI client)

## Phase A — Eval Gate

Phase B does not start until Phase A clears two bars on the eval harness:

1. **No regression on the existing eval set.** Per-question scores on the 39 sample questions must be ≥ today's scores. Pareto comparison, not averages — any question that drops fails the gate even if the average is up.
2. **Measurable improvement on a new "hard" eval set.** Add ~15 questions specifically chosen to exercise capabilities Phase A unlocks:
   - Multi-hop ("when does Alice get to school AND what's the pickup code")
   - Exact-token ("garage code", "Trader Joe's loyalty number")
   - Browse-style ("walk me through the morning routine in order")
   - Refinement-required (ambiguous first-pass queries that benefit from a second search)

The hard set is built into the same key-fact scoring framework as the existing eval. Phase A passes if it improves the hard set without regressing the existing set.

The eval harness gains a `--mode tool-call` flag that runs against `runChatLoop` instead of the legacy one-shot path. Both modes run on every eval invocation so we can compare side by side.

If Phase A only improves on the hard set marginally, or doesn't move it at all, we stop. Phase B is not worth doing without Phase A working — the whole premise is that compounding context helps once Charlotte has more than one tool to compound with.

## Phase B — Server-Stored Conversations

### Database

Two new tables, both scoped to `household_id`.

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  cleared_at TEXT
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,           -- "user" | "assistant" | "tool"
  content TEXT,                 -- prose for user/assistant, JSON tool result for tool rows
  tool_calls TEXT,              -- JSON-encoded array, set on assistant rows that called tools
  tool_call_id TEXT,            -- set on tool rows
  created_at TEXT NOT NULL
);

CREATE INDEX idx_messages_conversation_position
  ON conversation_messages(conversation_id, position);
```

`cleared_at` rather than hard-deletion: lets us keep the conversation row for analytics ("how many chats were cleared mid-session?") while making the messages effectively gone for the next turn. Implementation: `clear` deletes from `conversation_messages WHERE conversation_id = ?` and stamps `cleared_at`. The conversation row stays.

`guest_id` is nullable because owner preview chats don't have one.

### API changes

`POST /chat` request shape changes:

```json
{
  "message": "What's the WiFi password?",
  "conversation_id": "uuid"
}
```

`history` is removed. If the client omits `conversation_id`, the server creates a new conversation and includes its ID in the SSE stream as the first event:

```
data: {"conversation_id": "uuid"}
```

`DELETE /conversations/:id` is new. Owner or guest auth (must own the conversation). Clears messages, stamps `cleared_at`, returns `204`.

`GET /conversations/:id` is new in case iOS ever needs to recover state mid-session — returns the message history without tool_use/tool_result internals (only `user` and `assistant` rows). Out of scope for v1 iOS but the endpoint is cheap to add.

### iOS changes

`APIClient.sendChat`:
- Drops `history` parameter
- Adds `conversationId` parameter (optional on first call, required after)
- Reads the `conversation_id` event from the SSE stream and exposes it via the result so the view model can store it

`ChatViewModel`:
- Persists `conversationId` per chat session — same scope as the current `messages` array
- "Clear chat" hits `DELETE /conversations/:id` and creates a new conversation on the next message
- The locally-rendered messages array stays exactly as it is — tool_use and tool_result rows are server-internal and do not appear in the iOS UI

The contract change in `.brainstorm/spec.md` is real but small: `history` is removed from `POST /chat`, `conversation_id` is added, two new endpoints are documented, and the SSE stream gains a `conversation_id` event at the start of new conversations.

### What Phase B does *not* change

- The two tools and their descriptions
- The hybrid search implementation
- The seed pattern (still runs on every user message, now seeded into the persisted history)
- The status events
- The streaming response format on the iOS side

Phase B is fundamentally a relocation — the message history moves from the iOS app to the server, and the message types that were being thrown away across turns (tool_use, tool_result) are now retained.

## Out of Scope

These are deliberately not in v1 of either phase:

- **Streaming tool-call argument deltas.** The slick "Charlotte is searching for: 'b… be… bed…'" UX. Adds complexity for cosmetic value.
- **Tools that mutate state.** No `add_document`, `delete_chunk`, `set_reminder`. Read-only retrieval only.
- **Cross-house tool calls.** Every tool is scoped to the active `household_id`.
- **Conversation history view in iOS.** One chat per house, mirrors today's behavior. The server stores conversations but iOS only shows the current one.
- **Multi-conversation per house.** A single rolling conversation per `(household_id, guest_id)` for v1.
- **TTL on conversations.** Conversations live until cleared. Adding a TTL is a separate decision when the data warrants it.
- **`list_documents()` as a tool.** Document inventory lives in the system prompt instead.
- **Provider abstraction for tool calls.** The tool-call loop assumes OpenAI-shape messages. If we ever swap chat providers, that's a real port.

## Open Questions

These are minor enough to resolve during implementation, not blockers for the design:

- **Seed search query rewriting.** Does the seed always use the raw user message, or does it use the last assistant turn as context to disambiguate follow-ups? Phase A starts with raw message; this is something the eval gate can drive.
- **`read_document` size cap.** Should there be a max size? Most household docs are small but a 50KB recipe collection could blow context. Probably fine in v1; revisit if the eval shows it.
- **Tool descriptions on every call.** OpenAI tool definitions are sent on every API call by default. With prompt caching, this is cheap but worth flagging.
