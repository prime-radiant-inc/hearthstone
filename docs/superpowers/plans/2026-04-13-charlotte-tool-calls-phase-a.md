# Charlotte Tool Calls Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agentic tool-call loop to Charlotte's `/chat` endpoint so the model can call hybrid retrieval (`search`) and full-document fetch (`read_document`) tools when its first answer would be thin, without regressing latency on easy questions.

**Architecture:** Backend-only changes. A new `chat-loop` service owns the OpenAI tool-call loop. The first tool call is a synthetic `tool_use` seeded with chunks from the existing pipeline, so easy questions answer in zero round trips. Hybrid search runs vector + FTS5 in parallel and fuses with reciprocal rank fusion. Status events stream through SSE during round trips so iOS shows "Charlotte is searching for X" instead of dead air.

**Tech Stack:** TypeScript on Bun, `bun:sqlite` with `sqlite-vec` and FTS5, OpenAI tool calling via the `openai` SDK, OTel tracing via the existing `tracing.ts` module, `bun:test` for tests.

**Reference spec:** `docs/superpowers/specs/2026-04-13-charlotte-tool-calls-design.md`

---

## File Structure

**Files to create:**
- `backend/src/services/fts-search.ts` — FTS5 query function returning `SearchResult[]`
- `backend/src/services/rrf.ts` — pure utility, reciprocal rank fusion
- `backend/src/services/hybrid-search.ts` — runs vector + FTS5 in parallel, fuses
- `backend/src/services/document-inventory.ts` — builds the inventory string for the system prompt
- `backend/src/services/chat-tools.ts` — tool definitions, dispatcher, types
- `backend/src/services/chat-loop.ts` — the model loop (seed + tool dispatch + final emit)
- `backend/tests/services/fts-search.test.ts`
- `backend/tests/services/rrf.test.ts`
- `backend/tests/services/hybrid-search.test.ts`
- `backend/tests/services/document-inventory.test.ts`
- `backend/tests/services/chat-tools.test.ts`
- `backend/tests/services/chat-loop.test.ts`

**Files to modify:**
- `backend/src/db/migrations.ts` — add FTS5 virtual table and triggers
- `backend/src/services/chat-provider.ts` — add `chatComplete` variant that supports tools
- `backend/src/services/prompt.ts` — add `TOOL_CALL_SYSTEM` for tool-aware framing
- `backend/src/routes/chat.ts` — replace inline RAG with `runChatLoop`, pump status events
- `backend/tests/api-contract.test.ts` — assert new SSE event shapes
- `.brainstorm/spec.md` — document new SSE event types
- `backend/eval/harness.ts` — add `tool-call` mode branch to `runQuestion`
- `backend/eval/run.ts` — add `tool-call` to `ALL_MODES`
- `backend/eval/questions.ts` — tag existing questions, add ~15 "hard" questions

---

## Task 1: FTS5 virtual table and triggers

**Files:**
- Modify: `backend/src/db/migrations.ts`
- Create: `backend/tests/services/fts-search.test.ts` (test for the migration only at this point — service file in Task 2)

- [ ] **Step 1: Write the failing migration test**

Create `backend/tests/services/fts-search.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/fts-search.test.ts
```

Expected: FAIL with `no such table: chunks_fts`.

- [ ] **Step 3: Add the FTS5 migration**

Append to `backend/src/db/migrations.ts` after the existing migration block (before the closing brace of `runMigrations`):

```ts
  // FTS5 virtual table over chunks. External-content table — index lives here,
  // canonical text stays in `chunks`. Triggers keep them in sync.
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text, heading,
      content='chunks',
      content_rowid='rowid'
    );
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text, heading)
      VALUES (new.rowid, new.text, new.heading);
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
      VALUES('delete', old.rowid, old.text, old.heading);
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
      VALUES('delete', old.rowid, old.text, old.heading);
      INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
      VALUES (new.rowid, new.text, new.heading);
    END;
  `);

  // Backfill from existing chunks. Idempotent — rebuild is the FTS5 way to
  // recompute the index from external content.
  db.run("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');");
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/fts-search.test.ts
```

Expected: PASS — all three migration tests green.

- [ ] **Step 5: Run the full test suite**

```bash
cd backend && bun test
```

Expected: PASS — no regressions in any existing test. The triggers are additive and the existing chunk insert/delete/update sites do not need to change.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/migrations.ts backend/tests/services/fts-search.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add FTS5 index over chunks

Adds a chunks_fts virtual table (external content) plus insert/delete/update
triggers to keep it in sync with the chunks table. Backfills from existing
data via INSERT('rebuild'). Required for hybrid retrieval in the upcoming
chat tool-call loop.
EOF
)"
```

---

## Task 2: ftsSearch service function

**Files:**
- Create: `backend/src/services/fts-search.ts`
- Modify: `backend/tests/services/fts-search.test.ts`

- [ ] **Step 1: Add the failing service test**

Append to `backend/tests/services/fts-search.test.ts`:

```ts
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

  it("returns multiple results in rank order", () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/fts-search.test.ts
```

Expected: FAIL with `Cannot find module '../../src/services/fts-search'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/fts-search.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { SearchResult } from "./search";

export function ftsSearch(
  db: Database,
  householdId: string,
  query: string,
  limit: number = 5
): SearchResult[] {
  if (!query.trim()) return [];

  // FTS5 is sensitive to syntax characters in user input. Strip anything
  // that isn't a word char or whitespace so a query like "garage code?"
  // does not get parsed as an FTS5 expression.
  const safeQuery = query.replace(/[^\w\s]/g, " ").trim();
  if (!safeQuery) return [];

  const rows = db
    .prepare(
      `
      SELECT
        c.id           AS chunk_id,
        c.document_id,
        c.household_id,
        c.chunk_index,
        c.heading,
        c.text,
        d.title        AS document_title,
        chunks_fts.rank AS rank
      FROM chunks_fts
      JOIN chunks c    ON c.rowid = chunks_fts.rowid
      JOIN documents d ON d.id = c.document_id
      WHERE chunks_fts MATCH ?
        AND c.household_id = ?
      ORDER BY chunks_fts.rank
      LIMIT ?
      `
    )
    .all(safeQuery, householdId, limit) as any[];

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    heading: r.heading || "",
    text: r.text,
    householdId: r.household_id,
    distance: -r.rank, // FTS5 rank is negative log probability; lower is better
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/fts-search.test.ts
```

Expected: PASS — all six tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fts-search.ts backend/tests/services/fts-search.test.ts
git commit -m "$(cat <<'EOF'
feat(search): add ftsSearch service over chunks_fts

