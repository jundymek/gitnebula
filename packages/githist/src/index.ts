// @gitnebula/githist — churn, authors and co-change from one `git log` pass.
//
// AD-3: one entry point, `analyze(input, config, onProgress?)`, taking
// contract-typed values; spawning git is this analyzer's single declared side
// effect. AD-4: no clock and no randomness — the window comes from
// `config.windowAnchor` and every emitted list has a fixed stable sort.

import type {
  AnalyzerWarning,
  Config,
  GitResult,
  NodeHistory,
  ScanResult,
  ScannedNode,
} from "@gitnebula/contract";

import {
  BULK_COMMIT_FILE_LIMIT,
  CochangeAccumulator,
  sortCochanges,
} from "./cochange.js";
import { readGitLog, type RawCommit } from "./git-log.js";
import {
  emptyActivity,
  percentile95,
  recordCommit,
  toIsoUtc,
  toNodeHistory,
  type NodeActivity,
} from "./metrics.js";
import { RenameChain, resolvedPaths } from "./renames.js";

/**
 * Scaffold seam from story 1.1, still consumed by cli's package-wiring test.
 * The `contractEdge` half is gone: this package now imports real contract
 * types, which is what that seam stood in for.
 */
export const packageName = "@gitnebula/githist";

const MILLIS_PER_DAY = 86_400_000;

/**
 * githist's input. `ScanResult` is the contract-typed part — the closed
 * universe of AD-13; `root` is the repository this analyzer runs git in,
 * because `ScannedNode.path` is repo-relative and `Config` carries no root.
 * The contract exports result shapes, not input envelopes, so this type is
 * declared here; the field name matches deps' wrapper so cli sees one shape
 * across both analyzers (DECISIONS D1).
 */
export interface GitHistInput {
  /** Path to the repository working tree. */
  readonly root: string;
  /** The scanner's output — the only paths that may appear in the result. */
  readonly scan: ScanResult;
}

export type ProgressReporter = (done: number, total: number) => void;

/**
 * Reads the analysis window's history and derives per-node metrics and bounded
 * co-change pairs.
 *
 * @throws when git is missing or the path is not a repository — a stage-level
 * failure in AD-7 terms, which cli renders as `«stage»: «cause» — «remedy»`. A
 * repository that simply has no commits is not a failure: it yields zeros.
 */
export async function analyze(
  input: GitHistInput,
  config: Config,
  onProgress?: ProgressReporter,
): Promise<GitResult> {
  const { since, until } = analysisWindow(config);
  const commits = await readGitLog(input.root, since, until);
  return computeGitResult(commits, input.scan, onProgress);
}

/** The window as ISO instants: `[anchor − windowDays, anchor]` (AD-13). */
export function analysisWindow(config: Config): {
  since: string;
  until: string;
} {
  const anchor = Date.parse(config.windowAnchor);
  if (Number.isNaN(anchor)) {
    throw new Error(
      `windowAnchor is not an ISO instant: ${JSON.stringify(config.windowAnchor)}`,
    );
  }
  return {
    since: new Date(anchor - config.windowDays * MILLIS_PER_DAY).toISOString(),
    until: new Date(anchor).toISOString(),
  };
}

/**
 * The pure half: parsed commits (newest first) plus the scan universe in,
 * `GitResult` out. Kept separate from the git spawn so every rule here —
 * rename mapping, universe filtering, churn, co-change bounds — is testable
 * without a repository.
 */
