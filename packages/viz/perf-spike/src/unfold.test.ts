import { describe, expect, it } from "vitest";
import {
  NonMemberDisplacementTracker,
  UNFOLD_ZOOM,
  cssViewport,
  moduleIntersectsViewport,
  unfoldTransition,
  unfoldedModules,
  visibleWorldRect,
} from "./unfold.js";

const vp = { width: 1000, height: 800 };

describe("unfoldedModules", () => {
  const modules = [
    { id: "in-view", x: 0, y: 0, r: 20 },
    { id: "far-away", x: 5000, y: 5000, r: 20 },
  ];

  it("unfolds nothing below UNFOLD_ZOOM", () => {
    const cam = { cx: 0, cy: 0, k: UNFOLD_ZOOM - 0.01 };
    expect(unfoldedModules(modules, cam, vp).size).toBe(0);
  });

  it("unfolds only viewport-intersecting modules at >= UNFOLD_ZOOM", () => {
    const cam = { cx: 0, cy: 0, k: UNFOLD_ZOOM };
    const out = unfoldedModules(modules, cam, vp);
    expect(out.has("in-view")).toBe(true);
    expect(out.has("far-away")).toBe(false);
  });

  it("margin unfolds modules just off-screen", () => {
    const cam = { cx: 0, cy: 0, k: 2.0 };
    // Half viewport width in world units = 250 at k=2; margin adds 15%.
    const justOutside = { id: "m", x: 250 + 30, y: 0, r: 10 };
    expect(moduleIntersectsViewport(justOutside, cam, vp)).toBe(true);
    const wellOutside = { id: "m", x: 400, y: 0, r: 10 };
    expect(moduleIntersectsViewport(wellOutside, cam, vp)).toBe(false);
  });
});

describe("cssViewport", () => {
  // At k = 2.2 the CSS half-width is (1000/2.2)*0.65 ≈ 295 world units, the
  // device half-width twice that — so "outside" is visible only if device
  // pixels leak into the viewport calculation.
  const modules = [
    { id: "inside", x: 100, y: 0, r: 10 },
    { id: "outside", x: 400, y: 0, r: 10 },
  ];
  const cam = { cx: 0, cy: 0, k: 2.2 };

  it("makes the visible world rect independent of devicePixelRatio", () => {
    // Same 1000x800 CSS canvas, rasterised at 1x and at 2x.
    const at1 = cssViewport({ width: 1000, height: 800 }, 1);
    const at2 = cssViewport({ width: 2000, height: 1600 }, 2);
    expect(visibleWorldRect(cam, at1)).toEqual(visibleWorldRect(cam, at2));
  });

  it("unfolds the same modules at 1x and 2x", () => {
    const at1 = unfoldedModules(
      modules,
      cam,
      cssViewport({ width: 1000, height: 800 }, 1),
    );
    const at2 = unfoldedModules(
      modules,
      cam,
      cssViewport({ width: 2000, height: 1600 }, 2),
    );
    expect([...at2]).toEqual(["inside"]);
    expect([...at1]).toEqual(["inside"]);
    // Guard against the test passing because nothing is ever in view: feeding
    // the raw device-pixel size unfolds a module that is genuinely off-screen.
    const raw = unfoldedModules(modules, cam, { width: 2000, height: 1600 });
    expect([...raw]).toEqual(["inside", "outside"]);
  });
});

describe("unfoldTransition", () => {
  it("reports modules that entered and left the viewport", () => {
    const t = unfoldTransition(new Set(["a", "b"]), new Set(["b", "c"]));
    expect([...t.entered]).toEqual(["c"]);
    expect([...t.left]).toEqual(["a"]);
    expect(t.changed).toBe(true);
  });

  it("reports no change when the visible set is unchanged", () => {
    const t = unfoldTransition(new Set(["a", "b"]), new Set(["b", "a"]));
    expect(t.entered.size).toBe(0);
    expect(t.left.size).toBe(0);
    expect(t.changed).toBe(false);
  });

  it("collapses everything when the camera drops below UNFOLD_ZOOM", () => {
    // unfoldedModules returns the empty set below the threshold, so the
    // transition out of it must collapse every unfolded module (ADR-0006:
    // "zooming below the threshold collapses all").
    const modules = [{ id: "a", x: 0, y: 0, r: 20 }];
    const below = unfoldedModules(modules, { cx: 0, cy: 0, k: 1.0 }, vp);
    const t = unfoldTransition(new Set(["a"]), below);
    expect([...t.left]).toEqual(["a"]);
    expect(t.entered.size).toBe(0);
  });

  it("collapses a module the camera has panned away from", () => {
    const modules = [{ id: "a", x: 0, y: 0, r: 20 }];
    const cam = { cx: 0, cy: 0, k: 2.2 };
    const unfolded = unfoldedModules(modules, cam, vp);
    expect(unfolded.has("a")).toBe(true);
    // Pan far enough that the module leaves the viewport plus its margin.
    const panned = { cx: 9000, cy: 0, k: 2.2 };
    const t = unfoldTransition(unfolded, unfoldedModules(modules, panned, vp));
    expect([...t.left]).toEqual(["a"]);
  });
});

describe("NonMemberDisplacementTracker", () => {
  it("measures only non-member nodes", () => {
    const t = new NonMemberDisplacementTracker();
    const nodes = [
      { id: "member", x: 0, y: 0 },
      { id: "outsider", x: 100, y: 100 },
    ];
    t.capture(nodes, new Set(["member"]));
    const moved = [
      { id: "member", x: 50, y: 50 }, // members may move freely
      { id: "outsider", x: 100.3, y: 100.4 },
    ];
    expect(t.maxDisplacement(moved)).toBeCloseTo(0.5);
  });
});