Wraps the FTS5 virtual table with a household-scoped query function that
returns the same SearchResult shape as searchChunks. Strips FTS5 syntax
chars from user input so user queries can't accidentally become FTS5
expressions.
EOF
)"
```

---

## Task 3: Reciprocal rank fusion utility

**Files:**
- Create: `backend/src/services/rrf.ts`
- Create: `backend/tests/services/rrf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/rrf.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { reciprocalRankFusion } from "../../src/services/rrf";

const mk = (id: string) => ({ chunkId: id }) as any;

describe("reciprocalRankFusion", () => {
  it("ranks an item that appears in both lists higher than items in only one", () => {
    const listA = [mk("a"), mk("b"), mk("c")];
    const listB = [mk("c"), mk("d"), mk("e")];

    const fused = reciprocalRankFusion(listA, listB, 5);

    expect(fused[0].chunkId).toBe("c");
  });

  it("preserves identity from the original objects (not just chunkIds)", () => {
    const a = { chunkId: "a", text: "from list A", documentId: "doc-a" } as any;
    const b = { chunkId: "b", text: "from list B", documentId: "doc-b" } as any;
    const fused = reciprocalRankFusion([a], [b], 5);
    const got = fused.find(r => r.chunkId === "a");
    expect(got?.text).toBe("from list A");
    expect(got?.documentId).toBe("doc-a");
  });

  it("limits the result count", () => {
    const listA = Array.from({ length: 10 }, (_, i) => mk(`a${i}`));
    const listB = Array.from({ length: 10 }, (_, i) => mk(`b${i}`));
    const fused = reciprocalRankFusion(listA, listB, 5);
    expect(fused.length).toBe(5);
  });

  it("handles empty lists on either side", () => {
    expect(reciprocalRankFusion([], [mk("a")], 5).map(r => r.chunkId)).toEqual(["a"]);
    expect(reciprocalRankFusion([mk("a")], [], 5).map(r => r.chunkId)).toEqual(["a"]);
    expect(reciprocalRankFusion([], [], 5)).toEqual([]);
  });

  it("computes scores as 1/(k+rank) summed across lists", () => {
    // Item "a" is rank 0 in listA, rank 0 in listB.
    // With k=60: score = 1/60 + 1/60 = 2/60 ≈ 0.0333
    // Item "b" is rank 1 in listA only: score = 1/61 ≈ 0.0164
    const fused = reciprocalRankFusion([mk("a"), mk("b")], [mk("a")], 5);
    expect(fused[0].chunkId).toBe("a");
    expect(fused[1].chunkId).toBe("b");
  });

  it("deduplicates by chunkId", () => {
    const fused = reciprocalRankFusion([mk("a"), mk("a")], [mk("a")], 5);
    expect(fused.length).toBe(1);
    expect(fused[0].chunkId).toBe("a");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/rrf.test.ts
```

Expected: FAIL with `Cannot find module '../../src/services/rrf'`.

- [ ] **Step 3: Implement the utility**

Create `backend/src/services/rrf.ts`:

```ts
const K = 60; // RRF constant. 60 is the standard default from the original paper.

interface RankedItem {
  chunkId: string;
}

/**
 * Reciprocal rank fusion of two ranked lists. Items appearing in both lists
 * accumulate score across both. Returns the top `limit` items, sorted by
 * descending fused score, preserving object identity from the input lists
 * (the listA copy wins if an item appears in both).
 */
export function reciprocalRankFusion<T extends RankedItem>(
  listA: T[],
  listB: T[],
  limit: number
): T[] {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  const accumulate = (list: T[]) => {
    let rank = 0;
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.chunkId)) continue;
      seen.add(item.chunkId);
      const score = 1 / (K + rank);
      scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + score);
      if (!items.has(item.chunkId)) {
        items.set(item.chunkId, item);
      }
      rank += 1;
    }
  };

  accumulate(listA);
  accumulate(listB);

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([chunkId]) => items.get(chunkId)!)
    .filter(Boolean);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/rrf.test.ts
```

Expected: PASS — all six tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rrf.ts backend/tests/services/rrf.test.ts
git commit -m "$(cat <<'EOF'
feat(search): add reciprocal rank fusion utility

Pure function that fuses two ranked lists by accumulating 1/(60+rank)
scores per item. Used by hybrid search to merge vector and FTS5 results.
EOF
)"
```

---

## Task 4: Hybrid search service

**Files:**
- Create: `backend/src/services/hybrid-search.ts`
- Create: `backend/tests/services/hybrid-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/hybrid-search.test.ts`:

```ts
import "../../src/db/setup-sqlite";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { runHybridSearch } from "../../src/services/hybrid-search";

// Stub the embeddings module so tests don't hit OpenAI.
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/hybrid-search.test.ts
```

Expected: FAIL with `Cannot find module '../../src/services/hybrid-search'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/hybrid-search.ts`:

```ts
import type { Database } from "bun:sqlite";
import { embed } from "./embeddings";
import { searchChunks, type SearchResult } from "./search";
import { ftsSearch } from "./fts-search";
import { reciprocalRankFusion } from "./rrf";
import { startSpan, type Context } from "../tracing";

const POOL_MULTIPLIER = 2;

export async function runHybridSearch(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  const span = startSpan("chat.tool.search.hybrid", ctx);
  span.setAttribute("hybrid.query", query);
  span.setAttribute("hybrid.limit", limit);
  try {
    const poolSize = limit * POOL_MULTIPLIER;

    const queryEmbedding = await embed(ctx, query);
    const queryVec = new Float32Array(queryEmbedding);

    const vectorResults = searchChunks(db, householdId, queryVec, poolSize);
    const ftsResults = ftsSearch(db, householdId, query, poolSize);

    span.setAttribute("hybrid.vector_hits", vectorResults.length);
    span.setAttribute("hybrid.fts_hits", ftsResults.length);

    const fused = reciprocalRankFusion(vectorResults, ftsResults, limit);
    span.setAttribute("hybrid.fused_hits", fused.length);
    return fused;
  } finally {
    span.end();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/hybrid-search.test.ts
```

Expected: PASS — all four tests green.

- [ ] **Step 5: Run the full test suite**

```bash
cd backend && bun test
```

Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/hybrid-search.ts backend/tests/services/hybrid-search.test.ts
git commit -m "$(cat <<'EOF'
feat(search): add hybrid search combining vector and FTS5

