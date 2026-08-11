// The assemble stage: merge the three analyzer results into one
// `AnalysisDocument` and validate it against the contract schema.
//
// It merges; it does not aggregate. Module-level edges and co-change pairs are
// already aggregated inside deps and githist (AD-1, ADR-0005) — recomputing
// them here would give the pipeline two opinions about the same numbers.
//
// The stable sorts are re-applied even though the analyzers sort their own
// output: after a merge the ordering is this stage's promise, and FR-7's
// byte-identical guarantee is measured on what this function returns.
import {
  formatValidationErrors,
  validateAnalysis,
  type AnalysisDocument,
  type AnalysisEdge,
  type AnalysisNode,
  type CochangePair,
  type Config,
  type DepsResult,
  type GitResult,
  type NodeHistory,
  type ScanResult,
} from "@gitnebula/contract";

import { StageError } from "./errors.js";
import type { RepoInfo } from "./repo.js";

/** The stage name this module aborts under (AD-7). */
export const ASSEMBLE_STAGE = "assemble";

export interface AssembleInput {
  readonly repo: RepoInfo;
  /** Run start, injected by cli and by nobody else (AD-4). */
  readonly analyzedAt: string;
  readonly config: Config;
  readonly scan: ScanResult;
  readonly deps: DepsResult;
  readonly git: GitResult;
}

/** History for a node githist never mentioned: present, and honestly empty. */
const NO_HISTORY: NodeHistory = {
  churn: 0,
  commits: 0,
  authors: 0,
  lastChangedAt: null,
};

/**
 * Builds the document and validates it.
 *
 * @throws {StageError} stage `assemble` when the result does not satisfy the
 * contract schema — which is a gitnebula bug, never a user error, and says so.
 */
export function assemble(input: AssembleInput): AnalysisDocument {
  const analysis: AnalysisDocument = {
    schemaVersion: "1.0",
    repo: {
      name: input.repo.name,
      remoteUrl: input.repo.remoteUrl,
      analyzedAt: input.analyzedAt,
      defaultBranch: input.repo.defaultBranch,
      analysisWindowDays: input.config.windowDays,
      stats: {
        files: input.scan.stats.files,
        loc: input.scan.stats.loc,
        commits: input.git.commits,
        languages: sortKeys(input.scan.stats.languages),
      },
    },
    nodes: mergeNodes(input.scan, input.git),
    edges: sortEdges(input.deps.edges),
    cochanges: sortCochanges(input.git.cochanges),
  };

  const result = validateAnalysis(analysis);
  if (!result.valid) {
    throw new StageError(
      ASSEMBLE_STAGE,
      `the assembled analysis does not match the contract schema:\n${formatValidationErrors(result.errors)}`,
      "this is a gitnebula bug — please open an issue with the output above",
    );
  }

  return result.data;
}

function mergeNodes(scan: ScanResult, git: GitResult): AnalysisNode[] {
  return scan.nodes
    .map((node): AnalysisNode => {
      const history = git.history[node.id] ?? NO_HISTORY;
      return {
        id: node.id,
        kind: node.kind,
        parent: node.parent,
        path: node.path,
        layer: node.layer,
        loc: node.loc,
        churn: history.churn,
        commits: history.commits,
        authors: history.authors,
        lastChangedAt: history.lastChangedAt,
        // AD-10: present, required, null-valued until the describe layer exists.
        description: null,
        descriptionSource: null,
      };
    })
    .sort((left, right) => compare(left.id, right.id));
}

function sortEdges(edges: readonly AnalysisEdge[]): AnalysisEdge[] {
  return [...edges].sort(
    (left, right) =>
      compare(left.source, right.source) || compare(left.target, right.target),
  );
}

function sortCochanges(pairs: readonly CochangePair[]): CochangePair[] {
  return [...pairs].sort(
    (left, right) =>
      right.count - left.count ||
      compare(left.a, right.a) ||
      compare(left.b, right.b),
  );
}

/**
 * Code-unit comparison, deliberately not `localeCompare`: FR-7's determinism
 * must not depend on the machine's locale.
 */
function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Key order is part of the emitted bytes, so maps are sorted too. */
function sortKeys(
  map: Readonly<Record<string, number>>,
): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(map).sort(compare)) {
    sorted[key] = map[key] as number;
  }
  return sorted;
}
