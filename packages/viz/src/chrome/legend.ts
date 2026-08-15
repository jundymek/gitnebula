/**
 * The legend (UX-DR2, mockup bottom-left): the four named layers plus the hot
 * spot entry, which exists because in structure mode `--hot` REPLACES a
 * node's layer colour — without the entry, an orange node has no key.
 *
 * The swatch colours come from the engine's constants, so the legend and the
 * canvas cannot drift apart.
 *
 * Story 5.5 adds the heatmap's empty state. In `heat` mode the ramp encodes
 * churn, and on a repository whose history mostly predates the analysis
 * window almost every node sits at the cold end — a nearly-uniform canvas
 * that reads as a broken renderer. The legend names that case with its count,
 * which turns a flat heatmap into a measurement (AC-4, UX-DR14).
 */

import type { AnalysisDocument } from "@gitnebula/contract";

import { HOT_COLOR, LAYER_COLOR, type ViewMode } from "../engine/index.js";
import { mostlyColdState } from "./empty-state.js";

export interface LegendEntry {
  readonly label: string;
  readonly color: string;
}

/** The mockup's five entries, in its order. */
export const LEGEND_ENTRIES: readonly LegendEntry[] = [
  { label: "backend", color: LAYER_COLOR.backend },
  { label: "frontend", color: LAYER_COLOR.frontend },
  { label: "infra", color: LAYER_COLOR.infra },
  { label: "test", color: LAYER_COLOR.test },
  { label: "hot spot", color: HOT_COLOR },
];

/**
 * The share of file nodes at zero churn past which the heatmap is "mostly
 * cold" and says so.
 *
 * A simple majority: below half, the ramp still carries visible variation and
 * a notice would be noise; above it, the reader is looking at a flat canvas.
 */
export const MOSTLY_COLD_SHARE = 0.5;

export interface LegendHandle {
  readonly element: HTMLElement;
  /** Reflect the engine's mode — the notice shows in `heat` mode only. */
  setMode(mode: ViewMode): void;
}

/**
 * Counts file nodes at zero churn.
 *
 * This is a count over a value the contract already carries, not a new
 * aggregation (AD-1) — the same shape as `mountChrome`'s existing
 * `modules: nodes.filter(kind === "module").length`. Nothing is derived that
 * the pipeline could have derived better, and nothing is written back.
 *
 * Files only: modules inherit churn from their members, so counting both would
 * count the same quiet code twice.
 */
export function coldFileCount(document: AnalysisDocument): {
  readonly zero: number;
  readonly total: number;
} {
  let zero = 0;
  let total = 0;
  for (const node of document.nodes) {
    if (node.kind !== "file") continue;
    total++;
    if (node.churn === 0) zero++;
  }
  return { zero, total };
}

/** True when the heatmap would render nearly uniform (AC-4). */
export function isMostlyCold(document: AnalysisDocument): boolean {
  const { zero, total } = coldFileCount(document);
  if (total === 0) return false;
  return zero / total > MOSTLY_COLD_SHARE;
}

export function renderLegend(document_: AnalysisDocument): LegendHandle {
  const legend = document.createElement("div");
  legend.className = "legend";
  for (const entry of LEGEND_ENTRIES) {
    const row = document.createElement("span");
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = entry.color;
    row.append(dot, entry.label);
    legend.append(row);
  }

  // The heatmap notice. Built once and toggled, so switching modes cannot
  // accumulate elements.
  const notice = document.createElement("span");
  notice.className = "legend-notice";
  notice.hidden = true;

  const { zero, total } = coldFileCount(document_);
  const mostlyCold = isMostlyCold(document_);
  if (mostlyCold) {
    const state = mostlyColdState(
      zero,
      total,
      document_.repo.analysisWindowDays,
    );
    const cause = document.createElement("span");
    cause.textContent = state.cause;
    const exit = document.createElement("span");
    exit.className = "legend-notice-exit";
    exit.textContent = state.exit;
    notice.append(cause, exit);
    legend.append(notice);
  }

  return {
    element: legend,
    setMode(mode) {
      // Structure mode colours by layer, where a cold node is not remarkable;
      // the notice belongs to the ramp, so it appears with the ramp.
      notice.hidden = !(mostlyCold && mode === "heat");
    },
  };
}