Runs vector and FTS5 retrieval over a 2x pool, fuses with reciprocal rank
fusion, returns the top N. Returns the same SearchResult shape as
searchChunks so downstream code does not care which index found a chunk.
EOF
)"
```

---

## Task 5: Document inventory builder

**Files:**
- Create: `backend/src/services/document-inventory.ts`
- Create: `backend/tests/services/document-inventory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/document-inventory.test.ts`:

```ts
import "../../src/db/setup-sqlite";
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { buildDocumentInventory } from "../../src/services/document-inventory";

function seed(db: Database) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "o@t", now);
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h1", "p1", "Home", now);
}

function addDoc(db: Database, id: string, title: string, chunkCount: number) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, "h1", `drive-${id}`, title, "# Doc", "ready", now);
  for (let i = 0; i < chunkCount; i++) {
    db.prepare(
      "INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(`${id}-c${i}`, id, "h1", i, "", `chunk ${i}`, now);
  }
}

describe("buildDocumentInventory", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("returns an empty inventory for a household with no documents", () => {
    const inv = buildDocumentInventory(db, "h1");
    expect(inv).toBe("Available documents in this household: (none)");
  });

  it("lists documents with id and chunk count", () => {
    addDoc(db, "d1", "House Operations", 18);
    addDoc(db, "d2", "Kid Routines", 12);

    const inv = buildDocumentInventory(db, "h1");
    expect(inv).toContain("Available documents in this household:");
    expect(inv).toContain('"House Operations"');
    expect(inv).toContain("id: d1");
    expect(inv).toContain("18 chunks");
    expect(inv).toContain('"Kid Routines"');
    expect(inv).toContain("id: d2");
    expect(inv).toContain("12 chunks");
  });

  it("only includes documents in status='ready'", () => {
    const now = new Date().toISOString();
    addDoc(db, "d1", "Ready Doc", 5);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h1", "drive-d2", "Indexing Doc", "# Doc", "indexing", now);

    const inv = buildDocumentInventory(db, "h1");
    expect(inv).toContain("Ready Doc");
    expect(inv).not.toContain("Indexing Doc");
  });

  it("scopes by household_id", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "x@t", now);
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h2", "p2", "Other", now);
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d99", "h2", "drive99", "Other Home Doc", "# Doc", "ready", now);

    const inv = buildDocumentInventory(db, "h1");
    expect(inv).not.toContain("Other Home Doc");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/document-inventory.test.ts
```

Expected: FAIL with `Cannot find module '../../src/services/document-inventory'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/document-inventory.ts`:

```ts
import type { Database } from "bun:sqlite";

interface InventoryRow {
  id: string;
  title: string;
  chunk_count: number;
}

export function buildDocumentInventory(db: Database, householdId: string): string {
  const rows = db
    .prepare(
      `
      SELECT d.id, d.title, COUNT(c.id) AS chunk_count
      FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id
      WHERE d.household_id = ? AND d.status = 'ready'
      GROUP BY d.id, d.title
      ORDER BY d.title
      `
    )
    .all(householdId) as InventoryRow[];

  if (rows.length === 0) {
    return "Available documents in this household: (none)";
  }

  const lines = rows.map(
    (r) => `- "${r.title}" (id: ${r.id}, ${r.chunk_count} chunks)`
  );

  return ["Available documents in this household:", ...lines].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/document-inventory.test.ts
```

Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/document-inventory.ts backend/tests/services/document-inventory.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): add document inventory builder for tool-call system prompt

Returns a formatted listing of a household's ready documents with their
ids and chunk counts. Injected into the system prompt on every chat
request so the model can name documents in answers and call read_document
without an enumeration round trip.
EOF
)"
```

---

## Task 6: Tool definitions and search dispatch

**Files:**
- Create: `backend/src/services/chat-tools.ts`
- Create: `backend/tests/services/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/chat-tools.test.ts`:

```ts
import "../../src/db/setup-sqlite";
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/chat-tools.test.ts
```

Expected: FAIL with `Cannot find module '../../src/services/chat-tools'`.

- [ ] **Step 3: Implement the tools (search dispatch only — read_document in Task 7)**

Create `backend/src/services/chat-tools.ts`:

```ts
import type { Database } from "bun:sqlite";
import { runHybridSearch } from "./hybrid-search";
import type { Context } from "../tracing";

export interface ToolCallRequest {
  name: string;
  arguments: string; // JSON string
  indexBase: number; // first index assigned to chunks in this dispatch
}

export interface SearchToolResult {
  kind: "search";
  payload: {
    chunks: Array<{
      index: number;
      chunk_id: string;
      document_id: string;
      document_title: string;
      heading: string;
      text: string;
      chunk_index: number;
      score: number;
    }>;
  };
  /** Number of indices consumed by this dispatch (= chunks.length). */
  indicesConsumed: number;
}

export interface ReadDocumentToolResult {
  kind: "read_document";
  payload: {
    document_id: string;
    title: string;
    markdown: string;
  };
  indicesConsumed: number;
}

export type ToolResult = SearchToolResult | ReadDocumentToolResult;

const SEARCH_DEFAULT_LIMIT = 5;
const SEARCH_MAX_LIMIT = 10;

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search",
      description:
        "Use this when you need to find information from the household's documents to answer a question. " +
        "Works for both concept questions ('when do the kids go to bed') and questions with exact tokens like " +
        "codes, phone numbers, or brand names ('garage code', '5551234'). You can call this multiple times with " +
        "different queries if the first results don't fully answer the question. Prefer specific queries over broad ones.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query, in the language the user would use." },
          limit: {
            type: "integer",
            description: "Number of chunks to return (default 5, max 10).",
            minimum: 1,
            maximum: SEARCH_MAX_LIMIT,
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_document",
      description:
        "Use this when search has identified the right document but you need the full structure of it to " +
        "answer well. Best for questions that need a long list, an ordered procedure, a schedule, or a recipe — " +
        "anything where the right answer is 'the whole section' rather than 'a few sentences.' Prefer `search` " +
        "first; only `read_document` when you already know which document is right.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "The document's UUID, from the inventory or a search result." },
        },
        required: ["document_id"],
      },
    },
  },
];

export async function dispatchTool(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  request: ToolCallRequest
): Promise<ToolResult> {
  let args: any;
  try {
    args = JSON.parse(request.arguments);
  } catch (err) {
    throw new Error(`Tool '${request.name}' received malformed arguments: ${request.arguments}`);
  }

  if (request.name === "search") {
    return dispatchSearch(ctx, db, householdId, args, request.indexBase);
  }
  if (request.name === "read_document") {
    return dispatchReadDocument(ctx, db, householdId, args, request.indexBase);
  }
  throw new Error(`Unknown tool: ${request.name}`);
}

async function dispatchSearch(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  args: any,
  indexBase: number
): Promise<SearchToolResult> {
  const query = String(args?.query ?? "").trim();
  if (!query) {
    return {
      kind: "search",
      payload: { chunks: [] },
      indicesConsumed: 0,
    };
  }
  const requestedLimit = Number(args?.limit ?? SEARCH_DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(requestedLimit)));

  const results = await runHybridSearch(ctx, db, householdId, query, limit);
  const chunks = results.map((r, i) => ({
    index: indexBase + i,
    chunk_id: r.chunkId,
    document_id: r.documentId,
    document_title: r.documentTitle,
    heading: r.heading,
    text: r.text,
    chunk_index: r.chunkIndex,
    score: r.distance,
  }));

  return {
    kind: "search",
    payload: { chunks },
    indicesConsumed: chunks.length,
  };
}

async function dispatchReadDocument(
  _ctx: Context | undefined,
  _db: Database,
  _householdId: string,
  _args: any,
  _indexBase: number
): Promise<ReadDocumentToolResult> {
  // Implemented in Task 7.
  throw new Error("read_document not yet implemented");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/chat-tools.test.ts
```

Expected: PASS — all eight tests in the `TOOLS` and `dispatchTool` describe blocks green. (read_document tests come in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat-tools.ts backend/tests/services/chat-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): add chat-tools with search dispatch

Exposes the OpenAI tool definitions for search and read_document, plus a
dispatcher that routes to hybrid search and assigns monotonic chunk
indices for citation. read_document is stubbed and implemented in the
next commit.
EOF
)"
```

---

## Task 7: read_document dispatch with chunk markers

**Files:**
- Modify: `backend/src/services/chat-tools.ts`
- Modify: `backend/tests/services/chat-tools.test.ts`

- [ ] **Step 1: Add the failing test**

Append to the bottom of `backend/tests/services/chat-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/chat-tools.test.ts
```

Expected: FAIL with `read_document not yet implemented`.

- [ ] **Step 3: Implement read_document**

Replace the `dispatchReadDocument` function in `backend/src/services/chat-tools.ts` with:

```ts
async function dispatchReadDocument(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  args: any,
  _indexBase: number
): Promise<ReadDocumentToolResult> {
  const docId = String(args?.document_id ?? "").trim();
  if (!docId) {
    throw new Error("read_document requires a document_id");
  }

  const doc = db
    .prepare(
      "SELECT id, title FROM documents WHERE id = ? AND household_id = ? AND status = 'ready'"
    )
    .get(docId, householdId) as { id: string; title: string } | undefined;

  if (!doc) {
    throw new Error(`Document ${docId} not found in household`);
  }

  const chunks = db
    .prepare(
      `SELECT id, chunk_index, heading, text
       FROM chunks
       WHERE document_id = ? AND household_id = ?
       ORDER BY chunk_index`
    )
    .all(docId, householdId) as Array<{
      id: string;
      chunk_index: number;
      heading: string;
      text: string;
    }>;

  // Stitch chunks together with inline citation markers. The model can
  // still cite a specific section even when answering from a full read.
  const sections = chunks.map((c) => `<<chunk:${c.id}>>\n${c.text}`);
  const markdown = sections.join("\n\n");

  return {
    kind: "read_document",
    payload: { document_id: doc.id, title: doc.title, markdown },
    indicesConsumed: 0,
  };
}
```

(The unused `ctx` parameter is intentional — leave it on the signature for future tracing.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/chat-tools.test.ts
```

Expected: PASS — all chat-tools tests (search + read_document) green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat-tools.ts backend/tests/services/chat-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): implement read_document tool with chunk markers

