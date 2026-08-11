import { describe, expect, it } from "vitest";

import {
  CochangeAccumulator,
  MAX_COCHANGE_PAIRS_PER_KIND,
  MIN_COCHANGE_COUNT,
  sortCochanges,
} from "./cochange.js";

/** Records the same set of ids `times` times. */
function accumulate(times: number, ...ids: string[]): CochangeAccumulator {
  const accumulator = new CochangeAccumulator();
  for (let i = 0; i < times; i += 1) accumulator.add(ids);
  return accumulator;
}

describe("CochangeAccumulator", () => {
  it("emits nothing for a single-file commit", () => {
    expect(accumulate(5, "a.ts").bounded()).toEqual([]);
  });

  it("drops a pair below the count threshold (ADR-0005)", () => {
    expect(
      accumulate(MIN_COCHANGE_COUNT - 1, "a.ts", "b.ts").bounded(),
    ).toEqual([]);
  });

  it("keeps a pair at exactly the count threshold", () => {
    expect(accumulate(MIN_COCHANGE_COUNT, "a.ts", "b.ts").bounded()).toEqual([
      { a: "a.ts", b: "b.ts", count: 3 },
    ]);
  });

  it("treats a pair as unordered", () => {
    const accumulator = new CochangeAccumulator();
    accumulator.add(["b.ts", "a.ts"]);
    accumulator.add(["a.ts", "b.ts"]);
    accumulator.add(["b.ts", "a.ts"]);
    expect(accumulator.bounded()).toEqual([{ a: "a.ts", b: "b.ts", count: 3 }]);
  });

  it("counts a repeated id within one commit only once", () => {
    const accumulator = accumulate(3, "a.ts", "b.ts", "a.ts");
    expect(accumulator.bounded()).toEqual([{ a: "a.ts", b: "b.ts", count: 3 }]);
  });

  it("counts every pair of a three-file commit", () => {
    expect(accumulate(3, "c.ts", "a.ts", "b.ts").bounded()).toEqual([
      { a: "a.ts", b: "b.ts", count: 3 },
      { a: "a.ts", b: "c.ts", count: 3 },
      { a: "b.ts", b: "c.ts", count: 3 },
    ]);
  });

  it("caps at 500 pairs per kind, keeping the strongest", () => {
    const accumulator = new CochangeAccumulator();
    // 40 ids give 780 pairs; the ones involving `aaa` are made strongest so
    // the cap has something unambiguous to keep.
    const ids = Array.from(
      { length: 40 },
      (_, i) => `f${String(i).padStart(3, "0")}.ts`,
    );
    for (let i = 0; i < 3; i += 1) accumulator.add(ids);
    for (let i = 0; i < 5; i += 1) accumulator.add(["aaa.ts", "zzz.ts"]);

    const bounded = accumulator.bounded();
    expect(bounded).toHaveLength(MAX_COCHANGE_PAIRS_PER_KIND);
    expect(bounded[0]).toEqual({ a: "aaa.ts", b: "zzz.ts", count: 5 });
    expect(bounded.every((pair) => pair.count >= MIN_COCHANGE_COUNT)).toBe(
      true,
    );
  });

  it("produces the same bounded list whatever order commits arrive in", () => {
    const forwards = new CochangeAccumulator();
    const backwards = new CochangeAccumulator();
    const commits = [
      ["a.ts", "b.ts"],
      ["b.ts", "c.ts"],
      ["a.ts", "b.ts"],
      ["a.ts", "b.ts"],
      ["b.ts", "c.ts"],
      ["b.ts", "c.ts"],
    ];
    for (const ids of commits) forwards.add(ids);
    for (const ids of [...commits].reverse()) backwards.add(ids);
    expect(forwards.bounded()).toEqual(backwards.bounded());
  });
});

describe("sortCochanges", () => {
  it("orders by count descending, then a, then b (ADR-0005)", () => {
    expect(
      sortCochanges([
        { a: "b/", b: "c/", count: 2 },
        { a: "a/", b: "z/", count: 2 },
        { a: "a/", b: "b/", count: 2 },
        { a: "z/", b: "z2/", count: 9 },
      ]),
    ).toEqual([
      { a: "z/", b: "z2/", count: 9 },
      { a: "a/", b: "b/", count: 2 },
      { a: "a/", b: "z/", count: 2 },
      { a: "b/", b: "c/", count: 2 },
    ]);
  });

  it("does not mutate its input", () => {
    const pairs = [
      { a: "b/", b: "c/", count: 1 },
      { a: "a/", b: "c/", count: 9 },
    ];
    sortCochanges(pairs);
    expect(pairs[0]?.a).toBe("b/");
  });
});
