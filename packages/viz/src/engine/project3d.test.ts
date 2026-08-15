import { describe, expect, it } from "vitest";

import {
  BASE_DISTANCE,
  byDepth,
  clampPitch,
  FOCAL_LENGTH,
  fogFactor,
  NEAR_PLANE,
  orbitDistance,
  PITCH_LIMIT,
  project,
  type Orientation,
} from "./project3d.js";
import type { Viewport } from "./camera.js";
import type { CameraState } from "./types.js";

const VIEWPORT: Viewport = { width: 1000, height: 600 };
const FLAT: Orientation = { yaw: 0, pitch: 0 };
const AT_REST: CameraState = { x: 0, y: 0, k: 1 };

describe("orbitDistance", () => {
  it("is the base distance at zoom 1", () => {
    expect(orbitDistance(1)).toBe(BASE_DISTANCE);
  });

  it("moves the camera closer as zoom rises — the 2D wheel direction", () => {
    expect(orbitDistance(2)).toBeLessThan(orbitDistance(1));
    expect(orbitDistance(0.5)).toBeGreaterThan(orbitDistance(1));
  });

  it("falls back to the resting distance for a zoom that cannot be inverted", () => {
    // A zero or negative k would put the camera at or through the orbit
    // centre; NaN has no side of the range to fall to.
    expect(orbitDistance(0)).toBe(BASE_DISTANCE);
    expect(orbitDistance(-1)).toBe(BASE_DISTANCE);
    expect(orbitDistance(Number.NaN)).toBe(BASE_DISTANCE);
  });
});

describe("clampPitch", () => {
  it("passes a pitch inside the range through untouched", () => {
    expect(clampPitch(0.4)).toBe(0.4);
  });

  it("clamps past vertical, where the cloud would flip", () => {
    expect(clampPitch(99)).toBe(PITCH_LIMIT);
    expect(clampPitch(-99)).toBe(-PITCH_LIMIT);
  });

  it("treats NaN as level rather than propagating it into every frame", () => {
    expect(clampPitch(Number.NaN)).toBe(0);
  });
});