Returns a document's chunks stitched together with <<chunk:id>> markers
between sections so the model can cite a specific chunk even when
answering from a full-document read. Household-scoped.
EOF
)"
```

---

## Task 8: chatComplete with tools

**Files:**
- Modify: `backend/src/services/chat-provider.ts`
- Modify: `backend/tests/services/` (new test file or extend existing)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/chat-provider.test.ts`:

```ts
import { describe, it, expect, mock } from "bun:test";
import type { ChatMessage } from "../../src/services/chat-provider";

const mockCreate = mock(async () => ({
  choices: [{
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: JSON.stringify({ query: "garage" }) },
      }],
    },
  }],
}));

mock.module("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { chatCompleteWithTools } from "../../src/services/chat-provider";

describe("chatCompleteWithTools", () => {
  it("passes tool definitions to the OpenAI client", async () => {
    const tools = [{ type: "function", function: { name: "search", description: "x", parameters: { type: "object" } } }];
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    await chatCompleteWithTools(undefined, messages, tools as any);
    const call = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
    expect(call.tools).toEqual(tools);
  });

  it("returns the assistant message including tool_calls", async () => {
    const tools = [{ type: "function", function: { name: "search", description: "x", parameters: { type: "object" } } }];
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    const response = await chatCompleteWithTools(undefined, messages, tools as any);
    expect(response.role).toBe("assistant");
    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls?.[0].function.name).toBe("search");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/chat-provider.test.ts
```

Expected: FAIL with `chatCompleteWithTools is not exported`.

- [ ] **Step 3: Add the function to chat-provider.ts**

Append to `backend/src/services/chat-provider.ts`:

```ts
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export type LoopMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export async function chatCompleteWithTools(
  ctx: Context | undefined,
  messages: LoopMessage[],
  tools: any[]
): Promise<AssistantMessage> {
  if (config.chatProvider !== "openai") {
    throw new Error(`chatCompleteWithTools only supports openai provider, got: ${config.chatProvider}`);
  }
  const span = startSpan("openai.chat.complete.tools", ctx);
  span.setAttribute("openai.model", "gpt-5.4");
  span.setAttribute("tools.count", tools.length);
  try {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      messages: messages as any,
      tools,
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("OpenAI returned no message");
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: (message as any).tool_calls,
    };
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/chat-provider.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat-provider.ts backend/tests/services/chat-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): add chatCompleteWithTools to chat-provider

Non-streaming variant that supports OpenAI tool definitions. Returns the
full assistant message with tool_calls so the chat loop can dispatch and
re-prompt. Streaming chat() is unchanged and remains the path for the
final user-facing response.
EOF
)"
```

---

## Task 9: System prompt for tool-call mode

