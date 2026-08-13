import path from "node:path";

import type { Config, ScanResult, ScannedNode } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import { analyze } from "../index.js";

/**
 * Built by `test-fixtures/build-py-fixture-repo.sh`, which deps' `pretest`
 * runs (AD-14). As on the TS side, the universe is hand-written rather than
 * produced by scanner: deps must be testable against the contract alone.
 */
const REPO = path.resolve(
  import.meta.dirname,
  "../../../../test-fixtures/.generated/python-imports-repo",
);

const CONFIG: Config = {
  windowAnchor: "2026-01-01T00:00:00Z",
  windowDays: 365,
  excludes: [],
  layers: {},
  hotspotThreshold: 0.5,
};

const module_ = (id: string): ScannedNode => ({
  id,
  kind: "module",
  parent: null,
  path: id,
  layer: "other",
  loc: 0,
});

const file = (filePath: string, parent: string | null): ScannedNode => ({
  id: filePath,
  kind: "file",
  parent,
  path: filePath,
  layer: "other",
  loc: 1,
});

const scan = (nodes: readonly ScannedNode[]): ScanResult => ({
  nodes,
  stats: {
    files: nodes.filter((n) => n.kind === "file").length,
    loc: 0,
    languages: {},
  },
  warnings: [],
});

const UNIVERSE: ScannedNode[] = [
  module_("app"),
  module_("core"),
  module_("lib"),
  file("flat.py", null),
  file("broken.py", null),
  file("app/__init__.py", "app"),
  file("app/service.py", "app"),
  file("app/util.py", "app"),
  file("core/__init__.py", "core"),
  file("core/engine.py", "core"),
  file("core/helpers.py", "core"),
  file("core/model.py", "core"),
  file("lib/pkg/__init__.py", "lib"),
  file("lib/pkg/deep/__init__.py", "lib"),
  file("lib/pkg/tools.py", "lib"),
];

const run = (
  nodes: readonly ScannedNode[] = UNIVERSE,
): ReturnType<typeof analyze> =>
  analyze({ root: REPO, scan: scan(nodes) }, CONFIG);

const fileEdges = (result: Awaited<ReturnType<typeof analyze>>): string[] =>
  result.edges
    .filter((edge) => edge.source.endsWith(".py"))
    .map((edge) => `${edge.source} -> ${edge.target}`);

const countOf = (
  result: Awaited<ReturnType<typeof analyze>>,
  code: string,
): number => result.warnings.find((w) => w.code === code)?.count ?? 0;

describe("python import edges (AC-3)", () => {
  it("resolves absolute intra-repo imports, both `import a.b` and `from a import b`", async () => {
    const edges = fileEdges(await run());

    expect(edges).toContain("flat.py -> app/service.py");
    expect(edges).toContain("flat.py -> core/model.py");
    expect(edges).toContain("core/__init__.py -> core/model.py");
    // `import core.model as m` — the alias changes nothing about the target.
    expect(edges).toContain("core/engine.py -> core/model.py");
  });

  it("falls back to the package's __init__.py when the name is a symbol", async () => {
    // `from core import MISSING_SYMBOL`: not a submodule, so the dependency is
    // the package itself.
    expect(fileEdges(await run())).toContain("flat.py -> core/__init__.py");
  });

  it("resolves relative imports at every level", async () => {
    const edges = fileEdges(await run());

    // `from . import util` and `from .util import helper`
    expect(edges).toContain("app/__init__.py -> app/util.py");
    expect(edges).toContain("app/service.py -> app/util.py");
    // `from ..core.engine import Engine` — two dots climb to the repo root.
    expect(edges).toContain("app/service.py -> core/engine.py");
    // `from .helpers import *` — a wildcard names the module and nothing else.
    expect(edges).toContain("core/engine.py -> core/helpers.py");
    // `from . import deep` — a sibling *package*, so its __init__.py.
    expect(edges).toContain("lib/pkg/tools.py -> lib/pkg/deep/__init__.py");
  });

  it("resolves absolute imports against a source root below the repo root", async () => {
    // lib/pkg is imported as `pkg`, the layout streamlit uses.
    expect(fileEdges(await run())).toContain(
      "lib/pkg/deep/__init__.py -> lib/pkg/tools.py",
    );
  });

  it("counts stdlib and site-packages as external, never as edges", async () => {
    const result = await run();

    // os, numpy, json, __future__ ×2, os.path
    expect(countOf(result, "external-import")).toBe(6);
    expect(
      result.edges.some((edge) =>
        /(^|\/)(os|json|numpy|__future__)/.test(edge.target),
      ),
    ).toBe(false);
  });

  it("counts a relative import that names nothing as unresolved", async () => {
    const result = await run();

    // `from .missing import absent` and `from ...outside import gone`
    expect(countOf(result, "unresolved-import")).toBe(2);
  });

  it("produces exactly the expected edge set", async () => {
    expect(fileEdges(await run()).sort()).toEqual([
      "app/__init__.py -> app/service.py",
      "app/__init__.py -> app/util.py",
      "app/service.py -> app/util.py",
      "app/service.py -> core/engine.py",
      "core/__init__.py -> core/model.py",
      "core/engine.py -> core/helpers.py",
      "core/engine.py -> core/model.py",
      "flat.py -> app/service.py",
      "flat.py -> core/__init__.py",
      "flat.py -> core/model.py",
      "lib/pkg/deep/__init__.py -> lib/pkg/tools.py",
      "lib/pkg/tools.py -> lib/pkg/deep/__init__.py",
    ]);
  });
});

describe("aggregation and determinism (AC-5)", () => {
  it("aggregates module edges from the python file pairs", async () => {
    const result = await run();
    const moduleEdges = result.edges.filter(
      (edge) => !edge.source.endsWith(".py"),
    );

    // Only app/service.py -> core/engine.py crosses a module boundary; the
    // top-level files have no parent and contribute no module edge (D6).
    expect(moduleEdges).toEqual([
      { source: "app", target: "core", kind: "import", weight: 1 },
    ]);
  });

  it("is byte-identical across runs and independent of node order", async () => {
    const first = JSON.stringify(await run());
    const second = JSON.stringify(await run());
    const reversed = JSON.stringify(await run([...UNIVERSE].reverse()));

    expect(second).toBe(first);
    expect(reversed).toBe(first);
  });
});

describe("a broken file (AC-4)", () => {
  it("contributes no edges, one warning, and does not fail the stage", async () => {
    const result = await run();

    expect(countOf(result, "unparsable-file")).toBe(1);
    expect(
      result.warnings.find((w) => w.code === "unparsable-file")?.detail,
    ).toBe("broken.py");
    expect(result.edges.some((edge) => edge.source === "broken.py")).toBe(
      false,
    );
  });
});

describe("progress", () => {
  it("counts both languages on one scale", async () => {
    const seen: [number, number][] = [];
    await analyze({ root: REPO, scan: scan(UNIVERSE) }, CONFIG, (done, total) =>
      seen.push([done, total]),
    );

    const pythonFiles = UNIVERSE.filter((node) =>
      node.path.endsWith(".py"),
    ).length;
    expect(seen.at(-1)).toEqual([pythonFiles, pythonFiles]);
    expect(seen.map(([done]) => done)).toEqual(
      Array.from({ length: pythonFiles }, (_, index) => index + 1),
    );
  });
});
