import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { AnalysisDocument } from "@gitnebula/contract";

import {
  buildStartHereModel,
  START_HERE_LIMIT,
  type StartHereModel,
} from "./start-here-model.js";
import {
  langgraphShapedDocument,
  langgraphShapedWithoutTests,
} from "../test-support/langgraph-shape.js";
import { loadContractFixture } from "../test-support/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));

function ids(
  model: StartHereModel,
  key: StartHereModel["categories"][number]["key"],
) {
  return model.categories
    .find((category) => category.key === key)!
    .entries.map((entry) => entry.id);
}

describe("start-here ranking — AC-1 categories", () => {
  const model = buildStartHereModel(langgraphShapedDocument());

  it("heads core with the file most of the repository's code rests on", () => {
    // typing.py: 7 importers × 40 lines = 280, the highest score in the
    // fixture. This is the measured shape of a real langgraph checkout,
    // scaled down — and unlike the barrels this rule was changed for, a type
    // module that everything imports genuinely is worth reading first.
    expect(ids(model, "core")[0]).toBe("langgraph/typing.py");
  });

  it("ranks core by imports × lines, descending (story 5.11)", () => {
    // Scores: typing 7×40=280, graph 3×61=183, pregel 3×47=141,
    // channels 2×54=108, runner 1×82=82.
    //
    // The order is the same as the old in-degree rule produced, which is worth
    // stating: this fixture was never the problem. graph.py and pregel.py used
    // to be an in-degree tie broken by id and are now separated by size, so
    // nothing here still exercises a genuine tie — the case below does.
    expect(ids(model, "core")).toEqual([
      "langgraph/typing.py",
      "langgraph/graph.py",
      "langgraph/pregel.py",
      "langgraph/channels.py",
      "bench/runner.py",
    ]);
  });

  it("heads entry points with the widest importer nobody imports", () => {
    expect(ids(model, "entry-points")).toEqual([
      "bench/__main__.py",
      "setup.py",
    ]);
  });

  it("keeps every test file out of entry points (AC-2)", () => {
    const entries = model.categories.find(
      (category) => category.key === "entry-points",
    )!.entries;
    expect(entries.every((entry) => entry.layer !== "test")).toBe(true);
    // tests/conftest.py has an entry point's degree signature (in 0 is false
    // here — it is imported — but the guard that matters is the layer one).
    expect(ids(model, "entry-points")).not.toContain("tests/conftest.py");
  });

  it("heads tests-as-documentation with the widest-importing test", () => {
    expect(ids(model, "tests")).toEqual([
      "tests/test_pregel.py",
      "tests/test_graph.py",
      "tests/conftest.py",
    ]);
  });

  it("produces three disjoint lists", () => {
    const all = model.categories.flatMap((category) =>
      category.entries.map((entry) => entry.id),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("ranks files only — a module is never a reading suggestion", () => {
    const all = model.categories.flatMap((category) => category.entries);
    expect(all.every((entry) => entry.kind === "file")).toBe(true);
  });

  it("counts file-level import edges only, never the module-level ones", () => {
    // The document carries module edges too (langgraph/ ← bench/, …). If they
    // were counted, bench/__main__.py would stop being an entry point and
    // langgraph/typing.py's in-degree would be inflated by its directory's.
    const core = model.categories.find((c) => c.key === "core")!.entries;
    // Seven files import typing.py. The module-level edge langgraph/ ← bench/
    // carries weight 3 and must not add to that.
    //
    // Asserted on `inDegree` rather than on `metric`: since story 5.11 the
    // ranking score is `imports × lines`, and this test is about what counts
    // as an import, not about how the score is composed from it.
    const typing = core.find((entry) => entry.id === "langgraph/typing.py")!;
    expect(typing.inDegree).toBe(7);
    expect(typing.metric).toBe(7 * typing.loc);
  });
});

describe("start-here ranking — core is not a barrel list (story 5.11)", () => {
  /**
   * The maintainer's finding, reduced to its smallest reproduction: a barrel
   * that every file imports and nobody reads, against the file that actually
   * explains the repository.
   *
   * The numbers are the measured ones from this repository —
   * `contract/src/index.ts` at 38 lines with 57 importers, `engine/engine.ts`
   * at 1,694 lines with 13. Under the old in-degree rule the barrel came
   * first and the engine did not make the list at all.
   */
  function barrelVersusEngine(): AnalysisDocument {
    const base = loadContractFixture("single-module");
    const file = (
      path: string,
      loc: number,
    ): AnalysisDocument["nodes"][number] => ({
      id: path,
      kind: "file",
      parent: "src/",
      path,
      layer: "backend",
      loc,
      churn: 0.5,
      commits: 4,
      authors: 1,
      lastChangedAt: "2026-01-01T00:00:00.000Z",
      description: null,
      descriptionSource: null,
    });

    const importers = Array.from({ length: 57 }, (_, i) =>
      file(`src/consumer-${String(i).padStart(2, "0")}.ts`, 60),
    );
    const nodes = [
      file("src/index.ts", 38),
      file("src/engine.ts", 1694),
      ...importers,
    ];
    // Every consumer imports the barrel; the first 13 also import the engine.
    const edges = importers.flatMap((consumer, i) => [
      {
        source: consumer.id,
        target: "src/index.ts",
        kind: "import" as const,
        weight: 1,
      },
      ...(i < 13
        ? [
            {
              source: consumer.id,
              target: "src/engine.ts",
              kind: "import" as const,
              weight: 1,
            },
          ]
        : []),
    ]);
    return { ...base, nodes, edges, cochanges: [] };
  }

  const model = buildStartHereModel(barrelVersusEngine());

  it("puts the file with the most code above the one with the most importers", () => {
    // 13 × 1,694 = 22,022 beats 57 × 38 = 2,166. This is the whole change:
    // in-degree measures ubiquity, and ubiquity concentrates in re-exports.
    expect(ids(model, "core")[0]).toBe("src/engine.ts");
  });

  it("still lists the barrel — demoted, not hidden", () => {
    // It genuinely is imported by everything, and a reader who wants to know
    // that should be able to see it. The fix is the ordering, not a filter:
    // a rule that dropped files would have to decide what a barrel *is*, and
    // the contract carries no such fact.
    expect(ids(model, "core")).toContain("src/index.ts");
  });

  it("prints both numbers, so the order is explicable from the row", () => {
    const engine = model.categories
      .find((category) => category.key === "core")!
      .entries.find((entry) => entry.id === "src/engine.ts")!;
    expect(engine.metricLabel).toBe("13 importers · 1,694 lines");
  });

  it("breaks a genuine score tie on id, by code point (NFR-12)", () => {
    // Coverage the rule change would otherwise have dropped silently: the
    // langgraph fixture's in-degree ties are now separated by size, so this is
    // the only place a tie is still exercised. Two files, equal score by
    // construction (2 × 100 and 4 × 50), decided by id and never by the order
    // they arrive in.
    const base = loadContractFixture("single-module");
    const file = (
      path: string,
      loc: number,
    ): AnalysisDocument["nodes"][number] => ({
      id: path,
      kind: "file",
      parent: "src/",
      path,
      layer: "backend",
      loc,
      churn: 0.1,
      commits: 1,
      authors: 1,
      lastChangedAt: "2026-01-01T00:00:00.000Z",
      description: null,
      descriptionSource: null,
    });
    const nodes = [
      file("src/zebra.ts", 100),
      file("src/alpha.ts", 50),
      file("src/c1.ts", 10),
      file("src/c2.ts", 10),
      file("src/c3.ts", 10),
      file("src/c4.ts", 10),
    ];
    const edges = [
      {
        source: "src/c1.ts",
        target: "src/zebra.ts",
        kind: "import" as const,
        weight: 1,
      },
      {
        source: "src/c2.ts",
        target: "src/zebra.ts",
        kind: "import" as const,
        weight: 1,
      },
      {
        source: "src/c1.ts",
        target: "src/alpha.ts",
        kind: "import" as const,
        weight: 1,
      },
      {
        source: "src/c2.ts",
        target: "src/alpha.ts",
        kind: "import" as const,
        weight: 1,
      },
      {
        source: "src/c3.ts",
        target: "src/alpha.ts",
        kind: "import" as const,
        weight: 1,
      },
      {
        source: "src/c4.ts",
        target: "src/alpha.ts",
        kind: "import" as const,
        weight: 1,
      },
    ];
    const tied = buildStartHereModel({
      ...base,
      nodes,
      edges,
      cochanges: [],
    });
    const core = tied.categories.find((category) => category.key === "core")!;
    const scores = new Map(
      core.entries.map((entry) => [entry.id, entry.metric]),
    );
    expect(scores.get("src/alpha.ts")).toBe(200);
    expect(scores.get("src/zebra.ts")).toBe(200);
    expect(ids(tied, "core").slice(0, 2)).toEqual([
      "src/alpha.ts",
      "src/zebra.ts",
    ]);

    // Same document, reversed: the tie must not fall to insertion order.
    const reversed = buildStartHereModel({
      ...base,
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
      cochanges: [],
    });
    expect(ids(reversed, "core").slice(0, 2)).toEqual([
      "src/alpha.ts",
      "src/zebra.ts",
    ]);
  });

  it("names the rule in the blurb rather than leaving it implicit", () => {
    const core = model.categories.find((category) => category.key === "core")!;
    expect(core.blurb).toBe(
      "the most code that the rest of the repository depends on",
    );
  });
});

describe("start-here ranking — NFR-12 determinism", () => {
  it("yields a byte-identical list across two computations", () => {
    const document = langgraphShapedDocument();
    const first = JSON.stringify(buildStartHereModel(document));
    const second = JSON.stringify(buildStartHereModel(document));
    expect(first).toBe(second);
  });

  it("does not depend on the order nodes and edges arrive in", () => {
    const document = langgraphShapedDocument();
    const shuffled = {
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
    };
    expect(JSON.stringify(buildStartHereModel(shuffled))).toBe(
      JSON.stringify(buildStartHereModel(document)),
    );
  });

  it("never reaches for localeCompare in the story's own sources", () => {
    // The ban is the point of the rule, so it is asserted against the source
    // rather than inferred from behaviour: a locale-dependent comparison makes
    // the list a function of the reader's machine (NFR-12, AD-6).
    const sources = [
      "start-here-model.ts",
      "start-here.ts",
      join("..", "test-support", "langgraph-shape.ts"),
    ];
    for (const file of sources) {
      // A *call*, not the word: the module's own doc comment names the ban it
      // is holding, and a bare substring check would forbid explaining it.
      expect(readFileSync(join(here, file), "utf8")).not.toMatch(
        /\.localeCompare\s*\(/,
      );
    }
  });
});

describe("start-here ranking — UX-DR14 empty states", () => {
  it("names the cause and the exit when a repository has no test layer", () => {
    const model = buildStartHereModel(langgraphShapedWithoutTests());
    const tests = model.categories.find((c) => c.key === "tests")!;
    expect(tests.entries).toEqual([]);
    expect(tests.empty.cause).toContain("layer: test");
    expect(tests.empty.exit.length).toBeGreaterThan(0);
  });

  it("survives a document with no edges at all", () => {
    const model = buildStartHereModel(loadContractFixture("single-module"));
    expect(model.categories).toHaveLength(3);
    for (const category of model.categories) {
      expect(category.entries).toEqual([]);
      expect(category.empty.cause.length).toBeGreaterThan(0);
    }
  });

  it("survives an empty document", () => {
    const model = buildStartHereModel(loadContractFixture("empty-graph"));
    expect(model.categories.every((c) => c.entries.length === 0)).toBe(true);
  });
});

describe("start-here ranking — presentation limit", () => {
  it("shows at most START_HERE_LIMIT entries per category", () => {
    const model = buildStartHereModel(
      loadContractFixture("synthetic-100x2000"),
    );
    for (const category of model.categories) {
      expect(category.entries.length).toBeLessThanOrEqual(START_HERE_LIMIT);
    }
  });

  it("keeps the full ranking behind the sliced view", () => {
    const model = buildStartHereModel(
      loadContractFixture("synthetic-100x2000"),
    );
    const core = model.categories.find((c) => c.key === "core")!;
    expect(core.total).toBeGreaterThan(core.entries.length);
  });
});
