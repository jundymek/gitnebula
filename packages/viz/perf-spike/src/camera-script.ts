/**
 * AC-2: the pan+zoom sequence is scripted, not hand-driven. A fixed list of
 * camera keyframes is interpolated on the rAF clock; the same script plays
 * identically on every run, so fps numbers are comparable between machines.
 */

import type { Camera } from "./unfold.js";

export interface CameraKeyframe extends Camera {
  /** Milliseconds from sequence start at which this camera state is reached. */
  atMs: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Camera state at time t (ms) — linear interpolation between keyframes. */
export function cameraAt(
  script: readonly CameraKeyframe[],
  tMs: number,
): Camera {
  const first = script[0];
  if (first === undefined) throw new Error("empty camera script");
  if (tMs <= first.atMs) return first;
  for (let i = 1; i < script.length; i++) {
    const prev = script[i - 1]!;
    const next = script[i]!;
    if (tMs <= next.atMs) {
      const t = (tMs - prev.atMs) / (next.atMs - prev.atMs);
      return {
        cx: lerp(prev.cx, next.cx, t),
        cy: lerp(prev.cy, next.cy, t),
        k: lerp(prev.k, next.k, t),
      };
    }
  }
  return script[script.length - 1]!;
}

export function scriptDurationMs(script: readonly CameraKeyframe[]): number {
  return script.length === 0 ? 0 : script[script.length - 1]!.atMs;
}

/**
 * Where the settled layout actually is. The scripts are derived from measured
 * bounds rather than a guessed world radius: a force layout's extent is not
 * known in advance, and a script panning through empty space measures nothing.
 * The bounds come from the seeded layout, so the script stays deterministic.
 */
export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function boundsCentre(b: LayoutBounds): { cx: number; cy: number } {
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

/**
 * Phase (b) sweep: frozen layout, wide pans across the whole extent plus a
 * zoom-out/in cycle, all below the unfold threshold.
 */
export function phaseBScript(b: LayoutBounds): CameraKeyframe[] {
  const { cx, cy } = boundsCentre(b);
  const hx = (b.maxX - b.minX) / 2;
  const hy = (b.maxY - b.minY) / 2;
  return [
    { atMs: 0, cx, cy, k: 1.0 },
    { atMs: 2000, cx: cx - hx * 0.8, cy: cy - hy * 0.8, k: 1.0 },
    { atMs: 4000, cx: cx + hx * 0.8, cy: cy - hy * 0.8, k: 1.2 },
    { atMs: 6000, cx: cx + hx * 0.8, cy: cy + hy * 0.8, k: 0.7 },
    { atMs: 8000, cx, cy, k: 1.5 },
    { atMs: 10000, cx, cy, k: 1.0 },
  ];
}

/**
 * Phase (c) sweep: zoom past UNFOLD_ZOOM, then trace the layout's perimeter so
 * collapsed modules keep entering the viewport and unfolding while the camera
 * is still moving — the case ADR-0006 turns into a pan-triggered event.
 */
export function phaseCScript(b: LayoutBounds): CameraKeyframe[] {
  const { cx, cy } = boundsCentre(b);
  const hx = (b.maxX - b.minX) / 2;
  const hy = (b.maxY - b.minY) / 2;
  return [
    { atMs: 0, cx: cx - hx * 0.7, cy: cy - hy * 0.7, k: 1.0 },
    { atMs: 1500, cx: cx - hx * 0.7, cy: cy - hy * 0.7, k: 2.2 },
    { atMs: 5500, cx: cx + hx * 0.7, cy: cy - hy * 0.7, k: 2.2 },
    { atMs: 9500, cx: cx + hx * 0.7, cy: cy + hy * 0.7, k: 2.2 },
    { atMs: 13500, cx: cx - hx * 0.7, cy: cy + hy * 0.7, k: 2.2 },
    { atMs: 15000, cx, cy, k: 2.2 },
  ];
}