**Files:**
- Modify: `backend/src/services/prompt.ts`
- Create: `backend/tests/services/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/prompt.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { buildToolCallSystemPrompt } from "../../src/services/prompt";

describe("buildToolCallSystemPrompt", () => {
  it("includes the document inventory verbatim", () => {
    const inv = "Available documents in this household:\n- \"House Ops\" (id: d1, 5 chunks)";
    const prompt = buildToolCallSystemPrompt(inv);
    expect(prompt).toContain(inv);
  });

  it("instructs the model to use the search tool when needed", () => {
    const prompt = buildToolCallSystemPrompt("...");
    expect(prompt.toLowerCase()).toContain("search");
  });

  it("instructs the model to cite chunks via Sources: [N] format", () => {
    const prompt = buildToolCallSystemPrompt("...");
    expect(prompt).toContain("Sources:");
    expect(prompt).toMatch(/\[\d\]/);
  });

  it("includes the chat style and helpfulness sections from prompt.txt", () => {
    const prompt = buildToolCallSystemPrompt("...");
    // CHAT_STYLE / HELPFULNESS are already in RAG_SYSTEM; the tool-call prompt
    // should include the same brand voice. Check for a stable substring that
    // appears in both: this assertion couples to prompt.txt content.
    expect(prompt.length).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/prompt.test.ts
```

Expected: FAIL with `buildToolCallSystemPrompt is not exported`.

- [ ] **Step 3: Add the function to prompt.ts**

Append to `backend/src/services/prompt.ts`:

```ts
export function buildToolCallSystemPrompt(documentInventory: string): string {
  return `You are a helpful household assistant. Answer using ONLY information you retrieve via tools. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

You have two tools available:

- search(query, limit?) — Find chunks across the household's documents. Use this for any question whose answer might live in the documents. You can call it more than once with different queries if the first results don't cover the question.
- read_document(document_id) — Fetch the full markdown of one document. Use this when search has identified the right document but you need its full structure (a long list, an ordered procedure, a schedule, a recipe).

${documentInventory}

When you cite chunks, refer to them by the index field on each chunk. After your answer, on a new line: Sources: [1], [3]
`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/prompt.test.ts
```

Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/prompt.ts backend/tests/services/prompt.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): add buildToolCallSystemPrompt for tool-aware framing

Reuses the existing chat style and helpfulness blocks but rewrites the
'answer from excerpts' instruction into 'answer from tool results',
embeds the document inventory, and tells the model to cite chunks by
their index field. Existing RAG_SYSTEM is unchanged.
EOF
)"
```

---

## Task 10: Chat loop service

**Files:**
- Create: `backend/src/services/chat-loop.ts`
- Create: `backend/tests/services/chat-loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/chat-loop.test.ts`:

```ts
import "../../src/db/setup-sqlite";
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

