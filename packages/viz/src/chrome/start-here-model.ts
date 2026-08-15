/**
 * The start-here ranking (FR-26): what to read first in a repository you have
 * never seen, derived from the document and nothing else — no DOM, no engine,
 * no clock — so the derivation is testable on its own.
 *
 * Three categories, disjoint by construction:
 *
 * | category  | members                                   | ranked by      |
 * | --------- | ----------------------------------------- | -------------- |
 * | core      | non-test files that others import         | in-degree desc |
 * | entry     | non-test files nobody imports, that import| out-degree desc|
 * | tests     | files in the `test` layer                 | out-degree desc|
 *
 * Three rules this module exists to hold:
 *
 * - **Disjointness is real, not asserted.** AC-1 lists core as "non-test files
 *   ranked by in-degree" *and* promises the three lists are disjoint by
 *   construction. Unfiltered, core would contain every entry point at the
 *   bottom of its list, so core requires `inDegree > 0`. A file nobody imports
 *   is not the core of anything; it is an entry point, and it is listed there.
 * - **Determinism (NFR-12, AD-6).** Ties break on `id` with a code-point
 *   comparison. `localeCompare` appears nowhere in this story — it is
 *   locale-dependent, which would make the reading order a function of the
 *   reader's machine. `start-here-model.test.ts` greps the sources for it.
 * - **Degrees are file-level (ADR-0005).** `edges` carries import edges at
 *   *both* levels; a module edge's weight is the number of underlying file
 *   pairs. An edge counts only when both endpoints are file nodes, or a file's
 *   degree would be inflated by its directory's traffic.
 *
 * `viz` selects and sorts what the pipeline already computed (AD-1): in-degree
 * is a count of contract edges, not a new aggregation over the repository.
 */

import type { AnalysisDocument, Layer, NodeKind } from "@gitnebula/contract";

/** How many entries of each category the panel shows. */
export const START_HERE_LIMIT = 5;

export type StartHereCategoryKey = "core" | "entry-points" | "tests";

/** One suggestion: a file, and the number that earned it its place. */
export interface StartHereEntry {
  readonly id: string;
  /** Repository-relative path — what the row prints. */
  readonly path: string;
  /** Basename, the heading of the row. */
  readonly name: string;
  readonly kind: NodeKind;
  readonly layer: Layer;
  readonly inDegree: number;
  readonly outDegree: number;
  /** The ranking number for this category (in- or out-degree). */
  readonly metric: number;
  /** What that number means, printed beside it. */
  readonly metricLabel: string;
}

/**
 * UX-DR14 read literally: an empty state is a **cause** and an **exit**, one
 * sentence each. Never a bare zero, never "no data".
 */
export interface StartHereEmptyState {
  readonly cause: string;
  readonly exit: string;
}

export interface StartHereCategory {
  readonly key: StartHereCategoryKey;
  readonly title: string;
  /** One line saying what the category means, above the list. */
  readonly blurb: string;
  /** The top `START_HERE_LIMIT` of the ranking. */
  readonly entries: readonly StartHereEntry[];
  /** How many members the category has in total, before the slice. */
  readonly total: number;
  /** Printed instead of the list when `entries` is empty. */
  readonly empty: StartHereEmptyState;
}

export interface StartHereModel {
  readonly repoName: string;
  readonly categories: readonly StartHereCategory[];
}

interface Degrees {
  readonly in: number;
  readonly out: number;
}

/**
 * File-level in/out degree per node id. Module edges and self-edges are
 * skipped; a node absent from the map has degree zero.
 */
function fileDegrees(document: AnalysisDocument): Map<string, Degrees> {
  const files = new Set(
    document.nodes
      .filter((node) => node.kind === "file")
      .map((node) => node.id),
  );
  const degrees = new Map<string, { in: number; out: number }>();
  for (const id of files) degrees.set(id, { in: 0, out: 0 });

  for (const edge of document.edges) {
    if (edge.source === edge.target) continue;
    if (!files.has(edge.source) || !files.has(edge.target)) continue;
    degrees.get(edge.source)!.out += 1;
    degrees.get(edge.target)!.in += 1;
  }
  return degrees;
}

/** Code-point comparison — the same answer on every machine (NFR-12). */
function byIdAscending(a: StartHereEntry, b: StartHereEntry): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Descending on the ranking number, then ascending on `id`. */
function byMetricThenId(a: StartHereEntry, b: StartHereEntry): number {
  return b.metric - a.metric || byIdAscending(a, b);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function buildStartHereModel(
  document: AnalysisDocument,
): StartHereModel {
  const degrees = fileDegrees(document);

  /** Every file node with its degrees attached, before any partitioning. */
  const files = document.nodes
    .filter((node) => node.kind === "file")
    .map((node) => {
      const degree = degrees.get(node.id) ?? { in: 0, out: 0 };
      return {
        id: node.id,
        path: node.path,
        name: basename(node.path),
        kind: node.kind,
        layer: node.layer,
        inDegree: degree.in,
        outDegree: degree.out,
      };
    });

  const nonTest = files.filter((file) => file.layer !== "test");

  const core = nonTest
    .filter((file) => file.inDegree > 0)
    .map((file) => ({
      ...file,
      metric: file.inDegree,
      metricLabel: label(file.inDegree, "import"),
    }))
    .sort(byMetricThenId);

  const entryPoints = nonTest
    .filter((file) => file.inDegree === 0 && file.outDegree > 0)
    .map((file) => ({
      ...file,
      metric: file.outDegree,
      metricLabel: label(file.outDegree, "import"),
    }))
    .sort(byMetricThenId);

  const tests = files
    .filter((file) => file.layer === "test")
    .map((file) => ({
      ...file,
      metric: file.outDegree,
      metricLabel: label(file.outDegree, "import"),
    }))
    .sort(byMetricThenId);

  return {
    repoName: document.repo.name,
    categories: [
      category({
        key: "core",
        title: "core",
        blurb: "the files the rest of the repository imports",
        ranking: core,
        empty: {
          cause: "no file in this repository is imported by another one",
          exit: "start from the entry points below — they are what runs",
        },
      }),
      category({
        key: "entry-points",
        title: "entry points",
        blurb: "nobody imports these — they are where execution starts",
        ranking: entryPoints,
        empty: {
          cause:
            "every file here is imported by another one, so nothing reads as a starting point",
          exit: "start from core instead — it is ordered by how much depends on it",
        },
      }),
      category({
        key: "tests",
        title: "tests as documentation",
        blurb: "the tests that touch the most of the codebase",
        ranking: tests,
        empty: {
          cause: "no files with `layer: test` in this repository",
          exit: "read core and the entry points instead; there is no test suite to learn the behaviour from",
        },
      }),
    ],
  };
}

function category(input: {
  key: StartHereCategoryKey;
  title: string;
  blurb: string;
  ranking: readonly StartHereEntry[];
  empty: StartHereEmptyState;
}): StartHereCategory {
  return {
    key: input.key,
    title: input.title,
    blurb: input.blurb,
    entries: input.ranking.slice(0, START_HERE_LIMIT),
    total: input.ranking.length,
    empty: input.empty,
  };
}

/** `1 import` / `6 imports` — the unit the number is counted in. */
function label(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
