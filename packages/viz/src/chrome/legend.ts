/**
 * The legend (UX-DR2, mockup bottom-left): the four named layers plus the hot
 * spot entry, which exists because in structure mode `--hot` REPLACES a
 * node's layer colour — without the entry, an orange node has no key.
 *
 * The swatch colours come from the engine's constants, so the legend and the
 * canvas cannot drift apart.
 */

import { HOT_COLOR, LAYER_COLOR } from "../engine/index.js";

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

export function renderLegend(): HTMLElement {
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
  return legend;
}
