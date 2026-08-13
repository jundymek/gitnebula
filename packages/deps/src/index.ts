// @gitnebula/deps — import parsing producing dependency edges at both graph
// levels. Story 2.2 covers TS/JS via the TypeScript compiler API (ADR-0001);
// story 3.1 adds Python beside it, behind the same collect/resolve seam.
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Config, DepsResult, ScanResult } from "@gitnebula/contract";

import { buildEdges, type FilePair } from "./edges.js";
import { analyzePythonSources, pythonSourcesOf } from "./python/analyze.js";
import { collectSpecifiers, isTsJsPath } from "./ts/collect.js";
import { createResolver } from "./ts/resolve.js";
import { createWarningCounter } from "./warnings.js";

export { isTsJsPath } from "./ts/collect.js";
export { isPythonPath } from "./python/collect.js";
export { grammarPath } from "./python/parser.js";
export type { WarningCode } from "./warnings.js";

export const packageName = "@gitnebula/deps";

/**
 * What deps needs beyond the contract: an absolute repo root. `ScannedNode.path`
 * is repo-relative and the resolved `Config` carries no root, so a bare
 * `ScanResult` cannot be opened — and putting a root into the contract would be
 * a contract change, which is never a side effect of another story
 * (DECISIONS.md D1). Everything else here is contract-typed (AD-3).
 */
export interface DepsInput {
  /** Absolute path the `ScanResult` paths are relative to. */
  readonly root: string;
  /** The closed universe: deps resolves into it and never beyond it (AD-13). */
  readonly scan: ScanResult;
}

/** Fire-and-forget progress, per AD-3. */
export type ProgressReporter = (done: number, total: number) => void;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Repo-relative POSIX path of an absolute path inside `root`, or `undefined`
 * when the path escapes the repo entirely.
 */
function relativeToRoot(root: string, absolute: string): string | undefined {
  const relative = toPosix(path.relative(root, absolute));
  return relative === "" ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
    ? undefined
    : relative;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * A relative specifier the TypeScript resolver cannot follow, looked up
 * literally in the scan universe. This is how a stylesheet, a font or any
 * other non-code asset next to a component becomes an edge: those are real
 * repository files and real dependencies, but `ts.resolveModuleName` only
 * knows module extensions. Measured on excalidraw, this is the difference
 * between a 21% and a 0% unresolved rate (DECISIONS.md D9).
 */
function resolveAssetInUniverse(
  sourcePath: string,
  specifier: string,
  idByPath: ReadonlyMap<string, string>,
): string | undefined {
  const target = toPosix(
    path.posix.normalize(
      path.posix.join(path.posix.dirname(sourcePath), specifier),
    ),
  );
  return target.startsWith("../") ? undefined : idByPath.get(target);
}

/**
 * Parses every TS/JS file in the scan universe, resolves its imports with the
 * repo's own TypeScript configuration and returns file-level and module-level
 * import edges (ADR-0005).
 *
 * Nothing here throws on bad input: an unparsable file, an unresolvable
 * specifier, a dependency in node_modules and a file the scanner excluded are
 * each dropped and counted under their own code (AD-7). `config` is accepted
 * for the AD-3 analyzer signature; deps has no configurable behaviour in MVP —
 * exclusion is scanner's, the analysis window is githist's.
 */
export async function analyze(
  input: DepsInput,
  config: Config,
  onProgress?: ProgressReporter,
): Promise<DepsResult> {
  void config;

  const root = path.resolve(input.root);
  const warnings = createWarningCounter();
  const resolver = createResolver(root);

  const idByPath = new Map<string, string>();
  const parentById = new Map<string, string | null>();
  for (const node of input.scan.nodes) {
    parentById.set(node.id, node.parent);
    if (node.kind === "file") idByPath.set(node.path, node.id);
  }

  // Sorted so that both the work order and the example kept on each warning
  // are the same on every run (AD-4).
  const sources = input.scan.nodes
    .filter((node) => node.kind === "file" && isTsJsPath(node.path))
    .map((node) => ({ id: node.id, path: node.path }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const pythonSources = pythonSourcesOf(input.scan.nodes);

  // One progress scale over both languages: a repo is one stage to the reader,
  // whatever it is written in.
  const total = sources.length + pythonSources.length;

  const pairs: FilePair[] = [];
  let done = 0;

  for (const source of sources) {
    const absolute = path.join(root, source.path);
    let text: string;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      // Listed by the scanner but unreadable now: same class of failure as a
      // file that does not parse, and the same non-fatal treatment.
      warnings.record("unparsable-file", source.path);
      onProgress?.(++done, total);
      continue;
    }

    const { specifiers, parseFailed } = collectSpecifiers(absolute, text);
    if (parseFailed) {
      warnings.record("unparsable-file", source.path);
      onProgress?.(++done, total);
      continue;
    }

    for (const specifier of specifiers) {
      const example = `${specifier} in ${source.path}`;
      const resolved = resolver.resolve(specifier, absolute);

      if (resolved === undefined) {
        if (isRelativeSpecifier(specifier)) {
          // A relative specifier names a file in this repo. If it is one the
          // scanner listed, it is an edge whatever its extension; otherwise it
          // is either excluded from the universe or genuinely missing, and we
          // cannot tell those apart from here — the honest count is
          // "unresolved".
          const assetId = resolveAssetInUniverse(
            source.path,
            specifier,
            idByPath,
          );
          if (assetId !== undefined) {
            pairs.push({ source: source.id, target: assetId });
            continue;
          }
          warnings.record("unresolved-import", example);
          continue;
        }
        // A bare specifier resolves to nothing: a package, or a Node builtin.
        // It is never an intra-repo edge — and zero-config means gitnebula
        // runs on checkouts with no node_modules installed, where every
        // dependency looks unresolvable (D9). A specifier the repo aliased to
        // its own source is exempt: that one is a real miss worth counting.
        warnings.record(
          resolver.isPathAliased(specifier, absolute)
            ? "unresolved-import"
            : "external-import",
          example,
        );
        continue;
      }
      // Universe membership is decided before externality, and deliberately:
      // in a pnpm/yarn workspace an intra-repo package resolves *through* a
      // node_modules symlink but *to* a repo file, which TypeScript reports
      // back as its real path. That is a real edge — it is how gitnebula draws
      // its own monorepo (D10).
      const relative = relativeToRoot(root, resolved.fileName);
      const targetId =
        relative === undefined ? undefined : idByPath.get(relative);
      if (targetId !== undefined) {
        pairs.push({ source: source.id, target: targetId });
        continue;
      }

      warnings.record(
        resolved.external ? "external-import" : "outside-universe-import",
        example,
      );
    }

    onProgress?.(++done, total);
  }

  // Two parsers, one output path (AC-5): the Python half produces the same
  // `FilePair`s, records into the same counters, and its edges are aggregated
  // and sorted by the same `buildEdges` as the TS half's.
  pairs.push(
    ...(await analyzePythonSources(pythonSources, {
      root,
      idByPath,
      warnings,
      onFileDone: () => onProgress?.(++done, total),
    })),
  );

  return {
    edges: buildEdges(pairs, parentById),
    warnings: warnings.toArray(),
  };
}
