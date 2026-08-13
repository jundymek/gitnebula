/**
 * The scripted pan+zoom sequence (AC-3), carried over from story 1.4.
 *
 * Two properties make the number comparable between runs and machines:
 *
 * 1. **Scripted, never hand-driven.** A fixed keyframe list interpolated on
 *    the rAF clock. No pointer input takes part in any measured phase.
 * 2. **Derived from the map's measured extent, not a guessed world radius.**
 *    1.4 shipped a version that panned around the origin while the layout had
 *    settled a thousand units away, and measured an empty screen at a
 *    perfectly respectable frame rate. Here the extent comes from the camera
 *    the engine itself chose when it framed the graph — `fit()` puts the whole
 *    graph in the viewport, so the visible world rectangle at that moment *is*
 *    the graph's extent plus the fit padding.
 */

export interface CameraKeyframe {
  /** Milliseconds from phase start at which this camera state is reached. */
  readonly atMs: number;
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface LayoutExtent {
  readonly cx: number;
  readonly cy: number;
  /** Half-width and half-height of the graph in world units. */
  readonly hx: number;
  readonly hy: number;
}

/**
 * Recover the graph's extent from the post-`fit()` camera.
 *
 * `fit()` frames the graph with `paddingPx` of slack, so the world rectangle
 * the viewport covers is the graph's bounds grown by that padding in screen
 * pixels — divide it back out by the zoom to get world units.
 */
export function extentFromFitCamera(
  camera: { x: number; y: number; k: number },
  viewport: { width: number; height: number },
  paddingPx: number,
): LayoutExtent {
  return {
    cx: camera.x,
    cy: camera.y,
    hx: Math.max(1, (viewport.width / 2 - paddingPx) / camera.k),
    hy: Math.max(1, (viewport.height / 2 - paddingPx) / camera.k),
  };
}

/**
 * Phase (b) — the settled map under a wide pan and a zoom-out/in cycle, all
 * below `UNFOLD_ZOOM`. This is the everyday interaction FR-15 describes.
 */
export function panZoomScript(extent: LayoutExtent): CameraKeyframe[] {
  const { cx, cy, hx, hy } = extent;
  return [
    { atMs: 0, x: cx, y: cy, k: 1.0 },
    { atMs: 2000, x: cx - hx * 0.8, y: cy - hy * 0.8, k: 1.0 },
    { atMs: 4000, x: cx + hx * 0.8, y: cy - hy * 0.8, k: 1.2 },
    { atMs: 6000, x: cx + hx * 0.8, y: cy + hy * 0.8, k: 0.7 },
    { atMs: 8000, x: cx, y: cy, k: 1.5 },
    { atMs: 10000, x: cx, y: cy, k: 1.0 },
  ];
}

/**
 * Phase (c) — a perimeter pan held above `UNFOLD_ZOOM` (1.8×), so collapsed
 * modules keep entering the viewport while the camera is still moving. That is
 * the case ADR-0006 turns into a pan-triggered unfold, and the expensive one.
 */
export function unfoldPanScript(extent: LayoutExtent): CameraKeyframe[] {
  const { cx, cy, hx, hy } = extent;
  return [
    { atMs: 0, x: cx - hx * 0.7, y: cy - hy * 0.7, k: 1.0 },
    { atMs: 1500, x: cx - hx * 0.7, y: cy - hy * 0.7, k: 2.2 },
    { atMs: 5500, x: cx + hx * 0.7, y: cy - hy * 0.7, k: 2.2 },
    { atMs: 9500, x: cx + hx * 0.7, y: cy + hy * 0.7, k: 2.2 },
    { atMs: 13500, x: cx - hx * 0.7, y: cy + hy * 0.7, k: 2.2 },
    { atMs: 15000, x: cx, y: cy, k: 2.2 },
  ];
}

export function scriptDurationMs(script: readonly CameraKeyframe[]): number {
  return script.length === 0 ? 0 : script[script.length - 1]!.atMs;
}

/** Camera state at time `tMs`, linearly interpolated between keyframes. */
export function cameraAt(
  script: readonly CameraKeyframe[],
  tMs: number,
): { x: number; y: number; k: number } {
  const first = script[0];
  if (first === undefined) throw new Error("perf: empty camera script");
  if (tMs <= first.atMs) return { x: first.x, y: first.y, k: first.k };
  for (let i = 1; i < script.length; i++) {
    const prev = script[i - 1]!;
    const next = script[i]!;
    if (tMs <= next.atMs) {
      const t = (tMs - prev.atMs) / (next.atMs - prev.atMs);
      return {
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
        k: prev.k + (next.k - prev.k) * t,
      };
    }
  }
  const last = script[script.length - 1]!;
  return { x: last.x, y: last.y, k: last.k };
}