export function computeGitResult(
  commits: readonly RawCommit[],
  scan: ScanResult,
  onProgress?: ProgressReporter,
): GitResult {
  const filesByPath = new Map<string, ScannedNode>();
  const activity = new Map<string, NodeActivity>();
  const moduleIds = new Set<string>();

  for (const node of scan.nodes) {
    // Every node in the universe gets an entry, so an untouched node reports
    // an explicit zero rather than leaving cli to invent a default (D7).
    activity.set(node.id, emptyActivity());
    if (node.kind === "file") filesByPath.set(node.path, node);
    else moduleIds.add(node.id);
  }

  const chain = new RenameChain();
  const fileCochanges = new CochangeAccumulator();
  const moduleCochanges = new CochangeAccumulator();
  const dropped = new Counter();
  const bulk = new Counter();
  const orphanModules = new Counter();
  let lastCommitAt: number | null = null;

  for (const [index, commit] of commits.entries()) {
    if (lastCommitAt === null || commit.committedAt > lastCommitAt) {
      lastCommitAt = commit.committedAt;
    }

    const paths = resolvedPaths(commit, chain);
    const touchedFiles: string[] = [];
    const touchedModules = new Set<string>();

    for (const path of paths) {
      const node = filesByPath.get(path);
      if (node === undefined) {
        // AD-13: history reaches outside the scanner's universe (deleted
        // files, excluded directories). Dropped, never silently (AD-7).
        dropped.hit(path);
        continue;
      }
      touchedFiles.push(node.id);
      if (node.parent === null) continue;
      if (moduleIds.has(node.parent)) touchedModules.add(node.parent);
      else orphanModules.hit(node.parent);
    }

    for (const id of touchedFiles) {
      record(activity, id, commit);
    }
    // ADR-0003: a module's commits are counted directly — a commit touching
    // three files of one module counts once, never summed from its files.
    for (const id of touchedModules) {
      record(activity, id, commit);
    }

    if (paths.length > BULK_COMMIT_FILE_LIMIT) {
      // Measured on what the commit touched, before universe filtering (D8):
      // the size of the commit is what makes its pairs noise.
      bulk.hit(commit.hash);
    } else {
      fileCochanges.add(touchedFiles);
      moduleCochanges.add([...touchedModules]);
    }

    chain.observe(commit);
    onProgress?.(index + 1, commits.length);
  }

  return {
    history: buildHistory(scan.nodes, activity),
    cochanges: sortCochanges([
      ...fileCochanges.bounded(),
      ...moduleCochanges.bounded(),
    ]),
    commits: commits.length,
    lastCommitAt: toIsoUtc(lastCommitAt),
    warnings: [
      dropped.warning("path-outside-universe"),
      bulk.warning("bulk-commit-skipped"),
      orphanModules.warning("unknown-module-parent"),
    ].filter((warning): warning is AnalyzerWarning => warning !== null),
  };
}

function record(
  activity: Map<string, NodeActivity>,
  id: string,
  commit: RawCommit,
): void {
  const entry = activity.get(id);
  if (entry !== undefined) {
    recordCommit(entry, commit.committedAt, commit.authorEmail);
  }
}

/** Normalizes each kind against its own P95 and keys the result by node id. */
function buildHistory(
  nodes: readonly ScannedNode[],
  activity: Map<string, NodeActivity>,
): Record<string, NodeHistory> {
  const p95 = new Map<string, number>();
  for (const kind of ["module", "file"] as const) {
    const active = nodes
      .filter((node) => node.kind === kind)
      .map((node) => activity.get(node.id)?.commits ?? 0)
      .filter((commits) => commits >= 1);
    p95.set(kind, percentile95(active));
  }

  const history: Record<string, NodeHistory> = {};
  // Sorted by id so the emitted object's key order is stable across runs
  // (AD-4) — JSON.stringify preserves insertion order.
  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const entry = activity.get(node.id) ?? emptyActivity();
    history[node.id] = toNodeHistory(entry, p95.get(node.kind) ?? 0);
  }
  return history;
}

/** A named drop counter: the count plus one example, as AD-7 asks for. */
class Counter {
  #count = 0;
  #detail: string | undefined;

  hit(detail: string): void {
    this.#count += 1;
    this.#detail ??= detail;
  }

  warning(code: string): AnalyzerWarning | null {
    if (this.#count === 0) return null;
    return this.#detail === undefined
      ? { code, count: this.#count }
      : { code, count: this.#count, detail: this.#detail };
  }
}

export {
  BULK_COMMIT_FILE_LIMIT,
  MAX_COCHANGE_PAIRS_PER_KIND,
  MIN_COCHANGE_COUNT,
} from "./cochange.js";
export { gitLogArgs } from "./git-log.js";
export type { RawChange, RawCommit } from "./git-log.js";
