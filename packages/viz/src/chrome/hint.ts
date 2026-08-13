/**
 * The hint overlay, bottom-right (UX-DR9): three lines telling a first-time
 * viewer what the map responds to. The unfold threshold is read from the
 * engine's constant rather than written out, so the text cannot claim 1.8×
 * after someone changes it.
 */

import { UNFOLD_ZOOM } from "../engine/index.js";

export const HINT_LINES: readonly string[] = [
  "drag to pan · scroll to zoom",
  `zoom in past ${UNFOLD_ZOOM}× to unfold files`,
  "hover for dependency chain · click for detail",
];

export function renderHint(): HTMLElement {
  const hint = document.createElement("div");
  hint.className = "hint";
  HINT_LINES.forEach((line, index) => {
    if (index > 0) hint.append(document.createElement("br"));
    hint.append(line);
  });
  return hint;
}
