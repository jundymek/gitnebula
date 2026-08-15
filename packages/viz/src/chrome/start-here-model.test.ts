import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

  it("heads core with the most-imported non-test file", () => {
    // typing.py is imported by 7 files; nothing else comes close. This is the
    // measured shape of a real langgraph checkout, scaled down.
    expect(ids(model, "core")[0]).toBe("langgraph/typing.py");
  });

  it("ranks core by in-degree descending, ties broken on id", () => {
    // Two ties, both resolved by id and not by insertion order: graph.py and
    // pregel.py share in-degree 3, and bench/runner.py and checkpoint.py share
    // in-degree 1 — "b" < "l", so the file from the other package wins the
    // last visible slot.
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
    expect(
      core.find((entry) => entry.id === "langgraph/typing.py")!.metric,
    ).toBe(7);
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
