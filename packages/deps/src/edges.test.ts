import { describe, expect, it } from "vitest";

import { buildEdges, type FilePair } from "./edges.js";

/** app/*, core/* in modules; `loose.ts` deliberately belongs to no module. */
const PARENTS = new Map<string, string | null>([
  ["app", null],
  ["core", null],
  ["app/a.ts", "app"],
  ["app/b.ts", "app"],
  ["core/x.ts", "core"],
  ["core/y.ts", "core"],
  ["loose.ts", null],
]);

const pair = (source: string, target: string): FilePair => ({ source, target });

describe("buildEdges", () => {
  it("deduplicates file pairs and gives every file edge weight 1 (AC-3)", () => {
    const edges = buildEdges(
      [pair("app/a.ts", "core/x.ts"), pair("app/a.ts", "core/x.ts")],
      PARENTS,
    );
    expect(edges.filter((edge) => edge.source === "app/a.ts")).toEqual([
      { source: "app/a.ts", target: "core/x.ts", kind: "import", weight: 1 },
    ]);
  });

  it("aggregates module weight from distinct file pairs (ADR-0005)", () => {
    const edges = buildEdges(
      [
        pair("app/a.ts", "core/x.ts"),
        pair("app/a.ts", "core/y.ts"),
        pair("app/b.ts", "core/x.ts"),
        // A repeat of the first pair must not inflate the module weight.
        pair("app/a.ts", "core/x.ts"),
      ],
      PARENTS,
    );
    expect(edges).toContainEqual({
      source: "app",
      target: "core",
      kind: "import",
      weight: 3,
    });
  });

  it("emits no module edge inside one module or for module-less files (D6)", () => {
    const edges = buildEdges(
      [pair("app/a.ts", "app/b.ts"), pair("loose.ts", "core/x.ts")],
      PARENTS,
    );
    expect(edges.map((edge) => edge.source)).toEqual(["app/a.ts", "loose.ts"]);
  });

  it("drops a file importing itself", () => {
    expect(buildEdges([pair("app/a.ts", "app/a.ts")], PARENTS)).toEqual([]);
  });

  it("sorts both levels by source then target, whatever the input order", () => {
    const input = [
      pair("core/y.ts", "app/b.ts"),
      pair("app/a.ts", "core/x.ts"),
      pair("app/b.ts", "core/x.ts"),
      pair("app/a.ts", "core/y.ts"),
    ];
    const sorted = buildEdges(input, PARENTS).map(
      (edge) => `${edge.source} -> ${edge.target}`,
    );
    expect(sorted).toEqual([
      "app -> core",
      "app/a.ts -> core/x.ts",
      "app/a.ts -> core/y.ts",
      "app/b.ts -> core/x.ts",
      "core -> app",
      "core/y.ts -> app/b.ts",
    ]);
    // Same set, shuffled: identical output. This is the AD-4 property that
    // makes the fixture snapshot meaningful.
    expect(buildEdges([...input].reverse(), PARENTS)).toEqual(
      buildEdges(input, PARENTS),
    );
  });

  it("orders by code unit, not by locale", () => {
    const parents = new Map<string, string | null>([
      ["Z.ts", null],
      ["a.ts", null],
      ["b.ts", null],
    ]);
    // "Z" < "a" in code-unit order and "a" < "Z" under most locales; a
    // locale-sensitive sort would make output depend on the ICU build.
    const edges = buildEdges(
      [pair("a.ts", "b.ts"), pair("Z.ts", "b.ts")],
      parents,
    );
    expect(edges.map((edge) => edge.source)).toEqual(["Z.ts", "a.ts"]);
  });
});
