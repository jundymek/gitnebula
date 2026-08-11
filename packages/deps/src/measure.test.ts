// AC-6 / FR-11: the unresolved-import rate on a real repository. Opt-in,
// because the default suite is offline (AD-8) and this one needs a checkout:
//
//   GITNEBULA_MEASURE_REPO=/path/to/excalidraw pnpm --filter @gitnebula/deps test
//
// The numbers this produced, and the excalidraw commit they came from, are
// recorded in docs/dev/epic-2/2.2-deps-ts-imports/README.md.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Config, ScanResult, ScannedNode } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import { analyze, isTsJsPath } from "./index.js";

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
        loc: isTsJsPath(file)
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
    const result = await analyze({ root, scan }, CONFIG);

    const count = (code: string): number =>
      result.warnings.find((warning) => warning.code === code)?.count ?? 0;

    const resolved = result.edges.filter((edge) =>
      isTsJsPath(edge.source),
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
        specifiers,
        resolvedEdges: resolved,
        external,
        outsideUniverse: outside,
        unresolved,
        unparsableFiles: count("unparsable-file"),
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
