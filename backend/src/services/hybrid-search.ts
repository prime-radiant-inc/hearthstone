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
