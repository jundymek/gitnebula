/**
 * Drawing one 3D frame onto a 2D canvas.
 *
 * **No WebGL, no Three.js.** Perspective projection onto the same
 * `CanvasRenderingContext2D` the 2D view uses. That is what keeps ADR-0004's
 * ≤ 2 MB gzipped budget intact — a WebGL renderer plus a scene graph would
 * have spent it — and it is what the story's prototype exists to prove.
 *
 * **A canvas has no depth buffer, so draw order is the depth test.** Everything
 * is projected once, sorted farthest-first, and painted in that order. Edges
 * are projected from the same table as nodes rather than re-projected per edge:
 * the prototype called `project()` twice for every edge on every frame, which
 * at 2,000 nodes is the single most expensive avoidable thing in the loop.
 *
 * **Depth is encoded twice** — nearer nodes are both larger (perspective) and
 * brighter (fog). One cue carries the shape; two carry the density, which is
 * the whole reason to have a third dimension at all.
 *
 * The focus/alpha helpers below mirror `render.ts`'s rules and import the same
 * constants from `constants.ts`, so the two views cannot drift on encoding.
 * They are re-declared rather than reused because `render.ts`'s take a full
 * `RenderScene`, whose fields (world-space `x`/`y`, stars) mean nothing here.
 */

import {
  CHAIN_GLOW_BOOST,
  CHAIN_RING_ALPHA,
  CHAIN_RING_OFFSET_PX,
  COCHANGE_RING_ALPHA,
  COCHANGE_RING_COLOR,
  COCHANGE_RING_DASH,
  COCHANGE_RING_OFFSET_PX,
  COCHANGE_RING_WIDTH,
  EDGE_ALPHA_BASE,
  EDGE_ALPHA_CHAIN,
  EDGE_ALPHA_DIMMED,
  EDGE_ALPHA_HOVER_REST,
  EDGE_ALPHA_MEMBER,
  NODE_ALPHA_DIMMED,
  NODE_ALPHA_HOVER_REST,
  VOID_COLOR,
} from "./constants.js";
import { glowRadius, nodeColor, pulseFactor } from "./render.js";
import {
  byDepth,
  fogFactor,
  project,
  type Orientation,
  type Projected,
} from "./project3d.js";
import type { Viewport } from "./camera.js";
import type { CameraState, EngineNode, ViewMode } from "./types.js";

