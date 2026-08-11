import path from "node:path";

import type { Config, ScanResult, ScannedNode } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import { analyze, isTsJsPath } from "./index.js";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../../test-fixtures/.generated",
);

/**
 * Built by `test-fixtures/build-ts-fixture-repo.sh`, which deps' `pretest`
 * runs (AD-14). The universe below is hand-written rather than produced by
 * scanner: deps must be testable against the contract alone, and story 2.1 is
 * a sibling branch.
 */
const REPO = path.join(FIXTURES, "ts-imports-repo");
const NO_CONFIG_REPO = path.join(FIXTURES, "ts-imports-repo-no-config");

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

/**
 * Everything the fixture tree holds except `vendored/secret.ts`, which exists
 * on disk and is deliberately left out — that omission is what makes an import
 * of it "outside the universe" rather than merely unresolved (AC-2).
 */
const FIXTURE_SCAN = scan([
  module_("app"),
  module_("core"),
  module_("legacy"),
  module_("shared"),
  module_("utils"),
  file("app/index.ts", "app"),
  file("app/view.css", "app"),
  file("app/view.ts", "app"),
  file("broken.ts", null),
  file("core/engine.ts", "core"),
  file("core/index.ts", "core"),
  file("core/lazy.ts", "core"),
  file("legacy/loader.js", "legacy"),
  file("main.ts", null),
  file("shared/util.ts", "shared"),
  file("utils/format.ts", "utils"),
  file("utils/pad.ts", "utils"),
]);

const warningCount = (
  result: Awaited<ReturnType<typeof analyze>>,
  code: string,
): number => result.warnings.find((w) => w.code === code)?.count ?? 0;

describe("analyze against the crafted TS fixture", () => {
  it("resolves every specifier form AC-1 names", async () => {
    const { edges } = await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG);
    const fileEdges = edges
      .filter((edge) => edge.source.includes("."))
      .map((edge) => `${edge.source} -> ${edge.target}`);

    expect(fileEdges).toEqual([
      // `export * from "./view"` — a re-export chain.
      "app/index.ts -> app/view.ts",
      // `export { engine } from "@/core"` — a `paths` alias onto an implicit
      // index.ts.
      "app/index.ts -> core/index.ts",
      // A stylesheet the TypeScript resolver cannot follow, matched against
      // the scan universe instead.
      "app/view.ts -> app/view.css",
      // The same target imported twice, once as a type: one edge.
      "app/view.ts -> utils/format.ts",
      // `import { pad } from "utils/pad"` — resolved through `baseUrl`.
      "app/view.ts -> utils/pad.ts",
      "core/engine.ts -> core/lazy.ts", // dynamic import() with a literal
      // Reached as "@fixture/shared" through a workspace symlink: node_modules
      // was the route, a repo file was the destination.
      "core/engine.ts -> shared/util.ts",
      "core/engine.ts -> utils/format.ts",
      "core/index.ts -> core/engine.ts",
      "legacy/loader.js -> utils/pad.ts", // JS require() with a literal
      "main.ts -> app/index.ts", // implicit index.ts
      "utils/format.ts -> utils/pad.ts",
    ]);
  });

  it("counts external, outside-universe and unresolved imports apart (AC-2)", async () => {
    const result = await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG);

    // react (in node_modules), zod (a package nothing installed) and
    // node:path (a builtin) — none of them a node in this repo.
    expect(warningCount(result, "external-import")).toBe(3);
    expect(warningCount(result, "outside-universe-import")).toBe(1); // vendored/secret.ts
    // ./nope, and @/missing — an alias the repo declares and nothing answers.
    expect(warningCount(result, "unresolved-import")).toBe(2);

    // None of the three produced an edge, at either level.
    const targets = result.edges.map((edge) => edge.target);
    expect(targets).not.toContain("react");
    expect(targets).not.toContain("zod");
    expect(targets.some((target) => target.includes("missing"))).toBe(false);
    expect(targets.some((target) => target.includes("vendored"))).toBe(false);
    expect(targets.some((target) => target.includes("nope"))).toBe(false);
  });

  it("aggregates module edges with weight = file-pair count (AC-3)", async () => {
    const { edges } = await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG);
    const moduleEdges = edges.filter((edge) => !edge.source.includes("."));

    expect(moduleEdges).toEqual([
      { source: "app", target: "core", kind: "import", weight: 1 },
      // app/view.ts reaches utils twice: via `@/utils/format` and `utils/pad`.
      { source: "app", target: "utils", kind: "import", weight: 2 },
      { source: "core", target: "shared", kind: "import", weight: 1 },
      { source: "core", target: "utils", kind: "import", weight: 1 },
      { source: "legacy", target: "utils", kind: "import", weight: 1 },
    ]);
    // main.ts (no module) and the two same-module pairs contribute none.
  });

  it("drops a syntax-error file with one counted warning, and finishes (AC-4)", async () => {
    const result = await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG);

    expect(result.warnings).toContainEqual({
      code: "unparsable-file",
      count: 1,
      detail: "broken.ts",
    });
    // broken.ts imports ./utils/format; a partially-parsed file must not leak
    // that edge.
    expect(result.edges.some((edge) => edge.source === "broken.ts")).toBe(
      false,
    );
    // The rest of the universe still parsed.
    expect(result.edges.length).toBeGreaterThan(10);
  });

  it("matches the committed snapshot and is identical across runs (AC-5)", async () => {
    const first = await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG);
    expect(first).toMatchSnapshot();

    const second = await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // Node order in the ScanResult must not leak into the output.
    const shuffled = await analyze(
      { root: REPO, scan: scan([...FIXTURE_SCAN.nodes].reverse()) },
      CONFIG,
    );
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(first));
  });

  it("reports progress once per parsed file", async () => {
    const seen: Array<[number, number]> = [];
    await analyze({ root: REPO, scan: FIXTURE_SCAN }, CONFIG, (done, total) =>
      seen.push([done, total]),
    );
    // The .css node is an edge *target*, never a file this stage parses.
    const sourceFiles = FIXTURE_SCAN.nodes.filter(
      (node) => node.kind === "file" && isTsJsPath(node.path),
    ).length;
    expect(seen).toHaveLength(sourceFiles);
    expect(seen.at(-1)).toEqual([sourceFiles, sourceFiles]);
  });
});

describe("analyze without a tsconfig.json (AC-7)", () => {
  const NO_CONFIG_SCAN = scan([
    file("entry.ts", null),
    file("helper.ts", null),
    file("nested/index.ts", null),
  ]);

  it("resolves relative and implicit-index imports on default resolution", async () => {
    const result = await analyze(
      { root: NO_CONFIG_REPO, scan: NO_CONFIG_SCAN },
      CONFIG,
    );

    expect(result.edges).toEqual([
      { source: "entry.ts", target: "helper.ts", kind: "import", weight: 1 },
      {
        source: "entry.ts",
        target: "nested/index.ts",
        kind: "import",
        weight: 1,
      },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("analyze on degenerate input", () => {
  it("returns an empty result for a universe with no TS/JS files", async () => {
    const result = await analyze(
      { root: REPO, scan: scan([file("README.md", null)]) },
      CONFIG,
    );
    expect(result).toEqual({ edges: [], warnings: [] });
  });

  it("counts a listed-but-missing file instead of throwing (AD-7)", async () => {
    const result = await analyze(
      { root: REPO, scan: scan([file("gone.ts", null)]) },
      CONFIG,
    );
    expect(result.edges).toEqual([]);
    expect(result.warnings).toEqual([
      { code: "unparsable-file", count: 1, detail: "gone.ts" },
    ]);
  });
});
