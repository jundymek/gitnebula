/**
 * This file was generated from analysis.schema.json — do not edit it by hand.
 * Change the schema and run `pnpm --filter @gitnebula/contract generate`.
 */

/**
 * A node is either a module (a derived directory grouping) or a file.
 */
export type NodeKind = "module" | "file";
/**
 * Architectural layer assigned by the scanner's rule table (ADR-0002).
 */
export type Layer = "backend" | "frontend" | "infra" | "test" | "other";

/**
 * gitnebula analysis.json — the single interface between the pipeline and the Viewer. Normative source of the generated TypeScript types (AD-9).
 */
export interface AnalysisDocument {
  /**
   * Contract version. Major changes are breaking and require their own story plus an ADR (AD-9).
   */
  schemaVersion: "1.0";
  repo: RepoMetadata;
  /**
   * Modules and files. Sorted by id (ADR-0005).
   */
  nodes: AnalysisNode[];
  /**
   * Import edges at both levels. Sorted by source then target (ADR-0005).
   */
  edges: AnalysisEdge[];
  /**
   * Bounded co-change pairs, file-file and module-module. Sorted by count descending then ids (ADR-0005).
   */
  cochanges: CochangePair[];
}
export interface RepoMetadata {
  /**
   * Repository name, derived from the remote or the directory.
   */
  name: string;
  /**
   * Origin remote URL, or null when the repository has no remote.
   */
  remoteUrl: string | null;
  /**
   * Run start instant. The only field allowed to differ between two runs on identical repo state (ADR-0005).
   */
  analyzedAt: string;
  defaultBranch: string;
  /**
   * Length of the analysis window in days. The window lives here, never in field names (ADR-0003).
   */
  analysisWindowDays: number;
  stats: RepoStats;
}
export interface RepoStats {
  /**
   * Analyzed files, after exclusions.
   */
  files: number;
  loc: number;
  /**
   * Commits in the analysis window.
   */
  commits: number;
  /**
   * Language name to share of analyzed lines, in 0..1.
   */
  languages: {
    [k: string]: number;
  };
}
export interface AnalysisNode {
  /**
   * Stable node identifier, unique across the document.
   */
  id: string;
  kind: NodeKind;
  /**
   * Id of the owning module, or null for a top-level node. Membership is expressed only here — there are no membership edges (ADR-0005).
   */
  parent: string | null;
  /**
   * Repository-relative path, POSIX separators.
   */
  path: string;
  layer: Layer;
  loc: number;
  /**
   * Normalized commit activity: min(1, commits / P95(commits over same-kind nodes with at least one commit)) (ADR-0003).
   */
  churn: number;
  /**
   * Commits in the analysis window touching this node. Module commits are counted directly, never summed from files (ADR-0003).
   */
  commits: number;
  /**
   * Distinct authors in the analysis window.
   */
  authors: number;
  /**
   * Most recent commit instant touching this node, or null when the node has no history in the repository.
   */
  lastChangedAt: string | null;
  /**
   * Reserved for the post-MVP describe layer. Present, required and null-valued in MVP (AD-10).
   */
  description: null;
  /**
   * Reserved for the post-MVP describe layer. Present, required and null-valued in MVP (AD-10).
   */
  descriptionSource: null;
}
export interface AnalysisEdge {
  /**
   * Id of the importing node.
   */
  source: string;
  /**
   * Id of the imported node.
   */
  target: string;
  kind: "import";
  /**
   * For a module edge, the number of underlying file-level import pairs; for a file edge, 1 (ADR-0005).
   */
  weight: number;
}
/**
 * An unordered pair of same-kind nodes that changed together. Bounds (count threshold, per-kind cap) are analyzer policy, not contract shape (PRD FR-7).
 */
export interface CochangePair {
  a: string;
  b: string;
  /**
   * Commits in the analysis window touching both nodes.
   */
  count: number;
}
