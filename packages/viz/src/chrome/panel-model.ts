/**
 * Everything the detail panel prints, derived from the document and one node
 * — with no DOM and no clock, so the derivation is testable on its own.
 *
 * The AD-1 line matters here: `viz` **selects and sorts** what the pipeline
 * already computed, it never computes a new aggregation. The co-change row is
 * the case that tempts otherwise — the contract carries same-kind
 * `cochanges` pairs, and the panel picks the top three touching the selected
 * node. Rolling a file's partners up into modules would be an aggregation, so
 * a file shows its file partners and a module shows its module partners,
 * which is the shape the contract already ships.
 */

import type { AnalysisDocument, CochangePair } from "@gitnebula/contract";

import type { EngineNode } from "../engine/index.js";
import {
  EMPTY_METRIC,
  formatInteger,
  formatPercent,
  formatRelativeTime,
} from "./format.js";
import { githubNodeUrl } from "./github.js";

/** How many co-change partners the panel names (AC-1). */
export const COCHANGE_LIMIT = 3;

/** One `label / value` line of the panel, in the mockup's order. */
export interface MetricRow {
  readonly label: string;
  readonly value: string;
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
  const churnPercent = formatPercent(node.churn);
  return {
    id: node.id,
    name: displayName(node),
    path: node.path,
    kindLine: `${node.kind} · ${node.layer}`,
    hot: node.hot,
    churnPercent,
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
        label: `churn ${document.repo.analysisWindowDays}d`,
        value: churnPercent,
      },
      { label: "authors", value: formatInteger(node.authors) },
      {
        label: "last change",
        value: formatRelativeTime(node.lastChangedAt, options.now),
      },
      {
        label: "co-changes with",
        value: formatCochanges(topCochanges(document, node)),
      },
    ],
  };
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

export function topCochanges(
  document: AnalysisDocument,
  node: EngineNode,
  limit: number = COCHANGE_LIMIT,
): readonly CochangePartner[] {
  const sameKind = new Set(
    document.nodes
      .filter((candidate) => candidate.kind === node.kind)
      .map((candidate) => candidate.id),
  );

  const partners: CochangePartner[] = [];
  for (const pair of document.cochanges) {
    const partner = partnerOf(pair, node.id);
    // Same-kind only: the contract's pairs are already same-kind, but a
    // document is validated for shape, not for that invariant.
    if (partner === null || !sameKind.has(partner)) continue;
    partners.push({ id: partner, count: pair.count });
  }

  return partners
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function partnerOf(pair: CochangePair, id: string): string | null {
  if (pair.a === id) return pair.b;
  if (pair.b === id) return pair.a;
  return null;
}

/** `tasks/ 12 · core/ 9` — the mockup names partners, we add the counts. */
export function formatCochanges(partners: readonly CochangePartner[]): string {
  if (partners.length === 0) return EMPTY_METRIC;
  return partners
    .map((partner) => `${partner.id} ${formatInteger(partner.count)}`)
    .join(" · ");
}
