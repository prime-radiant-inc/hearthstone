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
