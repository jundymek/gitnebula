import { describe, expect, it } from "vitest";

import {
  clampZoom,
  fitCamera,
  IDENTITY_CAMERA,
  lerpCamera,
  panBy,
  toScreen,
  toWorld,
  zoomAt,
  type Viewport,
} from "./camera.js";
import { MAX_ZOOM, MIN_ZOOM } from "./constants.js";

const viewport: Viewport = { width: 1000, height: 600 };

describe("camera — FR-15 pan and zoom", () => {
  it("clamps zoom to [0.4, 6.0]", () => {
    expect(MIN_ZOOM).toBe(0.4);
    expect(MAX_ZOOM).toBe(6.0);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(MIN_ZOOM);
  });

  it("keeps the world point under the cursor while zooming", () => {
    const cursor = { x: 720, y: 130 };
    const camera = { x: 40, y: -15, k: 1.3 };
    const before = toWorld(cursor, camera, viewport);
    const zoomed = zoomAt(camera, viewport, cursor, 1.12);
    const after = toWorld(cursor, zoomed, viewport);

    expect(zoomed.k).toBeCloseTo(1.3 * 1.12, 10);
    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  it("does not drift sideways when zooming at the clamp", () => {
    const cursor = { x: 900, y: 500 };
    const camera = { x: 0, y: 0, k: MAX_ZOOM };
    const zoomed = zoomAt(camera, viewport, cursor, 1.12);
    expect(zoomed.k).toBe(MAX_ZOOM);
    expect(zoomed.x).toBeCloseTo(camera.x, 8);
    expect(zoomed.y).toBeCloseTo(camera.y, 8);
  });

  it("pans in the direction the pointer dragged", () => {
    // Dragging right by 100 px at 2× moves the world 50 units left of centre.
    const panned = panBy({ x: 0, y: 0, k: 2 }, 100, 0);
    expect(panned.x).toBeCloseTo(-50, 10);
    const world = toScreen({ x: 0, y: 0 }, panned, viewport);
    expect(world.x).toBeCloseTo(viewport.width / 2 + 100, 8);
  });

  it("round-trips screen and world coordinates", () => {
    const camera = { x: -220, y: 87, k: 0.7 };
    const screen = { x: 311, y: 42 };
    const back = toScreen(toWorld(screen, camera, viewport), camera, viewport);
    expect(back.x).toBeCloseTo(screen.x, 8);
    expect(back.y).toBeCloseTo(screen.y, 8);
  });
});

describe("camera — fit", () => {
  it("centres the bounds and frames them inside the padding", () => {
    const bounds = { minX: -400, minY: -200, maxX: 400, maxY: 200 };
    const camera = fitCamera(bounds, viewport, 100);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    // Height is the binding dimension: (600 - 200) / 400 = 1.0.
    expect(camera.k).toBeCloseTo(1, 10);

    const corner = toScreen({ x: 400, y: 200 }, camera, viewport);
    expect(corner.x).toBeLessThanOrEqual(viewport.width);
    expect(corner.y).toBeLessThanOrEqual(viewport.height);
  });

  it("clamps the fit zoom like any other zoom", () => {
    const tiny = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    expect(fitCamera(tiny, viewport, 0).k).toBe(MAX_ZOOM);
  });

  it("returns the identity camera when there is nothing to frame", () => {
    expect(fitCamera(null, viewport, 40)).toEqual(IDENTITY_CAMERA);
  });
});

describe("camera — interpolation", () => {
  it("ends exactly on the target", () => {
    const from = { x: 0, y: 0, k: 1 };
    const to = { x: 100, y: -50, k: 3 };
    expect(lerpCamera(from, to, 1)).toEqual(to);
    expect(lerpCamera(from, to, 0)).toEqual(from);
  });

  it("moves zoom geometrically, so the pace reads evenly", () => {
    const middle = lerpCamera({ x: 0, y: 0, k: 1 }, { x: 0, y: 0, k: 4 }, 0.5);
    expect(middle.k).toBeCloseTo(2, 10);
  });
});
