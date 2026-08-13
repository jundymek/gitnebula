// AC-6 / FR-11: the unresolved-import rate on a real repository. Opt-in,
// because the default suite is offline (AD-8) and this one needs a checkout:
//
//   GITNEBULA_MEASURE_REPO=/path/to/excalidraw pnpm --filter @gitnebula/deps test
//
// The numbers this produced, and the commits they came from, are recorded in
// docs/dev/epic-2/2.2-deps-ts-imports/README.md (excalidraw, TS/JS) and
// docs/dev/epic-3/3.1-deps-python/README.md (streamlit, both languages).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Config, ScanResult, ScannedNode } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import { analyze, isPythonPath, isTsJsPath } from "./index.js";

const REPO = process.env.GITNEBULA_MEASURE_REPO;
/** Optional: where to write the measurement, for pasting into the docs. */
const OUT = process.env.GITNEBULA_MEASURE_OUT;

const CONFIG: Config = {
  windowAnchor: "2026-01-01T00:00:00Z",
  windowDays: 365,
  excludes: [],
  layers: {},
  hotspotThreshold: 0.5,
};

/**
 * A stand-in for scanner (story 2.1, a sibling branch): enough of a walk to
 * produce a universe to measure against. Every file is a node, not only the
 * TS/JS ones — a component importing its stylesheet depends on a repo file,
 * and a universe of code alone would report that as an unresolved import.
 * Modules are the first two path segments, which is close enough for a rate:
 * the rate counts specifiers, and module grouping does not move it.
 */
const SKIP = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  // Python's equivalents of node_modules and dist, all of them scanner
  // exclusions too: a checked-out venv would otherwise flood the universe.
  ".venv",
  "venv",
  "site-packages",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
]);

function walk(root: string, relative = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (SKIP.has(entry.name)) continue;
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(root, child));
    else if (entry.isFile()) found.push(child);
  }
  return found;
}

function universeOf(root: string): ScanResult {
  const files = walk(root).sort();
  const modules = new Set(
    files
      .map((file) => file.split("/").slice(0, 2).join("/"))
      .filter((id) => id.includes("/")),
  );

  const nodes: ScannedNode[] = [
    ...[...modules].sort().map((id): ScannedNode => ({
      id,
      kind: "module",
      parent: null,
      path: id,
      layer: "other",
      loc: 0,
    })),
    ...files.map((file): ScannedNode => {
      const moduleId = file.split("/").slice(0, 2).join("/");
      return {
        id: file,
        kind: "file",
        parent: modules.has(moduleId) ? moduleId : null,
        path: file,
        layer: "other",
        loc:
          isTsJsPath(file) || isPythonPath(file)
            ? readFileSync(path.join(root, file), "utf8").split("\n").length
            : 0,
      };
    }),
  ];

  return {
    nodes,
    stats: { files: files.length, loc: 0, languages: {} },
    warnings: [],
  };
}

describe.skipIf(REPO === undefined)("unresolved-import rate (AC-6)", () => {
  it("stays at or below the FR-11 threshold of 20%", async () => {
    const root = path.resolve(REPO ?? ".");
    const scan = universeOf(root);
    const started = performance.now();
    const result = await analyze({ root, scan }, CONFIG);
    const elapsedMs = Math.round(performance.now() - started);

    const count = (code: string): number =>
      result.warnings.find((warning) => warning.code === code)?.count ?? 0;

    const isSource = (file: string): boolean =>
      isTsJsPath(file) || isPythonPath(file);
    const resolved = result.edges.filter((edge) =>
      isSource(edge.source),
    ).length;
    const external = count("external-import");
    const outside = count("outside-universe-import");
    const unresolved = count("unresolved-import");
    const specifiers = resolved + external + outside + unresolved;
    // externals are ignored by design (FR-11), not failures to resolve, so the
    // rate is measured over the specifiers that could have become an edge.
    const candidates = specifiers - external;
    const rate = candidates === 0 ? 0 : unresolved / candidates;

    const measurement = JSON.stringify(
      {
        repo: root,
        files: scan.nodes.filter((node) => node.kind === "file").length,
        tsJsFiles: scan.nodes.filter(
          (node) => node.kind === "file" && isTsJsPath(node.path),
        ).length,
        pythonFiles: scan.nodes.filter(
          (node) => node.kind === "file" && isPythonPath(node.path),
        ).length,
        tsJsEdges: result.edges.filter((edge) => isTsJsPath(edge.source))
          .length,
        pythonEdges: result.edges.filter((edge) => isPythonPath(edge.source))
          .length,
        specifiers,
        resolvedEdges: resolved,
        external,
        outsideUniverse: outside,
        unresolved,
        unparsableFiles: count("unparsable-file"),
        elapsedMs,
        unresolvedRateOverCandidates: Number(rate.toFixed(4)),
        unresolvedRateOverAllSpecifiers: Number(
          (unresolved / Math.max(specifiers, 1)).toFixed(4),
        ),
      },
      null,
      2,
    );
    console.log(measurement);
    if (OUT !== undefined) writeFileSync(OUT, `${measurement}\n`);

    expect(rate).toBeLessThanOrEqual(0.2);
  }, 300_000);
});
