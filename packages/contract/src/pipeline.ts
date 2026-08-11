// Intermediate pipeline shapes (AD-1): the values scanner, deps and githist
// hand to cli. They are hand-written — only the `analysis.json` shape is
// generated (AD-9) — but they are derived from the generated types wherever
// they carry contract fields, so a schema change propagates here.
import type {
  AnalysisEdge,
  AnalysisNode,
  CochangePair,
  Layer,
  RepoStats,
} from "./generated/analysis.js";

/**
 * A counted, non-fatal drop. AD-7: per-item failures never throw, and no drop
 * is silent — each increments a named counter surfaced in the cli summary.
 */
export interface AnalyzerWarning {
  /** Stable identifier, e.g. `unresolved-import`, `unparsable-file`. */
  readonly code: string;
  /** How many items this warning covers. */
  readonly count: number;
  /** Optional example — one path or symbol, for the terminal summary. */
  readonly detail?: string;
}

/**
 * A node as the scanner knows it: structure without history. githist supplies
 * the remaining `AnalysisNode` fields.
 */
export type ScannedNode = Pick<
  AnalysisNode,
  "id" | "kind" | "parent" | "path" | "layer" | "loc"
>;

/**
 * scanner's output. Its node set is the **closed universe** (AD-13): deps and
 * githist drop anything outside it.
 */
export interface ScanResult {
  readonly nodes: readonly ScannedNode[];
  /** Static repo stats; `commits` is githist's to fill in. */
  readonly stats: Omit<RepoStats, "commits">;
  readonly warnings: readonly AnalyzerWarning[];
}

/** deps' output: import edges at both levels, already aggregated (ADR-0005). */
export interface DepsResult {
  readonly edges: readonly AnalysisEdge[];
  readonly warnings: readonly AnalyzerWarning[];
}

/** Per-node history metrics, keyed into the scan universe by node id. */
export type NodeHistory = Pick<
  AnalysisNode,
  "churn" | "commits" | "authors" | "lastChangedAt"
>;

/** githist's output: history metrics plus bounded co-change pairs. */
export interface GitResult {
  /** Node id to metrics. Nodes absent from the map have no history. */
  readonly history: Readonly<Record<string, NodeHistory>>;
  readonly cochanges: readonly CochangePair[];
  /** Commits in the analysis window, repo-wide. */
  readonly commits: number;
  /** Most recent commit instant in the window, or null on a zero-history repo. */
  readonly lastCommitAt: string | null;
  readonly warnings: readonly AnalyzerWarning[];
}

/**
 * The resolved configuration handed to every analyzer. Resolution happens
 * once, in cli (defaults < `.gitnebula.yml` < flags, AD-3); analyzers receive
 * this value and never read config, env or the clock themselves.
 */
export interface Config {
  /**
   * ISO instant the analysis window is measured back from (AD-13). cli
   * injects the run start; fixture tests pin it. This is why analyzers need
   * no clock.
   */
  readonly windowAnchor: string;
  /** Length of the analysis window in days. */
  readonly windowDays: number;
  /** Exclusion globs, matched only in scanner, with picomatch (AD-13). */
  readonly excludes: readonly string[];
  /** Glob to layer overrides, applied over the scanner's rule table (ADR-0002). */
  readonly layers: Readonly<Record<string, Layer>>;
  /** Hot spot cutoff on the normalized churn scale (ADR-0003, default 0.5). */
  readonly hotspotThreshold: number;
  /**
   * Post-MVP describe backend. Parsed, carried and ignored in MVP — cli
   * prints the ignored-in-MVP notice (FR-4, AD-10). Deliberately untyped:
   * MVP must not model a backend it does not implement.
   */
  readonly llm?: unknown;
}