/** A node with a position in the 3D layout, ready to project. */
export interface Renderable3DNode {
  readonly node: EngineNode;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** An edge, by the ids of its ends. Positions come from the node table. */
export interface Renderable3DEdge {
  readonly sourceId: string;
  readonly targetId: string;
  /** Module → member-file edges draw fainter (mockup). */
  readonly member: boolean;
}

/**
 * Everything one 3D frame is drawn from.
 *
 * Deliberately its own type rather than an extension of `RenderScene`: a 3D
 * node carries `z`, its edges resolve through an id table instead of carrying
 * world endpoints, and there is no starfield (the depth cue occupies the same
 * visual channel). Agreed with 5.6's owner — `RenderScene` is untouched by this
 * story, so her additive field there never has to account for this shape.
 */
export interface Scene3D {
  readonly viewport: Viewport;
  readonly camera: CameraState;
  readonly orientation: Orientation;
  readonly nodes: readonly Renderable3DNode[];
  readonly edges: readonly Renderable3DEdge[];
  readonly mode: ViewMode;
  /** Clock for the hot pulse, in ms. */
  readonly timeMs: number;
  readonly reducedMotion: boolean;
  /** Ids of the focused dependency chain, or null when nothing is focused. */
  readonly chain: ReadonlySet<string> | null;
  readonly chainMode?: "hover" | "isolate";
  readonly selectedId: string | null;
  /** Co-change partner set marked on the map (story 5.6), or null. */
  readonly blastRadius?: ReadonlySet<string> | null;
  readonly showFileLabels: boolean;
  /** 0 disables the depth fog; 1 is the full ramp. */
  readonly fogStrength: number;
}

/** A node that survived projection and culling, with its drawing inputs. */
export interface Placed3DNode {
  readonly node: EngineNode;
  readonly id: string;
  readonly sx: number;
  readonly sy: number;
  readonly viewZ: number;
  /** Projected radius in screen px. */
  readonly screenR: number;
}

const TAU = Math.PI * 2;
/** Nodes this far outside the viewport are not drawn (mockup's margin). */
const CULL_MARGIN_PX = 60;
/** Screen radius below which a node is a dot rather than a disc. */
const MIN_SCREEN_RADIUS = 0.7;
/** How many labels one frame may draw — the 2D view's budget lesson. */
const LABEL_BUDGET = 34;
/** Label occupancy grid cell, in px. */
const LABEL_CELL_PX = 16;

interface FocusState {
  readonly chain: ReadonlySet<string> | null;
  readonly chainMode?: "hover" | "isolate";
}

/** A scene with no chain has no outside, so everything is "in". */
export function inChain3D(scene: FocusState, nodeId: string): boolean {
  return scene.chain === null || scene.chain.has(nodeId);
}

/** Node opacity under the focus state — `render.ts`'s rule, same constants. */
export function nodeAlpha3D(scene: FocusState, nodeId: string): number {
  if (inChain3D(scene, nodeId)) return 1;
  return scene.chainMode === "hover"
    ? NODE_ALPHA_HOVER_REST
    : NODE_ALPHA_DIMMED;
}

/** Edge opacity. An edge is in the chain only when both of its ends are. */
export function edgeAlpha3D(scene: FocusState, edge: Renderable3DEdge): number {
  if (scene.chain === null) {
    return edge.member ? EDGE_ALPHA_MEMBER : EDGE_ALPHA_BASE;
  }
  if (scene.chain.has(edge.sourceId) && scene.chain.has(edge.targetId)) {
    return EDGE_ALPHA_CHAIN;
  }
  return scene.chainMode === "hover"
    ? EDGE_ALPHA_HOVER_REST
    : EDGE_ALPHA_DIMMED;
}

/** Chain emphasis is a hover encoding only (story 5.2, AC-4). */
export function emphasised3D(scene: FocusState, nodeId: string): boolean {
  return (
    scene.chainMode === "hover" &&
    scene.chain !== null &&
    scene.chain.has(nodeId)
  );
}

/**
 * Project every node once and drop what cannot be drawn.
 *
 * Returned sorted farthest-first — the painter's order the renderer draws in
 * and `pick` walks in reverse. Exported because picking must agree with the
 * frame exactly: two independent projections would disagree at the edges and
 * the user would click a node and select its neighbour.
 */
export function placeNodes(scene: Scene3D): Placed3DNode[] {
  const { camera, orientation, viewport } = scene;
  const placed: Placed3DNode[] = [];
  for (const item of scene.nodes) {
    const p: Projected | null = project(item, camera, orientation, viewport);
    if (!p) continue;
    if (
      p.x < -CULL_MARGIN_PX ||
      p.x > viewport.width + CULL_MARGIN_PX ||
      p.y < -CULL_MARGIN_PX ||
      p.y > viewport.height + CULL_MARGIN_PX
    ) {
      continue;
    }
    placed.push({
      node: item.node,
      id: item.node.id,
      sx: p.x,
      sy: p.y,
      viewZ: p.viewZ,
      screenR: Math.max(MIN_SCREEN_RADIUS, item.node.radius * p.scale),
    });
  }
  placed.sort(byDepth);
  return placed;
}

/** The frame's depth range, for normalising the fog ramp. */
function depthRange(placed: readonly Placed3DNode[]): {
  nearest: number;
  farthest: number;
} {
  let nearest = Infinity;
  let farthest = -Infinity;
  for (const p of placed) {
    if (p.viewZ < nearest) nearest = p.viewZ;
    if (p.viewZ > farthest) farthest = p.viewZ;
  }
  return { nearest, farthest };
}

/** Draw one 3D frame. */
export function renderFrame3D(
  ctx: CanvasRenderingContext2D,
  scene: Scene3D,
): void {
  const { viewport } = scene;

  ctx.fillStyle = VOID_COLOR;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const placed = placeNodes(scene);
  if (placed.length === 0) return;

  const { nearest, farthest } = depthRange(placed);
  const fogOf = (viewZ: number): number =>
    fogFactor(viewZ, nearest, farthest, scene.fogStrength);

  // One lookup table, built once: edges resolve their endpoints from it rather
  // than re-projecting. The prototype re-projected both ends of every edge on
  // every frame, which doubles the projection cost of a dense graph.
  const byId = new Map<string, Placed3DNode>();
  for (const p of placed) byId.set(p.id, p);

  drawEdges(ctx, scene, byId, fogOf);
  drawNodes(ctx, scene, placed, fogOf);
  // Module labels always; `showFileLabels` gates the file ones inside.
  drawLabels(ctx, scene, placed, fogOf);
  ctx.globalAlpha = 1;
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  scene: Scene3D,
  byId: ReadonlyMap<string, Placed3DNode>,
  fogOf: (viewZ: number) => number,
): void {
  ctx.lineWidth = 1;
  for (const edge of scene.edges) {
    const a = byId.get(edge.sourceId);
    const b = byId.get(edge.targetId);
    // An endpoint that was culled or fell behind the near plane takes its edge
    // with it: a line to a node that is not on screen points at nothing.
    if (!a || !b) continue;
    const alpha = edgeAlpha3D(scene, edge) * fogOf((a.viewZ + b.viewZ) / 2);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = "rgba(150,170,215,1)";
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  scene: Scene3D,
  placed: readonly Placed3DNode[],
  fogOf: (viewZ: number) => number,
): void {
  const pulse = pulseFactor(scene.timeMs, scene.reducedMotion);
  const blast = scene.blastRadius ?? null;

  for (const p of placed) {
    const { node } = p;
    const fog = fogOf(p.viewZ);
    const alpha = nodeAlpha3D(scene, node.id) * fog;
    const color = nodeColor(node, scene.mode);

    // Glow, then core — the mockup's two-pass node.
    const boost = emphasised3D(scene, node.id) ? CHAIN_GLOW_BOOST : 1;
    const glow = glowRadius(node, p.screenR, pulse) * boost;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    const gradient = ctx.createRadialGradient(
      p.sx,
      p.sy,
      0,
      p.sx,
      p.sy,
      Math.max(glow, 1),
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.32, "rgba(255,255,255,0.04)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, Math.max(glow, 1), 0, TAU);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, p.screenR, 0, TAU);
    ctx.fill();

    // Story 5.2's chain ring, inside the selection ring so the two never read
    // as the same mark.
    if (emphasised3D(scene, node.id)) {
      ctx.globalAlpha = CHAIN_RING_ALPHA * fog;
      ctx.strokeStyle = "rgba(230,238,252,1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.screenR + CHAIN_RING_OFFSET_PX, 0, TAU);
      ctx.stroke();
    }

    // Story 5.6's co-change mark. Deliberately a ring and never a line: a
    // co-change partner is not a dependency, and drawing it as an edge would
    // say something false about the graph.
    //
    // Encoding constants are 5.6's, imported rather than restated: the whole
    // argument for drawing this ring in 3D was that the two views must not
    // drift, and two copies of a colour is exactly how they would. The dash is
    // the primary distinction rather than the hue, because it survives a
    // greyscale render.
    if (blast && blast.has(node.id)) {
      ctx.globalAlpha = Math.max(0, Math.min(1, COCHANGE_RING_ALPHA * fog));
      ctx.strokeStyle = COCHANGE_RING_COLOR;
      ctx.lineWidth = COCHANGE_RING_WIDTH;
      ctx.setLineDash?.(COCHANGE_RING_DASH);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.screenR + COCHANGE_RING_OFFSET_PX, 0, TAU);
      ctx.stroke();
      ctx.setLineDash?.([]);
    }

    if (node.id === scene.selectedId) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(230,238,252,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.screenR + 5, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Labels, budgeted and collision-checked.
 *
 * Nearest-and-biggest first, because those are the ones the eye is on anyway,
 * and an occupancy grid stops two labels overprinting. Both are the 2D view's
 * lessons; at depth they matter more, not less, because perspective puts many
 * more small nodes on screen at once.
 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  scene: Scene3D,
  placed: readonly Placed3DNode[],
  fogOf: (viewZ: number) => number,
): void {
  const { viewport } = scene;
  const taken = new Set<number>();
  const columns = Math.ceil(viewport.width / LABEL_CELL_PX) + 2;
  const claim = (cx: number, cy: number, w: number, h: number): boolean => {
    const x0 = Math.floor((cx - w / 2) / LABEL_CELL_PX);
    const x1 = Math.floor((cx + w / 2) / LABEL_CELL_PX);
    const y0 = Math.floor((cy - h) / LABEL_CELL_PX);
    const y1 = Math.floor(cy / LABEL_CELL_PX);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (taken.has(y * columns + x)) return false;
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) taken.add(y * columns + x);
    }
    return true;
  };

  const candidates = placed
    .filter((p) => p.node.kind === "module" || scene.showFileLabels)
    // Nearest first here, unlike the painter's order the array arrives in.
    .slice()
    .sort(
      (a, b) =>
        (a.node.kind === b.node.kind ? 0 : a.node.kind === "module" ? -1 : 1) ||
        b.screenR - a.screenR,
    );

  let drawn = 0;
  ctx.textAlign = "center";
  for (const p of candidates) {
    if (drawn >= LABEL_BUDGET) break;
    const isModule = p.node.kind === "module";
    const text = isModule ? p.node.path : basename(p.node.path);
    ctx.font = `${isModule ? 12 : 10}px ui-monospace, Menlo, monospace`;
    const width = ctx.measureText(text).width;
    const labelY = p.sy - p.screenR - 6;
    if (!claim(p.sx, labelY, width + 6, isModule ? 12 : 10)) continue;
    ctx.globalAlpha = nodeAlpha3D(scene, p.node.id) * fogOf(p.viewZ);
    ctx.fillStyle = isModule
      ? "rgba(224,231,244,0.92)"
      : "rgba(150,163,188,0.8)";
    ctx.fillText(text, p.sx, labelY);
    drawn += 1;
  }
  ctx.globalAlpha = 1;
}

function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
