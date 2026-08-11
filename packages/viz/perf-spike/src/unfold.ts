/**
 * Viewport-scoped unfold per ADR-0006: past UNFOLD_ZOOM only modules
 * intersecting the viewport (plus a margin) unfold; member nodes spawn at
 * their module's position; module positions stay pinned during local settle.
 */

export const UNFOLD_ZOOM = 1.8; // reference/mockup.html constant
/** Extra world-space margin (as a fraction of viewport size) for unfold. */
export const VIEWPORT_MARGIN = 0.15;

export interface Camera {
  /** World coordinates at viewport centre. */
  cx: number;
  cy: number;
  /** Zoom factor (world px -> screen px multiplier). */
  k: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ModuleNode {
  id: string;
  x: number;
  y: number;
  /** Approximate drawn radius in world units. */
  r: number;
}

/**
 * Viewport in CSS pixels, given a canvas sized in device pixels.
 *
 * The canvas backing store is `cssSize * devicePixelRatio` so the render is
 * native-resolution, but every camera and viewport calculation must stay in
 * CSS pixels. Feeding device pixels to `visibleWorldRect` divides the
 * effective zoom by the DPR: the same camera script then covers DPR× more
 * world, unfolds more modules and draws smaller nodes, so a Retina run is not
 * comparable with a DPR-1 run.
 */
export function cssViewport(
  canvas: { width: number; height: number },
  devicePixelRatio: number,
): Viewport {
  return {
    width: canvas.width / devicePixelRatio,
    height: canvas.height / devicePixelRatio,
  };
}

/** World-space rectangle currently visible, expanded by VIEWPORT_MARGIN. */
export function visibleWorldRect(cam: Camera, vp: Viewport) {
  const halfW = (vp.width / cam.k) * (0.5 + VIEWPORT_MARGIN);
  const halfH = (vp.height / cam.k) * (0.5 + VIEWPORT_MARGIN);
  return {
    minX: cam.cx - halfW,
    maxX: cam.cx + halfW,
    minY: cam.cy - halfH,
    maxY: cam.cy + halfH,
  };
}

export function moduleIntersectsViewport(
  m: ModuleNode,
  cam: Camera,
  vp: Viewport,
): boolean {
  const r = visibleWorldRect(cam, vp);
  return (
    m.x + m.r >= r.minX &&
    m.x - m.r <= r.maxX &&
    m.y + m.r >= r.minY &&
    m.y - m.r <= r.maxY
  );
}

/** Which module ids should be unfolded for this camera state. */
export function unfoldedModules(
  modules: readonly ModuleNode[],
  cam: Camera,
  vp: Viewport,
): Set<string> {
  if (cam.k < UNFOLD_ZOOM) return new Set();
  const out = new Set<string>();
  for (const m of modules) {
    if (moduleIntersectsViewport(m, cam, vp)) out.add(m.id);
  }
  return out;
}

/** What changed between the previously unfolded set and the wanted one. */
export interface UnfoldTransition {
  /** Modules that just came into view and must unfold. */
  entered: Set<string>;
  /** Modules that just left view and must collapse (ADR-0006). */
  left: Set<string>;
  changed: boolean;
}

/**
 * Diffs the unfolded set against what the current camera wants. Collapse is
 * not an optimisation here: ADR-0006 makes "off-screen modules stay collapsed"
 * the behaviour being measured, so a phase that only ever unfolds accumulates
 * the whole graph and measures something the viewer will never do. Below
 * UNFOLD_ZOOM `unfoldedModules` returns the empty set, and the same diff then
 * collapses everything, which is the ADR's "zooming below the threshold
 * collapses all".
 */
export function unfoldTransition(
  unfolded: ReadonlySet<string>,
  want: ReadonlySet<string>,
): UnfoldTransition {
  const entered = new Set<string>();
  const left = new Set<string>();
  for (const id of want) if (!unfolded.has(id)) entered.add(id);
  for (const id of unfolded) if (!want.has(id)) left.add(id);
  return { entered, left, changed: entered.size > 0 || left.size > 0 };
}

/**
 * AC-5 evidence: tracks displacement of nodes that are NOT members of the
 * unfolding module, so the report can show local wake stays local.
 */
export class NonMemberDisplacementTracker {
  private start: Map<string, { x: number; y: number }> = new Map();

  capture(
    nodes: readonly { id: string; x: number; y: number }[],
    memberIds: ReadonlySet<string>,
  ): void {
    this.start.clear();
    for (const n of nodes) {
      if (!memberIds.has(n.id)) this.start.set(n.id, { x: n.x, y: n.y });
    }
  }

  /** Max displacement (px, world units) of tracked nodes since capture(). */
  maxDisplacement(
    nodes: readonly { id: string; x: number; y: number }[],
  ): number {
    let max = 0;
    for (const n of nodes) {
      const s = this.start.get(n.id);
      if (!s) continue;
      const d = Math.hypot(n.x - s.x, n.y - s.y);
      if (d > max) max = d;
    }
    return max;
  }
}
