import { describe, expect, it } from "vitest";

import {
  cameraAt,
  extentFromFitCamera,
  panZoomScript,
  scriptDurationMs,
  unfoldPanScript,
} from "./camera-script.js";
import { UNFOLD_ZOOM } from "../../src/engine/index.js";

describe("extentFromFitCamera", () => {
  it("recovers the graph's world extent from the camera that framed it", () => {
    // A 1200x800 viewport at k=0.5 with 90 px of fit padding sees
    // (600-90)/0.5 = 1020 world units either side of centre.
    const extent = extentFromFitCamera(
      { x: 10, y: -20, k: 0.5 },
      { width: 1200, height: 800 },
      90,
    );
    expect(extent).toEqual({ cx: 10, cy: -20, hx: 1020, hy: 620 });
  });

  it("never returns a degenerate extent, however tight the viewport", () => {
    const extent = extentFromFitCamera(
      { x: 0, y: 0, k: 4 },
      { width: 100, height: 100 },
      200,
    );
    expect(extent.hx).toBeGreaterThan(0);
    expect(extent.hy).toBeGreaterThan(0);
  });
});

describe("the scripted sequences (AC-3)", () => {
  const extent = { cx: 0, cy: 0, hx: 1000, hy: 800 };

  it("pans across the measured extent rather than around the origin", () => {
    // 1.4's defect: a script derived from a guessed radius panned through
    // empty space and measured an empty screen at a respectable frame rate.
    const script = panZoomScript(extent);
    const xs = script.map((k) => k.x);
    expect(Math.min(...xs)).toBeCloseTo(-800, 5);
    expect(Math.max(...xs)).toBeCloseTo(800, 5);
    expect(scriptDurationMs(script)).toBe(10_000);
  });

  it("holds the unfold pan above UNFOLD_ZOOM for the whole perimeter", () => {
    const script = unfoldPanScript(extent);
    const afterZoomIn = script.filter((k) => k.atMs >= 1500);
    expect(afterZoomIn.every((k) => k.k > UNFOLD_ZOOM)).toBe(true);
    // It starts below the threshold, so the zoom-in itself is measured too.
    expect(script[0]!.k).toBeLessThan(UNFOLD_ZOOM);
    expect(scriptDurationMs(script)).toBe(15_000);
  });

  it("visits all four corners, so modules keep entering the viewport", () => {
    const script = unfoldPanScript(extent);
    const corners = new Set(
      script.slice(1).map((k) => `${Math.sign(k.x)},${Math.sign(k.y)}`),
    );
    expect(corners.has("-1,-1")).toBe(true);
    expect(corners.has("1,-1")).toBe(true);
    expect(corners.has("1,1")).toBe(true);
    expect(corners.has("-1,1")).toBe(true);
  });
});

describe("cameraAt", () => {
  const script = [
    { atMs: 0, x: 0, y: 0, k: 1 },
    { atMs: 1000, x: 100, y: -50, k: 2 },
  ];

  it("interpolates linearly between keyframes", () => {
    expect(cameraAt(script, 500)).toEqual({ x: 50, y: -25, k: 1.5 });
  });

  it("clamps outside the script instead of extrapolating", () => {
    expect(cameraAt(script, -10)).toEqual({ x: 0, y: 0, k: 1 });
    expect(cameraAt(script, 9999)).toEqual({ x: 100, y: -50, k: 2 });
  });

  it("refuses an empty script rather than returning a silent identity", () => {
    expect(() => cameraAt([], 0)).toThrow(/empty camera script/);
  });
});
