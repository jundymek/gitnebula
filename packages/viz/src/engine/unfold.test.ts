import { describe, expect, it } from "vitest";

import { UNFOLD_ZOOM } from "./constants.js";
import {
  intersectsViewport,
  unfoldTransition,
  UNFOLD_VIEWPORT_MARGIN,
  visibleWorldRect,
  wantedUnfolds,
  type UnfoldCandidate,
} from "./unfold.js";

const VIEWPORT = { width: 1000, height: 800 };

function moduleAt(id: string, x: number, y: number): UnfoldCandidate {
  return { id, x, y, radius: 10 };
}

describe("visibleWorldRect", () => {
  it("centres on the camera and spans the viewport divided by zoom", () => {
    // At k=1 with no margin the rect would be 1000×800; the margin widens it
    // by 15% of the viewport on each side.
    const rect = visibleWorldRect({ x: 0, y: 0, k: 1 }, VIEWPORT);
    expect(rect.maxX - rect.minX).toBeCloseTo(1000 * (1 + 2 * 0.15));
    expect(rect.maxY - rect.minY).toBeCloseTo(800 * (1 + 2 * 0.15));
    expect((rect.minX + rect.maxX) / 2).toBeCloseTo(0);
    expect((rect.minY + rect.maxY) / 2).toBeCloseTo(0);
  });

  it("shows less world as zoom increases", () => {
    const near = visibleWorldRect({ x: 0, y: 0, k: 4 }, VIEWPORT);
    const far = visibleWorldRect({ x: 0, y: 0, k: 1 }, VIEWPORT);
    expect(near.maxX - near.minX).toBeCloseTo((far.maxX - far.minX) / 4);
  });

  it("follows the camera's world centre", () => {
    const rect = visibleWorldRect({ x: 500, y: -300, k: 2 }, VIEWPORT);
    expect((rect.minX + rect.maxX) / 2).toBeCloseTo(500);
    expect((rect.minY + rect.maxY) / 2).toBeCloseTo(-300);
  });
});

describe("intersectsViewport", () => {
  const rect = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

  it("accepts a module inside the rect", () => {
    expect(intersectsViewport(moduleAt("a", 50, 50), rect)).toBe(true);
  });

  it("rejects a module well outside it", () => {
    expect(intersectsViewport(moduleAt("a", 500, 50), rect)).toBe(false);
  });

  it("counts a module whose radius overlaps the edge", () => {
    // Centre is 5px outside, but the 10px radius reaches in — it is partly
    // drawn on screen, so it must unfold.
    expect(intersectsViewport(moduleAt("a", 105, 50), rect)).toBe(true);
    expect(intersectsViewport(moduleAt("a", 111, 50), rect)).toBe(false);
  });
});

describe("wantedUnfolds — ADR-0006", () => {
  const modules = [
    moduleAt("in-view", 0, 0),
    moduleAt("far-away", 100_000, 100_000),
  ];

  it("unfolds nothing below the 1.8x threshold, however close the module", () => {
    const wanted = wantedUnfolds(
      modules,
      { x: 0, y: 0, k: UNFOLD_ZOOM - 0.01 },
      VIEWPORT,
    );
    expect([...wanted]).toEqual([]);
  });

  it("unfolds only the modules intersecting the viewport at the threshold", () => {
    const wanted = wantedUnfolds(
      modules,
      { x: 0, y: 0, k: UNFOLD_ZOOM },
      VIEWPORT,
    );
    expect([...wanted]).toEqual(["in-view"]);
  });

  it("unfolds a module that is panned into view at zoom", () => {
    const camera = { x: 100_000, y: 100_000, k: UNFOLD_ZOOM };
    expect([...wantedUnfolds(modules, camera, VIEWPORT)]).toEqual(["far-away"]);
  });

  it("keeps the margin: a module just off-screen still unfolds", () => {
    // Half a viewport at k=1.8 is 1000/1.8/2 ≈ 277.8 world px; the margin adds
    // 15% of the viewport, so ~277.8 + 83.3 ≈ 361 is the outer edge.
    const camera = { x: 0, y: 0, k: UNFOLD_ZOOM };
    const halfWidth = VIEWPORT.width / UNFOLD_ZOOM / 2;
    const marginWidth = (VIEWPORT.width / UNFOLD_ZOOM) * UNFOLD_VIEWPORT_MARGIN;

    const justInsideMargin = moduleAt("m", halfWidth + marginWidth * 0.5, 0);
    const beyondMargin = moduleAt("m", halfWidth + marginWidth * 2, 0);

    expect(wantedUnfolds([justInsideMargin], camera, VIEWPORT).has("m")).toBe(
      true,
    );
    expect(wantedUnfolds([beyondMargin], camera, VIEWPORT).has("m")).toBe(
      false,
    );
  });
});

describe("unfoldTransition", () => {
  it("reports nothing changed when the sets match", () => {
    const t = unfoldTransition(new Set(["a"]), new Set(["a"]));
    expect(t).toEqual({ entered: [], left: [], changed: false });
  });

  it("reports modules that entered", () => {
    const t = unfoldTransition(new Set(["a"]), new Set(["a", "b"]));
    expect(t.entered).toEqual(["b"]);
    expect(t.left).toEqual([]);
    expect(t.changed).toBe(true);
  });

  it("reports modules that left", () => {
    const t = unfoldTransition(new Set(["a", "b"]), new Set(["b"]));
    expect(t.entered).toEqual([]);
    expect(t.left).toEqual(["a"]);
    expect(t.changed).toBe(true);
  });

  it("collapses everything when the wanted set is empty", () => {
    // This is how "dropping below 1.8x collapses all" is expressed: the same
    // diff, fed the empty set that wantedUnfolds returns below the threshold.
    const t = unfoldTransition(new Set(["a", "b"]), new Set());
    expect([...t.left].sort()).toEqual(["a", "b"]);
    expect(t.changed).toBe(true);
  });
});
