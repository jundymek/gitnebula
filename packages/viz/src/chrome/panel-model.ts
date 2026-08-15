/**
 * Everything the detail panel prints, derived from the document and one node
 * — with no DOM and no clock, so the derivation is testable on its own.
 *
 * The AD-1 line matters here: `viz` **selects and sorts** what the pipeline
 * already computed, it never computes a new aggregation. The co-change section
 * is the case that tempts otherwise — the contract carries same-kind
 * `cochanges` pairs, and the panel lists the ones touching the selected node.
 * Rolling a file's partners up into modules would be an aggregation, so a file
 * shows its file partners and a module shows its module partners, which is the
 * shape the contract already ships (story 5.6, AC-5).
 */

import type {
  AnalysisDocument,
  CochangePair,
  NodeKind,
} from "@gitnebula/contract";

import type { EngineNode } from "../engine/index.js";
import {
  type EmptyState,
  noChangeInWindow,
  noCochangeState,
  outOfWindowState,
  zeroHistoryState,
} from "./empty-state.js";
import {
  EMPTY_METRIC,
  formatInteger,
  formatPercent,
  formatRelativeTime,
} from "./format.js";
import { githubNodeUrl } from "./github.js";

/** How many co-change partners the section leads with (story 3.4's AC-1). */
export const COCHANGE_LIMIT = 3;

/**
 * The shared-commit count below which `githist` drops a pair (ADR-0005).
 *
 * Restated here rather than imported: `viz` may depend on `@gitnebula/contract`
 * and nothing else (AD-2), and the bound is deliberately analyzer policy that
 * does not travel in `analysis.json` — the schema says so in as many words
 * ("Bounds — count threshold, per-kind cap — are analyzer policy, not contract
 * shape"). `HOT_THRESHOLD` is restated in the Viewer for the same reason.
 *
 * It is used for copy only. Nothing here filters on it: the pipeline already
 * did, and re-applying a threshold the Viewer merely believes in is how the
 * two would drift apart.
 */
export const MIN_COCHANGE_COUNT = 3;

/** One `label / value` line of the panel, in the mockup's order. */
export interface MetricRow {
  readonly label: string;
  readonly value: string;
  /**
   * True for the rows the analysis window applies to (story 5.5, AC-1).
   *
   * The panel groups these under a caption naming the window, which is how
   * each of them states the window it covers without four labels repeating
   * the same `365d` suffix.
   */
  readonly history?: boolean;
  /**
   * True when the value is *absent* rather than zero — the distinction AC-2
   * exists to make visible.
   */
  readonly empty?: boolean;
}

/**
 * Which empty state the panel is in, so the caller can tell the two apart
 * without matching on copy.
 *
 * `repo-zero-history` deliberately WINS over `node-out-of-window`: when the
 * whole repository caught nothing in the window, every node is out of window,
 * and repeating the per-node sentence on all of them is precisely the failure
 * AC-3 names. The repository states it once and the node stays quiet.
 */
export type PanelNoticeKind = "repo-zero-history" | "node-out-of-window";

export interface PanelNotice extends EmptyState {
  readonly kind: PanelNoticeKind;
}

export interface PanelModel {
  readonly id: string;
  /** Heading: the module id, or a file's basename. */
  readonly name: string;
  /** Repository-relative path, printed under the heading (AC-1). */
  readonly path: string;
  /** `module · backend` (mockup). */
  readonly kindLine: string;
  readonly hot: boolean;
  readonly rows: readonly MetricRow[];
  /** Churn bar width as a CSS percentage — the same number the row prints. */
  readonly churnPercent: string;
  /** Null when the remote is absent or not GitHub: the button is not drawn. */
  readonly githubUrl: string | null;
  /** The window every history row covers, from the document (AC-1). */
  readonly windowDays: number;
  /**
   * The caption over the history rows: `history · last 365 days`.
   *
   * This is how AC-1 is met. The window is stated once for the group rather
   * than suffixed onto every label, because `last change 365d` is not a
   * label anyone can read — and a labelled group states the window for each
   * metric inside it to a screen reader as well as to the eye.
   */
  readonly historyCaption: string;
  /** The panel-level empty state, or null when there is history to show. */
  readonly notice: PanelNotice | null;
  /** Story 5.6's section: what has historically changed with this node. */
  readonly blastRadius: BlastRadius;
}