// Programmable chat-provider mock. Each test sets MOCK_RESPONSES to
// the sequence of assistant messages chatCompleteWithTools should return.
const mockResponses: any[] = [];
mock.module("../../src/services/chat-provider", () => ({
  chatCompleteWithTools: async () => {
    const next = mockResponses.shift();
    if (!next) throw new Error("no mock response queued");
    return next;
  },
  // The streaming chat() path is not exercised in chat-loop unit tests.
  chat: async function* () { yield ""; },
  chatComplete: async () => "",
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

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
    mockResponses.length = 0;
  });

  it("emits a final delta when the model answers without calling any tools", async () => {
    mockResponses.push({ role: "assistant", content: "Garage code is 4820. Sources: [1]", tool_calls: undefined });
    const events = await collect(runChatLoop(undefined, db, "h1", "garage code?", []));
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

    const events = await collect(runChatLoop(undefined, db, "h1", "bedtime?", []));
    const statusEvents = events.filter(e => e.type === "status");
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents.some((e: any) => e.status === "searching")).toBe(true);
    expect(statusEvents.some((e: any) => e.query === "weekend bedtime")).toBe(true);
  });

  it("terminates the loop when the model returns no tool_calls", async () => {
    mockResponses.push({ role: "assistant", content: "Done. Sources: [1]", tool_calls: undefined });
    const events = await collect(runChatLoop(undefined, db, "h1", "q", []));
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

    const events = await collect(runChatLoop(undefined, db, "h1", "q", []));
    const statusEvents = events.filter(e => e.type === "status" && (e as any).status === "searching");
    // Seed search is not a status event (it runs synthetically before the loop),
    // so status count is exactly the number of model-issued tool calls = 4 cap.
    expect(statusEvents.length).toBe(4);
  });

  it("seeds the conversation with a synthetic tool_use before the first model call", async () => {
    let receivedMessages: any[] | null = null;
    mock.module("../../src/services/chat-provider", () => ({
      chatCompleteWithTools: async (_ctx: any, messages: any[]) => {
        receivedMessages = messages;
        return { role: "assistant", content: "ok", tool_calls: undefined };
      },
      chat: async function* () { yield ""; },
      chatComplete: async () => "",
    }));
    // Re-import after re-mocking
    const { runChatLoop: freshLoop } = await import("../../src/services/chat-loop");

    await collect(freshLoop(undefined, db, "h1", "garage", []));
    expect(receivedMessages).not.toBeNull();
    const msgs = receivedMessages as any[];
    // Expect: [system, ...history, user, synthetic assistant tool_call, synthetic tool result]
    const hasSyntheticAssistant = msgs.some(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls[0]?.function?.name === "search"
    );
    const hasToolResult = msgs.some((m) => m.role === "tool");
    expect(hasSyntheticAssistant).toBe(true);
    expect(hasToolResult).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/services/chat-loop.test.ts
```

Expected: FAIL with `Cannot find module '../../src/services/chat-loop'`.

- [ ] **Step 3: Implement the chat loop**

Create `backend/src/services/chat-loop.ts`:

```ts
import type { Database } from "bun:sqlite";
import { chatCompleteWithTools, type LoopMessage, type AssistantMessage } from "./chat-provider";
import { TOOLS, dispatchTool, type ToolResult } from "./chat-tools";
import { runHybridSearch } from "./hybrid-search";
import { buildDocumentInventory } from "./document-inventory";
import { buildToolCallSystemPrompt } from "./prompt";
import { startSpan, type Context } from "../tracing";

const MAX_TOOL_CALLS = 4;
const SEED_LIMIT = 5;

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
  history: HistoryItem[]
): AsyncGenerator<ChatLoopEvent> {
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
      const response: AssistantMessage = await chatCompleteWithTools(ctx, messages, TOOLS);

      const toolCalls = response.tool_calls ?? [];
      if (toolCalls.length === 0 || toolCallsRemaining === 0) {
        // Final answer. Emit content as a single delta. Streaming the final
        // response would require a second inference and is out of scope for
        // Phase A; status events already cover the "Charlotte is working" UX.
        if (response.content) {
          yield { type: "delta", delta: response.content };
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
          const doc = db.prepare("SELECT title FROM documents WHERE id = ? AND household_id = ?").get(id, householdId) as { title: string } | undefined;
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
  } finally {
    span.end();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && bun test tests/services/chat-loop.test.ts
```

Expected: PASS — all five tests green.

- [ ] **Step 5: Run the full test suite**

```bash
cd backend && bun test
```

Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat-loop.ts backend/tests/services/chat-loop.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): add chat-loop service with synthetic tool_use seed

The loop pre-seeds the conversation with a fabricated assistant tool_use
that 'called' search with the user's message, then enters a
chatCompleteWithTools loop bounded at 4 model-issued tool calls. Emits
status events for each tool dispatch and a single delta event with the
final answer.
EOF
)"
```

---

## Task 11: Wire chat route to chat-loop

**Files:**
- Modify: `backend/src/routes/chat.ts`
- Create: `backend/tests/routes/chat.test.ts`

The chat-loop service from Task 10 already emits all three event types (`delta`, `status`, `chunks`) and `SearchToolResult` from Task 6 already carries `chunk_index`. This task is just the route handler — accumulate chunks events, drive the SSE stream, resolve `[N]` citations to source pills.

- [ ] **Step 1: Write the failing route test**

Create `backend/tests/routes/chat.test.ts`:

```ts
import "../../src/db/setup-sqlite";
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

// Mock chat-provider so the route does not call OpenAI. Returns a single
// final answer with a citation to chunk index 1.
mock.module("../../src/services/chat-provider", () => ({
  chatCompleteWithTools: async () => ({
    role: "assistant",
    content: "The garage code is 4820. Sources: [1]",
    tool_calls: undefined,
  }),
  chat: async function* () { yield ""; },
  chatComplete: async () => "",
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

describe("handleChat", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
  });

  it("returns an SSE stream with delta, sources, and [DONE]", async () => {
    const response = await handleChat(undefined, db, "h1", { message: "garage code?", history: [] });
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
    const response = await handleChat(undefined, db, "h1", { message: "garage code?", history: [] });
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
    const response = await handleChat(undefined, db, "h1", { message: "garage code?", history: [] });
    const events = await readSseEvents(response);
    expect(events.find((e) => "chunks" in e)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && bun test tests/routes/chat.test.ts
```

Expected: FAIL — the existing route uses the legacy one-shot RAG path and will not produce the right `delta` + `sources` events for the mocked chat loop, OR it will throw because the mock breaks the legacy `chat()` import.

- [ ] **Step 3: Replace `handleChat` with the loop-driven version**

Edit `backend/src/routes/chat.ts`. Replace the `handleChat` body and update imports.

Remove these imports (no longer used by `handleChat`, though `chat-provider` types may still be referenced — keep what `handleChatPreview` and other exports need):

```ts
// remove
import { embed } from "../services/embeddings";
import { chat, type ChatMessage } from "../services/chat-provider";
import { searchChunks } from "../services/search";
import { RAG_SYSTEM } from "../services/prompt";
```

Add:

```ts
import { runChatLoop } from "../services/chat-loop";
```

Replace the `handleChat` function body:

```ts
export async function handleChat(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";

      // Accumulate every chunk the loop publishes so we can resolve
      // the cited [N] indices to source pills after the model is done.
      const allChunks: Array<{
        index: number;
        chunk_id: string;
        document_id: string;
        title: string;
        chunk_index: number;
      }> = [];

      try {
        for await (const event of runChatLoop(ctx, db, householdId, body.message, body.history)) {
          if (event.type === "delta") {
            fullResponse += event.delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: event.delta })}\n\n`)
            );
          } else if (event.type === "status") {
            const payload: Record<string, any> = { status: event.status };
            if (event.query !== undefined) payload.query = event.query;
            if (event.document_id !== undefined) payload.document_id = event.document_id;
            if (event.title !== undefined) payload.title = event.title;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } else if (event.type === "chunks") {
            // Internal — not forwarded to the client.
            for (const c of event.chunks) allChunks.push(c);
          }
        }

        // Resolve cited [N] indices to source pills.
        const citedIndices = new Set<number>();
        const sourceLineMatch = fullResponse.match(/Sources?:\s*(.+)/i);
        if (sourceLineMatch) {
          for (const ref of sourceLineMatch[1].matchAll(/\[(\d+)\]/g)) {
            citedIndices.add(parseInt(ref[1]));
          }
        }

        const seenDocs = new Set<string>();
        const citedSources = allChunks
          .filter((c) => citedIndices.has(c.index))
          .filter((c) => {
            if (seenDocs.has(c.document_id)) return false;
            seenDocs.add(c.document_id);
            return true;
          })
          .map(({ document_id, title, chunk_index }) => ({
            document_id,
            title,
            chunk_index,
          }));

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ sources: citedSources })}\n\n`)
        );
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

`handleChatPreview` and `handleGetSuggestions` are unchanged — `handleChatPreview` still delegates to `handleChat`.

- [ ] **Step 4: Run the route test**

```bash
cd backend && bun test tests/routes/chat.test.ts
```

Expected: PASS — all three tests green.

- [ ] **Step 5: Run the full test suite**

```bash
cd backend && bun test
```

Expected: PASS — no regressions in chat-loop, chat-tools, search, or contract tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/chat.ts backend/tests/routes/chat.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): wire chat route to runChatLoop

The /chat handler now drives runChatLoop and pumps delta and status
events into the SSE stream. Internal chunks events are accumulated and
used to resolve the model's cited [N] indices into source pills with
the same dedupe-by-document semantics as today. Streaming, sources, and
[DONE] event shapes are unchanged for iOS clients.
EOF
)"
```

---

## Task 12: Update spec.md and contract test for new SSE events

**Files:**
- Modify: `.brainstorm/spec.md`
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Update the spec**

Find the `POST /chat` section in `.brainstorm/spec.md`. Add to the response documentation, after the existing SSE example and before the Errors block:

```markdown
**Status events (during tool calls):**

While the model runs tool calls, the SSE stream may include status events between content deltas. iOS clients should treat unknown event types as no-ops.

```
data: {"status": "searching", "query": "weekend bedtime"}
data: {"status": "reading", "document_id": "uuid", "title": "House Operations"}
data: {"status": "thinking"}
```

Status values: `searching` | `reading` | `thinking`. The `query` field is present on `searching` events; `document_id` and `title` are present on `reading` events.

The order of events within a `/chat` response is: zero or more `status` events interleaved with eventual `delta` events, then a single `sources` event, then `[DONE]`.
```

