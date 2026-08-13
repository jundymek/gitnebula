/**
 * Camera maths — pure functions over `{x, y, k}`, in CSS pixels.
 *
 * The camera holds a world point at the viewport centre rather than an
 * accumulated pan offset (the mockup's `view.x/y`). Same behaviour, but
 * fit-to-bounds and fly-to become "put this point in the middle at this zoom"
 * instead of an offset derived from one, and device pixel ratio stays out of
 * it entirely: the context carries the DPR transform, so every number here is
 * a CSS pixel (a correction story 1.4's spike had to make).
 */

import { MAX_ZOOM, MIN_ZOOM } from "./constants.js";
import type { Bounds } from "./layout.js";
import type { CameraState, ScreenPoint } from "./types.js";

export interface Viewport {
  /** Canvas width in CSS pixels. */
  readonly width: number;
  /** Canvas height in CSS pixels. */
  readonly height: number;
}

export const IDENTITY_CAMERA: CameraState = { x: 0, y: 0, k: 1 };

/** FR-15's clamp. */
export function clampZoom(k: number): number {
  // NaN has no side of the range to fall to, so it falls to the floor.
  // Infinities do: `Math.min`/`Math.max` clamp them to the right end.
  if (Number.isNaN(k)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

export function toScreen(
  world: { x: number; y: number },
  camera: CameraState,
  viewport: Viewport,
): ScreenPoint {
  return {
    x: (world.x - camera.x) * camera.k + viewport.width / 2,
    y: (world.y - camera.y) * camera.k + viewport.height / 2,
  };
}

export function toWorld(
  screen: ScreenPoint,
  camera: CameraState,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (screen.x - viewport.width / 2) / camera.k + camera.x,
    y: (screen.y - viewport.height / 2) / camera.k + camera.y,
  };
}

/**
 * Zoom about a screen point: the world point under the cursor stays under the
 * cursor (FR-15). Note the clamp is applied *before* the recentring, so a
 * scroll at the zoom limit does not drift the map sideways.
 */
export function zoomAt(
  camera: CameraState,
  viewport: Viewport,
  screen: ScreenPoint,
  factor: number,
): CameraState {
  const k = clampZoom(camera.k * factor);
  const anchor = toWorld(screen, camera, viewport);
  return {
    k,
    x: anchor.x - (screen.x - viewport.width / 2) / k,
    y: anchor.y - (screen.y - viewport.height / 2) / k,
  };
}

/** Pan by a screen-space delta, the direction the pointer dragged. */
export function panBy(
  camera: CameraState,
  dx: number,
  dy: number,
): CameraState {
  return {
    ...camera,
    x: camera.x - dx / camera.k,
    y: camera.y - dy / camera.k,
  };
}

/**
 * The camera that frames `bounds` with `padding` CSS px to spare. Returns the
 * identity camera for an empty graph — there is nothing to frame, and a zoom
 * derived from a zero-size box would be an Infinity.
 */
export function fitCamera(
  bounds: Bounds | null,
  viewport: Viewport,
  padding: number,
): CameraState {
  if (bounds === null) return IDENTITY_CAMERA;
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const availableX = Math.max(viewport.width - padding * 2, 1);
  const availableY = Math.max(viewport.height - padding * 2, 1);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    k: clampZoom(Math.min(availableX / width, availableY / height)),
  };
}

/** Cubic ease-out — the mockup's flight easing, reused by fit and fly-to. */
export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - u, 3);
}

/** Interpolate two cameras. Zoom moves geometrically so the pace looks even. */
export function lerpCamera(
  from: CameraState,
  to: CameraState,
  t: number,
): CameraState {
  const e = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    k: from.k * Math.pow(to.k / from.k, e),
  };
}
