import { describe, expect, it } from "vitest";
import {
  NonMemberDisplacementTracker,
  UNFOLD_ZOOM,
  moduleIntersectsViewport,
  unfoldedModules,
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
