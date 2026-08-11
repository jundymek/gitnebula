import { describe, expect, it } from "vitest";
import {
  boundsCentre,
  cameraAt,
  phaseBScript,
  phaseCScript,
  scriptDurationMs,
  type CameraKeyframe,
} from "./camera-script.js";
import { UNFOLD_ZOOM } from "./unfold.js";

const script: CameraKeyframe[] = [
  { atMs: 0, cx: 0, cy: 0, k: 1 },
  { atMs: 1000, cx: 100, cy: -50, k: 2 },
];

describe("cameraAt", () => {
  it("returns the first keyframe before the script starts", () => {
    expect(cameraAt(script, -5)).toEqual({ atMs: 0, cx: 0, cy: 0, k: 1 });
  });

  it("interpolates linearly between keyframes", () => {
    const cam = cameraAt(script, 250);
    expect(cam.cx).toBeCloseTo(25);
    expect(cam.cy).toBeCloseTo(-12.5);
    expect(cam.k).toBeCloseTo(1.25);
  });

  it("clamps to the last keyframe past the end", () => {
    const cam = cameraAt(script, 99999);
    expect(cam.cx).toBeCloseTo(100);
    expect(cam.k).toBeCloseTo(2);
  });

  it("throws on an empty script rather than returning a bogus camera", () => {
    expect(() => cameraAt([], 0)).toThrow(/empty camera script/);
  });
});

describe("phase scripts follow the measured layout", () => {
  // Bounds far from the origin: an earlier version panned around (0, 0) and
  // traversed empty space, so phase (c) never unfolded a single module.
  const bounds = { minX: 800, maxX: 1200, minY: -2200, maxY: -1800 };

  it("centres on the layout, not the origin", () => {
    expect(boundsCentre(bounds)).toEqual({ cx: 1000, cy: -2000 });
    expect(cameraAt(phaseBScript(bounds), 0).cx).toBeCloseTo(1000);
    expect(cameraAt(phaseCScript(bounds), 0).cy).toBeCloseTo(
      -2000 + 200 * -0.7,
    );
  });

  it("keeps every phase-b keyframe below the unfold threshold", () => {
    for (const kf of phaseBScript(bounds)) {
      expect(kf.k).toBeLessThan(UNFOLD_ZOOM);
    }
  });

  it("holds phase c above the unfold threshold once zoomed in", () => {
    const c = phaseCScript(bounds);
    const zoomed = c.filter((kf) => kf.atMs >= 1500);
    expect(zoomed.length).toBeGreaterThan(0);
    for (const kf of zoomed) expect(kf.k).toBeGreaterThanOrEqual(UNFOLD_ZOOM);
  });

  it("phase c pans across the layout rather than sitting still", () => {
    const c = phaseCScript(bounds);
    const xs = c.map((kf) => kf.cx);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(
      (bounds.maxX - bounds.minX) * 0.5,
    );
  });

  it("reports its own duration", () => {
    expect(scriptDurationMs(phaseCScript(bounds))).toBe(15000);
    expect(scriptDurationMs([])).toBe(0);
  });
});
