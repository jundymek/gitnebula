import { describe, expect, it } from "vitest";

import { fuzzySearch, scoreMatch } from "./fuzzy.js";

const ids = [
  "packages/viz/src/engine/graph.ts",
  "packages/viz/src/engine/render.ts",
  "packages/viz/src/chrome/legend.ts",
  "packages/scanner/src/index.ts",
  "packages/githist/src/churn.ts",
  "README.md",
];

function search(query: string, limit = 7): string[] {
  return fuzzySearch(ids, query, (id) => id, limit).map((match) => match.item);
}

describe("scoreMatch", () => {
  it("rejects a query that is not a subsequence", () => {
    expect(scoreMatch("graph.ts", "zzz")).toBeNull();
  });

  it("accepts characters spread across the haystack", () => {
    const match = scoreMatch("packages/viz/src/engine/graph.ts", "pvg");
    expect(match).not.toBeNull();
    expect(match!.positions).toHaveLength(3);
  });

  it("reports the matched positions in order", () => {
    const match = scoreMatch("graph.ts", "gts")!;
    expect(match.positions).toEqual([0, 6, 7]);
  });

  it("is case-insensitive in both directions", () => {
    expect(scoreMatch("README.md", "readme")).not.toBeNull();
    expect(scoreMatch("readme.md", "README")).not.toBeNull();
  });

  it("treats an empty query as a zero-score match, not a failure", () => {
    expect(scoreMatch("anything", "")).toEqual({ score: 0, positions: [] });
  });

  it("scores a consecutive run above a scattered one", () => {
    const consecutive = scoreMatch("xxgraphxx", "graph")!;
    const scattered = scoreMatch("g-r-a-p-h", "graph")!;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("scores a segment-boundary match above a mid-word one", () => {
    const boundary = scoreMatch("src/graph.ts", "g")!;
    const midWord = scoreMatch("src/aagaa.ts", "g")!;
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it("prefers a shorter haystack when both match the same way", () => {
    const short = scoreMatch("graph.ts", "graph")!;
    const long = scoreMatch("graph.ts.backup.long.name", "graph")!;
    expect(short.score).toBeGreaterThan(long.score);
  });
});

describe("fuzzySearch", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("finds a file by its basename", () => {
    expect(search("churn")[0]).toBe("packages/githist/src/churn.ts");
  });

  it("finds a path by segment initials", () => {
    // The query a developer actually types for engine/graph.ts.
    expect(search("engraph")[0]).toBe("packages/viz/src/engine/graph.ts");
  });

  it("caps the result list at the limit — FR-18's top 7", () => {
    // "s" appears in every id here; the cap is what keeps the listbox short.
    expect(search("s", 7).length).toBeLessThanOrEqual(7);
    expect(search("s", 3)).toHaveLength(3);
  });

  it("excludes non-matching candidates entirely", () => {
    expect(search("qqqq")).toEqual([]);
  });

  it("is deterministic: the same query yields the same order", () => {
    expect(search("src")).toEqual(search("src"));
  });

  it("breaks score ties alphabetically rather than by input order", () => {
    const tied = ["b/x.ts", "a/x.ts"];
    const result = fuzzySearch(tied, "x.ts", (id) => id, 7).map((m) => m.item);
    expect(result).toEqual(["a/x.ts", "b/x.ts"]);
  });

  it("ranks an exact basename above an incidental subsequence", () => {
    const result = search("render");
    expect(result[0]).toBe("packages/viz/src/engine/render.ts");
  });
});
