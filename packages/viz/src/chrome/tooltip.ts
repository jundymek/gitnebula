/**
 * The hover tooltip (FR-17): `name · churn N%`, following the cursor.
 *
 * Driven entirely by the engine's `hover` event — chrome never asks the canvas
 * what is under the pointer, which is the AD-5 rule this file has to keep.
 *
 * Positioning is the substance here. The tooltip must never overflow the
 * viewport (AC-2), so it flips to the other side of the cursor when it would
 * cross an edge rather than being clamped flat against it: a clamped tooltip
 * sits *under* the pointer at the edges of the screen and hides the very node
 * it describes.
 */

import type { EngineNode, ScreenPoint } from "../engine/index.js";

/** Gap between the cursor and the tooltip's near corner, in CSS px. */
export const TOOLTIP_OFFSET_PX = 14;
/** Minimum gap kept between the tooltip and the viewport edge. */
export const TOOLTIP_MARGIN_PX = 8;

export interface TooltipBox {
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Where to put the tooltip's top-left corner.
 *
 * Preferred position is below-right of the cursor. If that would overflow, the
 * tooltip flips to the opposite side on that axis; if it *still* does not fit
 * (a viewport narrower than the tooltip), it is clamped to the margin, because
 * being partly visible beats being off-screen entirely.
 */
export function tooltipPosition(
  cursor: ScreenPoint,
  box: TooltipBox,
  viewport: ViewportSize,
): { left: number; top: number } {
  let left = cursor.x + TOOLTIP_OFFSET_PX;
  if (left + box.width + TOOLTIP_MARGIN_PX > viewport.width) {
    left = cursor.x - TOOLTIP_OFFSET_PX - box.width;
  }

  let top = cursor.y + TOOLTIP_OFFSET_PX;
  if (top + box.height + TOOLTIP_MARGIN_PX > viewport.height) {
    top = cursor.y - TOOLTIP_OFFSET_PX - box.height;
  }

  return {
    left: clamp(left, TOOLTIP_MARGIN_PX, viewport.width - box.width),
    top: clamp(top, TOOLTIP_MARGIN_PX, viewport.height - box.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  // `max` below `min` means the box does not fit at all; the margin wins, so
  // the tooltip stays anchored to the top-left rather than inverting.
  return Math.max(min, Math.min(Math.max(min, max), value));
}

/** `src/engine/graph.ts · churn 62%` — the mockup's hover label. */
export function tooltipLabel(node: EngineNode): string {
  return `${node.path} · churn ${Math.round(node.churn * 100)}%`;
}

export interface Tooltip {
  readonly element: HTMLElement;
  /** Show for a node at a cursor position, or hide when either is null. */
  update(node: EngineNode | null, screen: ScreenPoint | null): void;
}

export function createTooltip(
  viewportOf: () => ViewportSize = () => ({
    width: globalThis.innerWidth || 0,
    height: globalThis.innerHeight || 0,
  }),
): Tooltip {
  const element = document.createElement("div");
  element.className = "tooltip";
  element.hidden = true;
  // Presentational: the tooltip mirrors what the canvas already shows, and the
  // node's own accessible name is the search listbox's job. Announcing it on
  // every pointer move would make a screen reader unusable.
  element.setAttribute("aria-hidden", "true");

  return {
    element,
    update(node, screen) {
      if (!node || !screen) {
        element.hidden = true;
        return;
      }
      element.textContent = tooltipLabel(node);
      element.hidden = false;

      // Measured after the text is set and the element is visible: a hidden
      // element measures 0×0, and a stale measurement would flip the tooltip
      // on the wrong side of the cursor.
      const box = {
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
      const { left, top } = tooltipPosition(screen, box, viewportOf());
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    },
  };
}
