// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  createTooltip,
  tooltipLabel,
  tooltipPosition,
  TOOLTIP_MARGIN_PX,
  TOOLTIP_OFFSET_PX,
} from "./tooltip.js";
import type { EngineNode } from "../engine/index.js";

const VIEWPORT = { width: 1000, height: 800 };
const BOX = { width: 200, height: 30 };

function node(overrides: Partial<EngineNode> = {}): EngineNode {
  return {
    id: "src/engine/graph.ts",
    kind: "file",
    parent: "src/engine/",
    path: "src/engine/graph.ts",
    layer: "backend",
    loc: 120,
    churn: 0.62,
    commits: 9,
    authors: 2,
    lastChangedAt: null,
    description: null,
    hot: true,
    radius: 3,
    ...overrides,
  };
}

describe("tooltipLabel", () => {
  it("is name and churn as a whole percentage", () => {
    expect(tooltipLabel(node())).toBe("src/engine/graph.ts · churn 62%");
  });

  it("rounds churn rather than printing a float", () => {
    expect(tooltipLabel(node({ churn: 0.005 }))).toContain("churn 1%");
    expect(tooltipLabel(node({ churn: 0 }))).toContain("churn 0%");
  });
});

describe("tooltipPosition", () => {
  it("sits below-right of the cursor when there is room", () => {
    const { left, top } = tooltipPosition({ x: 100, y: 100 }, BOX, VIEWPORT);
    expect(left).toBe(100 + TOOLTIP_OFFSET_PX);
    expect(top).toBe(100 + TOOLTIP_OFFSET_PX);
  });

  it("flips to the left of the cursor near the right edge", () => {
    const { left } = tooltipPosition({ x: 950, y: 100 }, BOX, VIEWPORT);
    expect(left).toBe(950 - TOOLTIP_OFFSET_PX - BOX.width);
    expect(left + BOX.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("flips above the cursor near the bottom edge", () => {
    const { top } = tooltipPosition({ x: 100, y: 790 }, BOX, VIEWPORT);
    expect(top).toBe(790 - TOOLTIP_OFFSET_PX - BOX.height);
    expect(top + BOX.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("never overflows any edge, wherever the cursor is (AC-2)", () => {
    // The acceptance criterion is "never overflows", so it is checked as an
    // invariant over the whole viewport rather than at three sampled corners.
    for (let x = 0; x <= VIEWPORT.width; x += 50) {
      for (let y = 0; y <= VIEWPORT.height; y += 50) {
        const { left, top } = tooltipPosition({ x, y }, BOX, VIEWPORT);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left + BOX.width).toBeLessThanOrEqual(VIEWPORT.width);
        expect(top + BOX.height).toBeLessThanOrEqual(VIEWPORT.height);
      }
    }
  });

  it("keeps the tooltip on screen when it is wider than the viewport", () => {
    const wide = { width: 400, height: 30 };
    const tiny = { width: 200, height: 100 };
    const { left } = tooltipPosition({ x: 100, y: 50 }, wide, tiny);
    // It cannot fit; anchoring to the margin beats drifting off to the left.
    expect(left).toBe(TOOLTIP_MARGIN_PX);
  });
});

describe("createTooltip", () => {
  it("is hidden until a node is hovered", () => {
    const tooltip = createTooltip(() => VIEWPORT);
    expect(tooltip.element.hidden).toBe(true);

    tooltip.update(node(), { x: 10, y: 10 });
    expect(tooltip.element.hidden).toBe(false);
    expect(tooltip.element.textContent).toContain("graph.ts");
  });

  it("hides again when hover leaves", () => {
    const tooltip = createTooltip(() => VIEWPORT);
    tooltip.update(node(), { x: 10, y: 10 });
    tooltip.update(null, null);
    expect(tooltip.element.hidden).toBe(true);
  });

  it("hides when a node arrives without a cursor position", () => {
    const tooltip = createTooltip(() => VIEWPORT);
    tooltip.update(node(), null);
    expect(tooltip.element.hidden).toBe(true);
  });

  it("is hidden from assistive tech — it mirrors the canvas", () => {
    const tooltip = createTooltip(() => VIEWPORT);
    expect(tooltip.element.getAttribute("aria-hidden")).toBe("true");
  });

  it("moves with the cursor", () => {
    const tooltip = createTooltip(() => VIEWPORT);
    tooltip.update(node(), { x: 10, y: 10 });
    const first = tooltip.element.style.left;
    tooltip.update(node(), { x: 300, y: 10 });
    expect(tooltip.element.style.left).not.toBe(first);
  });
});
