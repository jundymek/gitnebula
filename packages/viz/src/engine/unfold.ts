/**
 * Viewport-scoped semantic unfold — the ADR-0006 rule, as pure geometry.
 *
 * The mockup unfolds every module once zoom crosses `UNFOLD_ZOOM`. At the
 * DoD scale that is 2,000 file nodes entering the simulation at once, which is
 * exactly the 60 fps worst case. ADR-0006 narrows it: past the threshold only
 * modules intersecting the viewport (plus a margin) unfold, so the simulated
 * file count is bounded by what fits on screen rather than by the repository.
 *
 * Story 1.4's spike (`perf-spike/src/unfold.ts`) proved the mechanism. This is
 * a deliberate port rather than an import: the spike is a measurement artifact
 * with its own `Camera`/`Viewport` types and hardcoded constants, and CLAUDE.md
 * is explicit that spike code is read for behaviour and never built on. What
 * moves across is the rule; the types are the engine's own.
 *
 * Everything here is pure — no canvas, no simulation — so the ADR's behaviour
 * is tested as arithmetic instead of through a rendered frame.
 */

import { UNFOLD_ZOOM } from "./constants.js";
import type { Viewport } from "./camera.js";
import type { CameraState } from "./types.js";

/**
 * Extra world-space margin around the viewport, as a fraction of its size
 * (spike's `VIEWPORT_MARGIN`).
 *
 * The margin is what makes panning feel continuous: a module unfolds slightly
 * before it reaches the edge of the screen, so its files are already settling
 * by the time the user can see them. Without it, unfold would visibly pop at
 * the viewport boundary.
 */
export const UNFOLD_VIEWPORT_MARGIN = 0.15;

/** A module as the unfold rule sees it: a position and a drawn radius. */
export interface UnfoldCandidate {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface WorldRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * The world-space rectangle currently visible, expanded by the margin.
 *
 * `camera.x`/`y` is the world point held at the viewport centre and `k` is the
 * world→screen multiplier, so half the visible world width is
 * `viewport.width / k / 2`. Every number here is a CSS pixel: the device pixel
 * ratio lives in the context transform alone, and feeding device pixels in
 * would divide the effective zoom by the DPR — the correction story 1.4 had to
 * make after a Retina run unfolded more modules than a DPR-1 run.
 */
export function visibleWorldRect(
  camera: CameraState,
  viewport: Viewport,
): WorldRect {
  const halfWidth =
    (viewport.width / camera.k) * (0.5 + UNFOLD_VIEWPORT_MARGIN);
  const halfHeight =
    (viewport.height / camera.k) * (0.5 + UNFOLD_VIEWPORT_MARGIN);
  return {
    minX: camera.x - halfWidth,
    maxX: camera.x + halfWidth,
    minY: camera.y - halfHeight,
    maxY: camera.y + halfHeight,
  };
}

/** Does a module's disc overlap the visible rectangle? */
export function intersectsViewport(
  candidate: UnfoldCandidate,
  rect: WorldRect,
): boolean {
  return (
    candidate.x + candidate.radius >= rect.minX &&
    candidate.x - candidate.radius <= rect.maxX &&
    candidate.y + candidate.radius >= rect.minY &&
    candidate.y - candidate.radius <= rect.maxY
  );
}

/**
 * The set of module ids that *should* be unfolded for this camera.
 *
 * Below the threshold this is empty, which is how "dropping below 1.8×
 * collapses all" falls out of the same diff that handles panning rather than
 * needing a rule of its own.
 */
export function wantedUnfolds(
  candidates: readonly UnfoldCandidate[],
  camera: CameraState,
  viewport: Viewport,
): Set<string> {
  if (camera.k < UNFOLD_ZOOM) return new Set();
  const rect = visibleWorldRect(camera, viewport);
  const wanted = new Set<string>();
  for (const candidate of candidates) {
    if (intersectsViewport(candidate, rect)) wanted.add(candidate.id);
  }
  return wanted;
}

/** What changed between the currently unfolded set and the wanted one. */
export interface UnfoldTransition {
  /** Modules that just came into view and must unfold. */
  readonly entered: readonly string[];
  /** Modules that just left view (or dropped below the threshold). */
  readonly left: readonly string[];
  readonly changed: boolean;
}

/**
 * Diff the current unfolded set against what the camera wants.
 *
 * Collapse is not an optimisation: ADR-0006 makes "off-screen modules stay
 * collapsed" the behaviour, so a rule that only ever unfolds would accumulate
 * the whole repository as the user pans and quietly recreate the worst case
 * the ADR exists to avoid.
 */
export function unfoldTransition(
  unfolded: ReadonlySet<string>,
  wanted: ReadonlySet<string>,
): UnfoldTransition {
  const entered: string[] = [];
  const left: string[] = [];
  for (const id of wanted) if (!unfolded.has(id)) entered.push(id);
  for (const id of unfolded) if (!wanted.has(id)) left.push(id);
  return { entered, left, changed: entered.length > 0 || left.length > 0 };
}