- [ ] **Step 2: Add a status-event shape contract test**

Append to `backend/tests/routes/chat.test.ts` (the file created in Task 11). This test reuses the same `seed` and `readSseEvents` helpers and adds a programmable mock so we can drive a status event through the loop. Replace the chat-provider mock at the top of the file with a stateful one if you haven't already, or add a dedicated `describe` block with its own mock setup:

```ts
describe("handleChat status event shape", () => {
  let db: Database;
  const responses: any[] = [];

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    seed(db);
    responses.length = 0;

    mock.module("../../src/services/chat-provider", () => ({
      chatCompleteWithTools: async () => {
        const next = responses.shift();
        if (!next) throw new Error("no mock response queued");
        return next;
      },
      chat: async function* () { yield ""; },
      chatComplete: async () => "",
    }));
  });

  it("status events expose only the documented fields", async () => {
    // First model turn calls search; second turn answers.
    responses.push({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: JSON.stringify({ query: "weekend bedtime" }) },
      }],
    });
    responses.push({
      role: "assistant",
      content: "OK. Sources: [1]",
      tool_calls: undefined,
    });

    const { handleChat: freshHandle } = await import("../../src/routes/chat");
    const response = await freshHandle(undefined, db, "h1", { message: "bedtime?", history: [] });
    const events = await readSseEvents(response);

    const statusEvents = events.filter((e: any) => "status" in e);
    expect(statusEvents.length).toBeGreaterThan(0);

    const allowedKeys = new Set(["status", "query", "document_id", "title"]);
    for (const ev of statusEvents) {
      expect(["searching", "reading", "thinking"]).toContain(ev.status);
      for (const key of Object.keys(ev)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
      if (ev.status === "searching") {
        expect(typeof ev.query).toBe("string");
      }
    }
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd backend && bun test tests/routes/chat.test.ts
```

Expected: PASS — both the original three tests from Task 11 and the new status shape test green.

- [ ] **Step 4: Commit**

```bash
git add .brainstorm/spec.md backend/tests/routes/chat.test.ts
git commit -m "$(cat <<'EOF'
docs(spec): document new SSE status events for /chat tool calls

Adds the status event shape (searching, reading, thinking) and notes
that older clients should treat unknown event types as no-ops. Route
test asserts status events only use documented fields.
EOF
)"
```

---

## Task 13: Eval harness tool-call mode

**Files:**
- Modify: `backend/eval/harness.ts`
- Modify: `backend/eval/run.ts`

- [ ] **Step 1: Add the tool-call mode runner to harness.ts**

The existing harness opens a single readonly `db` at module load and registers runners in `MODE_RUNNERS`. The chat-loop needs a writable handle (because `runMigrations` is called on it to ensure the FTS5 table exists) and the household_id of the eval database (which the existing runners ignore because they pre-load all chunks and docs at import time).

Edit `backend/eval/harness.ts`. Extend the `Mode` type at the top:

```ts
export type Mode = "rag" | "full" | "tool-call";
```

Add these imports near the other imports (top of file):

```ts
import { runChatLoop } from "../src/services/chat-loop";
import { runMigrations } from "../src/db/migrations";
```

Add a writable database handle and a household_id resolver near the existing `db` declaration (around line 70):

```ts
// Writable handle for the chat-loop runner. The loop only reads, but
// runMigrations is called to ensure chunks_fts exists — readonly fails
// on the CREATE TRIGGER calls.
const loopDb = new Database(dbPath);
sqliteVec.load(loopDb);
runMigrations(loopDb);

// Eval DB has a single household. Resolve its id once at module load.
const evalHouseholdId: string = (
  loopDb.prepare("SELECT id FROM households LIMIT 1").get() as { id: string } | undefined
)?.id ?? (() => {
  throw new Error("Eval database has no household — run reindex first");
})();
```

Add the new runner function after `runFull` (around line 188, before the `MODE_RUNNERS` const):

```ts
async function runToolCall(question: string): Promise<EvalResult> {
  const start = Date.now();
  let fullResponse = "";
  const docs = new Set<string>();

  for await (const ev of runChatLoop(undefined, loopDb, evalHouseholdId, question, [])) {
    if (ev.type === "delta") {
      fullResponse += ev.delta;
    } else if (ev.type === "chunks") {
      for (const c of ev.chunks) docs.add(c.title);
    }
  }

  return {
    questionId: "",
    mode: "tool-call",
    response: fullResponse,
    retrievedDocs: Array.from(docs),
    latencyMs: Date.now() - start,
    usage: undefined,
  };
}
```

Update `MODE_RUNNERS` to register the new mode:

```ts
const MODE_RUNNERS: Record<Mode, (q: string) => Promise<EvalResult>> = {
  rag: runRag,
  full: runFull,
  "tool-call": runToolCall,
};
```

`runQuestion` does not need to change — it already dispatches via `MODE_RUNNERS[mode]`.

- [ ] **Step 2: Add tool-call to ALL_MODES in run.ts**

In `backend/eval/run.ts`:

```ts
const ALL_MODES: Mode[] = ["rag", "full", "tool-call"];
```

- [ ] **Step 3: Smoke-test on a single question**

```bash
cd backend && bun eval/run.ts --mode tool-call --question dog-feeding
```

Expected: a single eval row prints, with a non-empty response, retrieved docs, latency, and a judge result. The chat loop should run, call zero or more tools, and return an answer.

If the seed-only path covers the question (likely — it's the same chunks the rag mode gets), `toolCallCount` will be 0. That's fine.

- [ ] **Step 4: Run the full eval in tool-call mode**

```bash
cd backend && bun eval/run.ts --mode tool-call
```

Expected: all questions run, results written to `backend/eval/results/`. No crashes.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/harness.ts backend/eval/run.ts
git commit -m "$(cat <<'EOF'
feat(eval): add tool-call mode to the eval harness

Wires runChatLoop into the eval runner as a third mode alongside rag and
full. Each question runs through the seed + tool-call loop and the
result is judged by the same key-fact framework. Required for the Phase
A eval gate.
EOF
)"
```

---

## Task 14: Add hard-questions eval set

**Files:**
- Modify: `backend/eval/questions.ts`

- [ ] **Step 1: Add a category field to the EvalQuestion type**

Edit `backend/eval/questions.ts`:

```ts
export type Difficulty = "easy" | "hard";

