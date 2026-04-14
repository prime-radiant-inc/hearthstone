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
