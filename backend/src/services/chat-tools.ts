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
  const rawLimit = Number(args?.limit ?? SEARCH_DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(rawLimit)))
    : SEARCH_DEFAULT_LIMIT;

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