/**
 * What the blast-radius section prints (story 5.6, FR-27).
 *
 * Everything here is *read* from `document.cochanges`. The Viewer computes no
 * new aggregation (AD-1): it selects the pairs touching one node and orders
 * them, which is selection and sorting, not analysis.
 */
export interface BlastRadius {
  /** Every partner, count descending then `id` ascending (AC-1). */
  readonly partners: readonly CochangePartner[];
  /**
   * The level the partners are at — always the selected node's own kind.
   *
   * On the model rather than left to the reader to infer, because AC-5 asks
   * for module and file pairs to be unambiguous: a file's section says
   * "files", a module's says "modules", and the two can never be confused for
   * one another even when the ids look alike.
   */
  readonly level: NodeKind;
  /** The section's caption, naming the level and the window it covers. */
  readonly caption: string;
  /**
   * Why the section is empty, or null when it has partners.
   *
   * This is the majority case, not the exception: measured on a real langgraph
   * checkout, 610 of 662 nodes appear in no pair at all (AC-3).
   */
  readonly empty: EmptyState | null;
  /**
   * True when the section says nothing at all, because the panel already said
   * it (story 5.5's precedence rule, kept).
   *
   * A repository whose window caught no commit has no co-change anywhere, and
   * the panel-level notice states that once, at the top. A section repeating
   * it underneath would print the same sentence twice per node and blame the
   * node for a property of the repository — precisely what 5.5's AC-3 forbids,
   * and what its test asserts by counting the panel's notices.
   */
  readonly suppressed: boolean;
}

export interface PanelModelOptions {
  /** Reference instant for the relative last-change row. */
  readonly now?: number;
}

export function buildPanelModel(
  document: AnalysisDocument,
  node: EngineNode,
  options: PanelModelOptions = {},
): PanelModel {
  const partners = cochangePartners(document, node);
  const churnPercent = formatPercent(node.churn);
  // The window is read from the document on every build, never from a
  // constant. `--window-days` makes it configurable, so a hardcoded 90 would
  // start lying the first time anyone uses that flag (AC-1).
  const windowDays = document.repo.analysisWindowDays;
  // No commits at all inside the window — a property of the repository, not
  // of the selected node.
  const repoIsQuiet = document.repo.stats.commits === 0;
  // No commit inside the window touched THIS node. A real contract state, and
  // on a real repository the common one.
  const nodeIsQuiet = node.lastChangedAt === null;

  return {
    id: node.id,
    name: displayName(node),
    path: node.path,
    kindLine: `${node.kind} · ${node.layer}`,
    hot: node.hot,
    churnPercent,
    windowDays,
    historyCaption: `history · last ${windowDays} days`,
    notice: buildNotice(windowDays, repoIsQuiet, nodeIsQuiet),
    blastRadius: buildBlastRadius(node.kind, partners, windowDays, repoIsQuiet),
    githubUrl: githubNodeUrl(
      document.repo.remoteUrl,
      document.repo.defaultBranch,
      node.path,
      node.kind,
    ),
    rows: [
      {
        label: "files",
        // Files have no members; the mockup prints the em dash rather than a
        // zero, which would read as "an empty module".
        value:
          node.kind === "module"
            ? formatInteger(countMembers(document, node.id))
            : EMPTY_METRIC,
      },
      { label: "loc", value: formatInteger(node.loc) },
      {
        label: `churn ${windowDays}d`,
        value: churnPercent,
        history: true,
      },
      { label: "authors", value: formatInteger(node.authors), history: true },
      {
        label: "last change",
        // The row that made this story necessary. `—` says "the tool has
        // nothing"; this says "the repository was quiet", which is the truth.
        value: nodeIsQuiet
          ? noChangeInWindow(windowDays)
          : formatRelativeTime(node.lastChangedAt, options.now),
        history: true,
        empty: nodeIsQuiet,
      },
      // Story 3.4's `co-changes with` row USED to sit here, printing the top
      // three partners as one joined string. Story 5.6 folds it into the
      // blast-radius section below rather than leaving the same datum rendered
      // twice in one panel: the section names the same three first, and adds
      // the rest, the counts, the level and a way to navigate there — none of
      // which a single metric row can carry.
    ],
  };
}