describe("project", () => {
  it("puts the orbit centre at the middle of the viewport", () => {
    const p = project({ x: 0, y: 0, z: 0 }, AT_REST, FLAT, VIEWPORT);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(500);
    expect(p!.y).toBeCloseTo(300);
  });

  it("scales by focal length over depth", () => {
    const p = project({ x: 0, y: 0, z: 0 }, AT_REST, FLAT, VIEWPORT)!;
    expect(p.viewZ).toBeCloseTo(BASE_DISTANCE);
    expect(p.scale).toBeCloseTo(FOCAL_LENGTH / BASE_DISTANCE);
  });

  it("draws a nearer node larger than an identical farther one", () => {
    const near = project({ x: 0, y: 0, z: -300 }, AT_REST, FLAT, VIEWPORT)!;
    const far = project({ x: 0, y: 0, z: 300 }, AT_REST, FLAT, VIEWPORT)!;
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.viewZ).toBeLessThan(far.viewZ);
  });

  it("drops a point at or behind the near plane instead of smearing it", () => {
    // As viewZ approaches 0 the projected scale runs away to infinity; a node
    // that has drifted through the camera is behind the viewer, not enormous.
    const behind = project(
      { x: 0, y: 0, z: -BASE_DISTANCE - 1 },
      AT_REST,
      FLAT,
      VIEWPORT,
    );
    expect(behind).toBeNull();

    const atPlane = project(
      { x: 0, y: 0, z: -(BASE_DISTANCE - NEAR_PLANE) - 0.001 },
      AT_REST,
      FLAT,
      VIEWPORT,
    );
    expect(atPlane).toBeNull();
  });

  it("pans the orbit target rather than translating the screen", () => {
    const panned = project(
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, k: 1 },
      FLAT,
      VIEWPORT,
    )!;
    // The node the camera panned onto sits dead centre.
    expect(panned.x).toBeCloseTo(500);
    expect(panned.y).toBeCloseTo(300);
  });

  it("rotates about Y for yaw: a quarter turn swaps the X and Z axes", () => {
    const p = project(
      { x: 100, y: 0, z: 0 },
      AT_REST,
      { yaw: Math.PI / 2, pitch: 0 },
      VIEWPORT,
    )!;
    // Yawed 90°, a point on +X has moved entirely into depth: it is no longer
    // off-centre horizontally, it is nearer or farther instead.
    expect(p.x).toBeCloseTo(500);
    expect(p.viewZ).toBeCloseTo(BASE_DISTANCE + 100);
  });

  it("rotates about X for pitch: a quarter turn swaps the Y and Z axes", () => {
    const p = project(
      { x: 0, y: 100, z: 0 },
      AT_REST,
      { yaw: 0, pitch: Math.PI / 2 },
      VIEWPORT,
    )!;
    expect(p.y).toBeCloseTo(300);
    expect(p.viewZ).toBeCloseTo(BASE_DISTANCE + 100);
  });

  it("centres the target point itself, at any orientation", () => {
    // The orbit target is a point in three dimensions: `camera.x`/`camera.y`
    // and `targetZ`. Whatever the orientation, the point the camera is looking
    // at projects to the middle of the viewport — that is what makes it the
    // target. Without `targetZ` the target was pinned to the z = 0 plane.
    const node = { x: 37, y: -12, z: 88 };
    const p = project(
      node,
      { x: node.x, y: node.y, k: 1.4 },
      { yaw: 0.884, pitch: -0.128 },
      VIEWPORT,
      node.z,
    )!;
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(300);
  });

  it("does NOT centre a node with depth when the target has none", () => {
    // The defect this guards: with `targetZ` left at 0, the node's own z
    // rotates into screen x/y and no x/y pan can cancel it. Asserted as a
    // real offset rather than a rounding error, so the fix above is not
    // passing for a trivial reason.
    const node = { x: 37, y: -12, z: 200 };
    const p = project(
      node,
      { x: node.x, y: node.y, k: 1 },
      { yaw: 0.884, pitch: -0.128 },
      VIEWPORT,
    )!;
    expect(Math.abs(p.x - 500)).toBeGreaterThan(50);
  });

  it("is a pure function of its inputs — the same call twice agrees (AD-6)", () => {
    const args = [
      { x: 37, y: -12, z: 88 },
      { x: 3, y: 4, k: 1.7 },
      { yaw: 0.6, pitch: -0.35 },
      VIEWPORT,
    ] as const;
    expect(project(...args)).toEqual(project(...args));
  });
});

describe("fogFactor", () => {
  it("leaves the nearest node unfogged and dims the farthest most", () => {
    expect(fogFactor(100, 100, 500, 1)).toBeCloseTo(1);
    expect(fogFactor(500, 100, 500, 1)).toBeLessThan(1);
    expect(fogFactor(500, 100, 500, 1)).toBeGreaterThan(0);
  });

  it("ramps monotonically with depth", () => {
    const near = fogFactor(150, 100, 500, 1);
    const mid = fogFactor(300, 100, 500, 1);
    const far = fogFactor(450, 100, 500, 1);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it("applies no fog when there is no depth to cue", () => {
    // One node, or every node at one depth: an absolute ramp would render the
    // whole frame at some arbitrary brightness for no informational gain.
    expect(fogFactor(300, 300, 300, 1)).toBe(1);
    expect(fogFactor(300, 500, 100, 1)).toBe(1);
  });

  it("is disabled at zero strength", () => {
    expect(fogFactor(500, 100, 500, 0)).toBe(1);
  });

  it("clamps a depth outside the stated range rather than over-fogging", () => {
    expect(fogFactor(50, 100, 500, 1)).toBeCloseTo(1);
    expect(fogFactor(900, 100, 500, 1)).toBeCloseTo(
      fogFactor(500, 100, 500, 1),
    );
  });
});

describe("byDepth", () => {
  it("orders farthest first, so near nodes are painted over far ones", () => {
    const sorted = [
      { id: "near", viewZ: 100 },
      { id: "far", viewZ: 900 },
      { id: "mid", viewZ: 500 },
    ].sort(byDepth);
    expect(sorted.map((n) => n.id)).toEqual(["far", "mid", "near"]);
  });

  it("breaks depth ties on id, so draw order never depends on sort stability", () => {
    const sorted = [
      { id: "b", viewZ: 500 },
      { id: "a", viewZ: 500 },
    ].sort(byDepth);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
