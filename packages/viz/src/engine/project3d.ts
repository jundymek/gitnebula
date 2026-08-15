/**
 * The 3D view's camera maths — pure functions, no canvas, no state.
 *
 * Two things here are load-bearing.
 *
 * **The orbit camera is derived from the seam's `CameraState`, not added to
 * it.** `CameraState` is `{x, y, k}` and the AD-5 interface must not change to
 * accommodate a second implementation (AC-1) — that is the whole claim the
 * seam makes. So `k` drives orbit *distance*, `x`/`y` pan the orbit *target*,
 * and yaw/pitch live in the engine as interaction state, the same kind of
 * thing as hover: owned by the engine, never reached into by chrome. See
 * `DECISIONS.md` D2.
 *
 * **Depth is encoded twice.** Perspective alone does not separate a dense
 * cloud — the prototype's finding, and the reason it grew a fog slider. Near
 * nodes are larger (perspective) *and* brighter (fog); far ones recede on both
 * channels at once. One cue carries the shape, two carry the density.
 */

import type { CameraState } from "./types.js";
import type { Viewport } from "./camera.js";

/** A point in the layout's world space. */
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the camera is looking from. Not part of `CameraState` and deliberately
 * not on the `GraphEngine` interface (D2).
 */
export interface Orientation {
  /** Rotation about the world Y axis, in radians. */
  readonly yaw: number;
  /** Rotation about the camera's X axis, in radians, clamped to ±PITCH_LIMIT. */
  readonly pitch: number;
}

/** Pitch clamp: past vertical the cloud flips and the drag reverses. */
export const PITCH_LIMIT = 1.5;

/**
 * Focal length in CSS px. The prototype's 780 — the value the perspective was
 * actually judged at, so it ships rather than a rounder number.
 */
export const FOCAL_LENGTH = 780;

/**
 * Orbit distance at zoom 1, in world units.
 *
 * With `FOCAL_LENGTH`, a node at the orbit centre at `k = 1` projects at
 * `780 / 900 ≈ 0.87×` its world size — close enough to the 2D view's 1:1 that
 * switching views does not jump the apparent scale, which is what makes the
 * two views read as the same map.
 */
export const BASE_DISTANCE = 900;

/**
 * Nearest a node may come to the camera plane before it is dropped.
 *
 * Not zero: as `viewZ → 0` the projected scale goes to infinity, so a node
 * drifting through the camera would smear across the whole viewport for a
 * frame. Dropping it is the honest answer — it is behind the viewer.
 */
export const NEAR_PLANE = 30;

/** How much of the fog range is spent; 1 would take the farthest node to black. */
export const FOG_DEPTH = 0.85;

/**
 * Orbit distance for a zoom factor. Inverse, so "zoom in" means "get closer"
 * and the wheel keeps the direction it has in 2D.
 */
export function orbitDistance(k: number): number {
  // A non-finite or non-positive k would put the camera at or beyond the
  // orbit centre; treat it as the resting distance rather than dividing by it.
  if (!Number.isFinite(k) || k <= 0) return BASE_DISTANCE;
  return BASE_DISTANCE / k;
}

/** Clamp a pitch to the range past which the cloud would flip. */
export function clampPitch(pitch: number): number {
  if (Number.isNaN(pitch)) return 0;
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

/** A node projected onto the viewport. */
export interface Projected {
  /** Screen position in CSS px, relative to the canvas' top-left. */
  readonly x: number;
  readonly y: number;
  /** World→screen scale at this node's depth. Radii multiply by it. */
  readonly scale: number;
  /** Distance from the camera plane. Painter ordering sorts on it. */
  readonly viewZ: number;
}

/**
 * World point → viewport point, or `null` when the point is at or behind the
 * near plane.
 *
 * Rotation order is yaw about Y, then pitch about X — the order a trackball
 * drag expects, and the prototype's. Reversing it makes horizontal drags feel
 * like they tumble once the cloud is pitched.
 */
export function project(
  point: Point3,
  camera: CameraState,
  orientation: Orientation,
  viewport: Viewport,
  targetZ = 0,
): Projected | null {
  // Pan moves the orbit target, so subtract it before rotating: panning is
  // "look at somewhere else", not "translate the screen".
  //
  // The target has a **depth** as well as an x/y, and `targetZ` is it. Only
  // two of its three coordinates fit on `CameraState`, so the third lives in
  // the engine — the same arrangement yaw and pitch have, and for the same
  // reason (DECISIONS.md D2).
  //
  // Without it the target is pinned to the z = 0 plane, and a node's own depth
  // rotates into screen x/y that no amount of x/y panning can cancel: at the
  // seeded orientation a node at z = 200 lands ~155 world units off centre, so
  // `flyTo` would leave its target visibly beside the middle of the viewport.
  // Defaults to 0, which is exactly the old behaviour.
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const dz = point.z - targetZ;

  const cosYaw = Math.cos(orientation.yaw);
  const sinYaw = Math.sin(orientation.yaw);
  const x1 = dx * cosYaw - dz * sinYaw;
  const z1 = dx * sinYaw + dz * cosYaw;

  const cosPitch = Math.cos(orientation.pitch);
  const sinPitch = Math.sin(orientation.pitch);
  const y2 = dy * cosPitch - z1 * sinPitch;
  const z2 = dy * sinPitch + z1 * cosPitch;

  const viewZ = z2 + orbitDistance(camera.k);
  if (!(viewZ >= NEAR_PLANE)) return null;

  const scale = FOCAL_LENGTH / viewZ;
  return {
    x: viewport.width / 2 + x1 * scale,
    y: viewport.height / 2 + y2 * scale,
    scale,
    viewZ,
  };
}

/**
 * The depth-fog multiplier for a node, given the depth range of everything
 * currently drawn.
 *
 * Normalised against the frame's own near/far rather than an absolute scale:
 * the cue has to keep working when the camera is close to a small cluster,
 * where every absolute depth is similar and an absolute ramp would render the
 * whole frame at one brightness.
 *
 * Returns 1 (no fog) when the range is degenerate — one node, or all nodes at
 * one depth — because there is no depth to cue.
 */
export function fogFactor(
  viewZ: number,
  nearest: number,
  farthest: number,
  strength: number,
): number {
  const span = farthest - nearest;
  if (!(span > 0)) return 1;
  const t = Math.min(1, Math.max(0, (viewZ - nearest) / span));
  return 1 - strength * FOG_DEPTH * t;
}

/**
 * Painter's-algorithm comparator: farthest first, so near nodes are drawn over
 * far ones and occlusion reads correctly.
 *
 * A canvas has no depth buffer, so draw order *is* the depth test. Ties break
 * on id, which keeps a frame's draw order deterministic (AD-6) when two nodes
 * sit at exactly the same depth — otherwise `Array.sort` stability would be
 * the only thing deciding it, and that is not something to lean on.
 */
export function byDepth(
  a: { readonly viewZ: number; readonly id: string },
  b: { readonly viewZ: number; readonly id: string },
): number {
  if (a.viewZ !== b.viewZ) return b.viewZ - a.viewZ;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