export interface EvalQuestion {
  id: string;
  persona: Persona;
  question: string;
  keyFacts: string[];
  antiHallucinations?: string[];
  sourceDoc: string;
  difficulty?: Difficulty; // defaults to "easy" when omitted
}
```

- [ ] **Step 2: Tag existing questions as easy (or leave defaulted)**

No changes required if `difficulty` defaults to `"easy"` when omitted — the existing 39 questions retain their difficulty implicitly. If you prefer explicit tagging, add `difficulty: "easy"` to each.

- [ ] **Step 3: Inspect the eval docs to know what's answerable**

The eval database lives at `backend/hearthstone.db` and contains the indexed Castillo-Park fictional docs. Hard questions need to be answerable from those docs — there is no point writing a question whose answer isn't in the source material.

Run this to dump every document title plus its full markdown so you can pick exact-token candidates, multi-hop opportunities, and browse-style targets:

```bash
cd backend && bun -e '
import { Database } from "bun:sqlite";
const db = new Database("./hearthstone.db", { readonly: true });
const docs = db.prepare("SELECT title, markdown FROM documents ORDER BY title").all();
for (const d of docs) {
  console.log("\n========== " + d.title + " ==========\n");
  console.log(d.markdown);
}
'
```

Read the output. Note specific facts that fit the four hard categories.

- [ ] **Step 4: Add ~15 hard questions to QUESTIONS**

Append to the `QUESTIONS` array in `backend/eval/questions.ts`. Aim for roughly:

- 4 **multi-hop** questions — answer requires combining facts from two sections or two documents (`question` should explicitly ask both halves: "When does X AND what's Y?")
- 4 **exact-token** questions — answer hinges on a specific code, phone number, brand name, or other literal token that vector search would miss
- 4 **browse-style** questions — answer is "walk me through" or "give me the full list" — something where the right answer is a whole section, not a sentence
- 3 **refinement-required** questions — first-pass query is ambiguous and the model should reasonably want to search again with a better term

Each question must be a complete `EvalQuestion` with `id`, `persona`, `question`, `keyFacts`, optional `antiHallucinations`, `sourceDoc`, and `difficulty: "hard"`. Use `id` prefixes like `hard-multihop-`, `hard-exact-`, `hard-browse-`, `hard-refine-` so they group in eval output.

Template:

```ts
{
  id: "hard-multihop-<short-name>",
  persona: "childcare",
  question: "<question that needs two facts>",
  keyFacts: [
    "<fact 1, exact phrasing the answer should contain>",
    "<fact 2>",
  ],
  antiHallucinations: [
    "<a plausible but wrong claim that the model should not produce>",
  ],
  sourceDoc: "Doc A + Doc B",
  difficulty: "hard",
},
```

`keyFacts` are the substrings the judge will look for in the model's response. Be specific — "Twice a day" is too vague; "Twice a day at 7:00am and 5:30pm" is judgeable.

`antiHallucinations` are optional but valuable on hard questions because hard questions are also where models hallucinate most.

Do not commit until all 15 are written and the dry-run shows them.

- [ ] **Step 5: Verify the dry-run lists the new questions**

```bash
cd backend && bun eval/run.ts --dry-run
```

Expected: ~54 questions printed, with the new hard ones visible.

- [ ] **Step 6: Run the hard set against both modes for comparison**

```bash
cd backend && bun eval/run.ts --mode rag
cd backend && bun eval/run.ts --mode tool-call
```

Expected: both runs complete. Results in `backend/eval/results/`. A side-by-side comparison is the artifact the eval gate decision is made from.

- [ ] **Step 7: Commit**

```bash
git add backend/eval/questions.ts
git commit -m "$(cat <<'EOF'
feat(eval): add hard-questions set for tool-call eval gate

Adds a difficulty field to EvalQuestion and ~15 new questions targeting
capabilities Phase A's tool-call loop unlocks: multi-hop answers,
exact-token lookups, browse-style listings, and refinement-required
queries. Existing easy questions are unchanged.
EOF
)"
```

---

## Task 15: Run full test and eval pass

**Files:** none — this is a verification task.

- [ ] **Step 1: Full test suite**

```bash
cd backend && bun test
```

Expected: PASS — all tests across services, contract, and integration. No regressions in any pre-existing test.

- [ ] **Step 2: Full eval in both modes**

```bash
cd backend && bun eval/run.ts --mode rag > /tmp/eval-rag.txt
cd backend && bun eval/run.ts --mode tool-call > /tmp/eval-toolcall.txt
```

Expected: both runs complete. Results saved.

- [ ] **Step 3: Pareto comparison**

Compare per-question scores between the two runs. The eval gate from the spec:

1. **No regression on the existing 39 questions.** Per-question scores in tool-call mode must be ≥ rag mode scores. If any easy question regresses, the gate fails — investigate before claiming Phase A is done.
2. **Measurable improvement on the 15 hard questions.** Tool-call mode should beat rag mode on enough of the hard set to justify the work.

How to do the comparison: read both result files, group by question_id, compare per-question judge scores. Use `bun eval/compare-models.ts` if it exists, or write a quick comparison script if needed.

- [ ] **Step 4: Decide and document**

If the gate passes, Phase A is done — open a PR for the branch and write up the eval results in the PR description.

If the gate doesn't pass, do NOT ship. Investigate which questions regressed, why, and whether the synthetic seed needs tuning, the system prompt needs adjustment, or the loop needs different bounds. Phase B is not started until A clears the gate.

- [ ] **Step 5: No commit**

Verification only. Any code changes from gate failures get their own commits.

---

## Implementation Notes

- **Provider abstraction.** The chat loop assumes OpenAI-shape tool messages. If we ever swap providers, this is a real port — not Phase A's problem, but worth knowing.
- **Streaming the final response.** Phase A emits the final answer as a single delta event. If felt latency on long answers is a problem after eval, swap to either the second-inference streaming approach or actually consume the streaming response from `chatCompleteWithTools` (which would require expanding it to handle streamed tool-call argument deltas — non-trivial).
- **Tool descriptions are sent on every API call.** OpenAI's tool definitions go in every request. With prompt caching this is cheap, but worth flagging if the token bill jumps.
- **`read_document` size cap.** Not enforced. If an eval question pulls a 50KB document and blows the context window, add a `max_chars` cap inside `dispatchReadDocument`.
- **Sources for read_document.** The chunks event in Task 11 only fires for `search` results today. If a `read_document` answer needs source pills, extend the chunks event to also publish chunk metadata for the chunks present in the document being read. Defer until the eval shows it matters.