function buildNotice(
  windowDays: number,
  repoIsQuiet: boolean,
  nodeIsQuiet: boolean,
): PanelNotice | null {
  // AC-3 before AC-2: a repository with no history at all says so once, and
  // suppresses the per-node sentence that would otherwise repeat on every
  // node the reader opens.
  if (repoIsQuiet) {
    return { kind: "repo-zero-history", ...zeroHistoryState(windowDays) };
  }
  if (nodeIsQuiet) {
    return { kind: "node-out-of-window", ...outOfWindowState(windowDays) };
  }
  return null;
}

/** A file shows its basename; a module keeps its trailing-slash id (mockup). */
function displayName(node: EngineNode): string {
  if (node.kind === "module") return node.id;
  const parts = node.path.split("/");
  return parts[parts.length - 1] || node.path;
}

function countMembers(document: AnalysisDocument, moduleId: string): number {
  // Membership lives only on `parent` — the contract has no membership edges
  // (ADR-0005), so this is the one place it can be counted from.
  let count = 0;
  for (const candidate of document.nodes) {
    if (candidate.parent === moduleId) count++;
  }
  return count;
}

/** Partner id + count, most-co-changed first, then by id for a stable tie. */
export interface CochangePartner {
  readonly id: string;
  readonly count: number;
}

/**
 * Every co-change partner of one node, ordered count-descending then `id`
 * ascending (story 5.6, AC-1).
 *
 * The **whole** list, not a top-N: the section shows all of them, and the
 * three-partner summary is this list's head. One derivation feeding both is
 * what keeps the summary and the section from ever disagreeing.
 */
export function cochangePartners(
  document: AnalysisDocument,
  node: EngineNode,
): readonly CochangePartner[] {
  // AC-5: a file's section must never show a module pair as if it were the
  // file's own. The contract's pairs are already same-kind, but a document is
  // validated for shape, not for that invariant — and the two levels share one
  // array, so an unfiltered read would mix them the moment a document did.
  const sameKind = new Set(
    document.nodes
      .filter((candidate) => candidate.kind === node.kind)
      .map((candidate) => candidate.id),
  );

  const partners: CochangePartner[] = [];
  for (const pair of document.cochanges) {
    const partner = partnerOf(pair, node.id);
    if (partner === null || !sameKind.has(partner)) continue;
    partners.push({ id: partner, count: pair.count });
  }

  return partners.sort((a, b) => b.count - a.count || compareIds(a.id, b.id));
}

/** The section's first few, which is what story 3.4's row named (AC-1). */
export function topCochanges(
  document: AnalysisDocument,
  node: EngineNode,
  limit: number = COCHANGE_LIMIT,
): readonly CochangePartner[] {
  return cochangePartners(document, node).slice(0, limit);
}

/**
 * Explicit code-unit comparison, never a locale-aware one (NFR-12, AC-1).
 *
 * The same call `githist/src/cochange.ts` made when it ordered these pairs on
 * the way in, and for the same reason: locale-aware collation makes the order
 * depend on the machine that rendered it, so two readers of one
 * `analysis.json` could see two different lists. `blast-radius.test.ts` scans
 * this file's source to keep the ban total — which is why the name of the
 * banned method is not written here.
 */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function buildBlastRadius(
  kind: NodeKind,
  partners: readonly CochangePartner[],
  windowDays: number,
  repoIsQuiet: boolean,
): BlastRadius {
  const level = kind === "module" ? "modules" : "files";
  return {
    partners,
    level: kind,
    // The window belongs in the caption for the same reason it does over the
    // history rows (story 5.5): these counts are commits *inside* it, and a
    // count with no window attached is a number the reader cannot place.
    caption: `blast radius · ${level} · last ${windowDays} days`,
    // 5.5's precedence rule, kept. A quiet repository states its case once, at
    // panel level; this section adds nothing to it.
    suppressed: partners.length === 0 && repoIsQuiet,
    empty:
      partners.length === 0 && !repoIsQuiet
        ? noCochangeState(windowDays, MIN_COCHANGE_COUNT)
        : null,
  };
}

function partnerOf(pair: CochangePair, id: string): string | null {
  if (pair.a === id) return pair.b;
  if (pair.b === id) return pair.a;
  return null;
}

/** `12 commits` — one partner's shared-commit count, as the section prints it. */
export function formatSharedCommits(count: number): string {
  return `${formatInteger(count)} ${count === 1 ? "commit" : "commits"}`;
}
