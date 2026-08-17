/**
 * The renderer: one function that turns a scene into canvas calls.
 *
 * Every encoding rule from UX-DR1–5 lives here and nowhere else — palette,
 * radius, glow ∝ churn, the hot override and its pulse, curved edges, module
 * labels. It takes a context rather than owning a canvas, so the encoding is
 * testable against a recording double instead of against pixels.
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
  EDGE_CURVE,
  HOT_COLOR,
  HOT_PULSE_MS,
  LAYER_COLOR,
  NODE_ALPHA_DIMMED,
  NODE_ALPHA_HOVER_REST,
  PULSE_MAX_RADIUS_PX,
  VOID_COLOR,
} from "./constants.js";
import { toScreen, type Viewport } from "./camera.js";
import type { Star } from "./starfield.js";
import type { CameraState, EngineNode, ViewMode } from "./types.js";

/** A node with a position, ready to draw. */
export interface RenderableNode {
  readonly node: EngineNode;
  readonly x: number;
  readonly y: number;
}

/** An edge with both endpoints resolved to world coordinates. */
export interface RenderableEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly sx: number;
  readonly sy: number;
  readonly tx: number;
  readonly ty: number;
  /** Module → member-file edges draw thinner and fainter (mockup). */
  readonly member: boolean;
}

export interface RenderScene {
  readonly viewport: Viewport;
  readonly camera: CameraState;
  readonly stars: readonly Star[];
  readonly nodes: readonly RenderableNode[];
  readonly edges: readonly RenderableEdge[];
  readonly mode: ViewMode;
  /** Clock for the hot pulse, in ms. */
  readonly timeMs: number;
  readonly reducedMotion: boolean;
  /** Ids of the focused dependency chain, or null when nothing is focused. */
  readonly chain: ReadonlySet<string> | null;
  /**
   * Which interaction put `chain` there, and therefore how the rest of the map
   * is encoded (story 5.2).
   *
   * `"isolate"` is the mockup's original hard dim — the user asked to see one
   * chain and nothing else. `"hover"` is FR-29's resting encoding: the map
   * stays legible and the chain is found by emphasis. Optional, and omitting
   * it means `"isolate"`, so a scene built before this story keeps its exact
   * meaning.
   */
  readonly chainMode?: "hover" | "isolate";
  readonly selectedId: string | null;
  /** File labels appear from 3.0× (story 3.3). */
  readonly showFileLabels: boolean;
  /**
   * A search-arrival pulse: the target node and progress 0 → 1 (story 3.3).
   * Optional so the field is additive — 3.5's export builds the same scene.
   */
  readonly pulse?: { readonly id: string; readonly t: number } | null;
  /**
   * The co-change partner set being marked, or null (story 5.6, AC-4).
   *
   * Optional, so a scene built before this story keeps its exact meaning —
   * the same shape `chainMode` took for the same reason.
   *
   * It is a set of node ids and nothing else: there is deliberately no
   * `blastRadiusEdges`. Co-change is not a dependency, and the moment this
   * carried a pair of endpoints somebody would draw a line between them.
   */
  readonly blastRadius?: ReadonlySet<string> | null;
}

/**
 * Structure mode: the hot colour REPLACES the layer colour, it does not tint
 * it (UX-DR2 — the reconcile brief called this out explicitly). Heat mode is
 * the mockup's cold→hot ramp over churn; story 3.4 owns the toggle that
 * reaches it.
 */
export function nodeColor(node: EngineNode, mode: ViewMode): string {
  if (mode === "heat") {
    const c = Math.min(1, node.churn / 0.7);
    const r = Math.round(58 + c * 197);
    const g = Math.round(111 + c * 11);
    const b = Math.round(216 - c * 155);
    return `rgb(${r},${g},${b})`;
  }
  return node.hot ? HOT_COLOR : LAYER_COLOR[node.layer];
}

/**
 * Is this node part of the focused chain? A scene with no chain has no
 * outside, so everything is "in".
 */
export function inChain(scene: RenderScene, nodeId: string): boolean {
  return scene.chain === null || scene.chain.has(nodeId);
}

/**
 * Opacity of a node under the scene's focus state (story 5.2, AC-1).
 *
 * Two encodings, chosen by `chainMode`: hover leaves the map legible at
 * `NODE_ALPHA_HOVER_REST`, isolate keeps the mockup's `NODE_ALPHA_DIMMED`.
 * A pure function over the render state, so the encoding is asserted directly
 * rather than inferred from the order of canvas calls.
 */
export function nodeAlpha(scene: RenderScene, nodeId: string): number {
  if (inChain(scene, nodeId)) return 1;
  return scene.chainMode === "hover"
    ? NODE_ALPHA_HOVER_REST
    : NODE_ALPHA_DIMMED;
}

/**
 * Opacity of an edge under the scene's focus state (story 5.2, AC-1).
 *
 * An edge is "in the chain" only when both of its ends are — a half-lit edge
 * points at something the user is not being shown.
 */
export function edgeAlpha(scene: RenderScene, edge: RenderableEdge): number {
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

/**
 * Does this node carry the chain's emphasis — the brightness boost and the
 * ring (story 5.2)?
 *
 * Hover only. Isolate already says "this and nothing else" by extinguishing
 * the rest, and adding a mark there would change an encoding no story asked
 * to change (AC-4).
 */
export function emphasised(scene: RenderScene, nodeId: string): boolean {
  return (
    scene.chainMode === "hover" &&
    scene.chain !== null &&
    scene.chain.has(nodeId)
  );
}

/**
 * Is this node in the marked co-change set (story 5.6, AC-4)?
 *
 * A pure function over the render state, like `emphasised` above it, so the
 * encoding is asserted directly instead of being inferred from the order of
 * canvas calls.
 *
 * Note what it does not do: it does not consult `chain`, and nothing else
 * consults it. The blast radius neither dims the map nor brightens it — it
 * adds one mark and changes no other encoding, so a reader can hold a hover
 * chain and a blast radius on screen at once and tell which is which.
 */
export function inBlastRadius(scene: RenderScene, nodeId: string): boolean {
  return scene.blastRadius != null && scene.blastRadius.has(nodeId);
}

/** The hot-spot pulse factor: ~380 ms sine, flat under reduced motion. */
export function pulseFactor(timeMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 0.62 + 0.38 * Math.sin(timeMs / HOT_PULSE_MS);
}

/** Glow radius in screen px — grows with churn, so hot spots bloom (UX-DR4). */
export function glowRadius(
  node: EngineNode,
  screenRadius: number,
  pulse: number,
): number {
  const hotFactor = node.hot ? pulse : 1;
  const factor =
    node.kind === "module" ? 2.4 + node.churn * 2.4 * hotFactor : 3;
  return Math.max(screenRadius * factor, 1);
}

const TAU = Math.PI * 2;
/** Nodes this far outside the viewport are not drawn (mockup's margin). */
const CULL_MARGIN_PX = 60;

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  scene: RenderScene,
): void {
  const { viewport, camera } = scene;

  ctx.fillStyle = VOID_COLOR;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  for (const star of scene.stars) {
    ctx.fillStyle = `rgba(190,205,235,${star.alpha})`;
    ctx.fillRect(
      star.x * viewport.width,
      star.y * viewport.height,
      star.radius,
      star.radius,
    );
  }

  for (const edge of scene.edges) {
    const s = toScreen({ x: edge.sx, y: edge.sy }, camera, viewport);
    const t = toScreen({ x: edge.tx, y: edge.ty }, camera, viewport);
    ctx.strokeStyle = `rgba(150,170,215,${edgeAlpha(scene, edge)})`;
    ctx.lineWidth = edge.member ? 0.5 : 1;
    // Quadratic control point offset perpendicular to the chord: the curve
    // that keeps two-way dependencies from overdrawing each other (UX-DR5).
    const mx = (s.x + t.x) / 2 + (s.y - t.y) * EDGE_CURVE;
    const my = (s.y + t.y) / 2 + (t.x - s.x) * EDGE_CURVE;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(mx, my, t.x, t.y);
    ctx.stroke();
  }

  const pulse = pulseFactor(scene.timeMs, scene.reducedMotion);

  for (const item of scene.nodes) {
    const node = item.node;
    const s = toScreen(item, camera, viewport);
    if (
      s.x < -CULL_MARGIN_PX ||
      s.x > viewport.width + CULL_MARGIN_PX ||
      s.y < -CULL_MARGIN_PX ||
      s.y > viewport.height + CULL_MARGIN_PX
    ) {
      continue;
    }

    const dim = scene.chain !== null && !scene.chain.has(node.id);
    const lit = emphasised(scene, node.id);
    const color = nodeColor(node, scene.mode);
    const screenRadius = node.radius * camera.k;
    // The chain is *added to*, not carved out of the map (story 5.2): a
    // hovered node and its one-hop neighbours bloom, everything else keeps a
    // resting opacity it can still be read at.
    const glow =
      glowRadius(node, screenRadius, pulse) * (lit ? CHAIN_GLOW_BOOST : 1);

    const alpha = nodeAlpha(scene, node.id);
    ctx.globalAlpha = alpha;

    const gradient = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glow);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.32, "rgba(255,255,255,0.045)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(s.x, s.y, glow, 0, TAU);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(screenRadius, 0.8), 0, TAU);
    ctx.fill();

    // The chain ring, inside the selection ring's +5 px so the two marks stay
    // distinguishable: a hovered neighbour is not a selected node.
    if (lit) {
      ctx.strokeStyle = `rgba(230,238,252,${CHAIN_RING_ALPHA})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, screenRadius + CHAIN_RING_OFFSET_PX, 0, TAU);
      ctx.stroke();
    }

    // The co-change mark: a dashed ring outside the selection ring (story
    // 5.6). Dashed because every other ring on this map is solid, and the
    // dash survives a greyscale render where a hue alone would not.
    if (inBlastRadius(scene, node.id)) {
      ctx.setLineDash([...COCHANGE_RING_DASH]);
      ctx.strokeStyle = COCHANGE_RING_COLOR;
      ctx.globalAlpha = alpha * COCHANGE_RING_ALPHA;
      ctx.lineWidth = COCHANGE_RING_WIDTH;
      ctx.beginPath();
      ctx.arc(s.x, s.y, screenRadius + COCHANGE_RING_OFFSET_PX, 0, TAU);
      ctx.stroke();
      // Restored immediately: a dash pattern left set would leak into the
      // selection ring below and into the next node's marks.
      ctx.setLineDash([]);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
    }

    if (node.id === scene.selectedId) {
      ctx.strokeStyle = "rgba(230,238,252,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, screenRadius + 5, 0, TAU);
      ctx.stroke();
    }

    // The search-arrival pulse: a ring that expands and fades once, marking
    // which node the camera just flew to (story 3.3).
    if (scene.pulse && scene.pulse.id === node.id) {
      const t = Math.min(1, Math.max(0, scene.pulse.t));
      ctx.globalAlpha = alpha * (1 - t);
      ctx.strokeStyle = "rgba(230,238,252,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, screenRadius + 5 + t * PULSE_MAX_RADIUS_PX, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    if (node.kind === "module") {
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      // Under hover the label rides the node's own resting opacity rather than
      // being darkened a second time; under isolate the mockup's near-invisible
      // label is the point, and stays exactly as it was.
      ctx.fillStyle =
        dim && scene.chainMode !== "hover"
          ? "rgba(214,222,236,0.16)"
          : "rgba(214,222,236,0.88)";
      ctx.fillText(node.path, s.x, s.y - screenRadius - 8);
      // File labels survive a hover. Suppressing them is right for isolate,
      // but at `FILE_LABEL_ZOOM` on a real map ~400 of them are on screen at
      // once, so under the old rule moving the pointer onto any node deleted
      // 400 labels and moving it off restored them — the largest single strobe
      // on the map, and exactly what FR-29 is about. Out-of-chain labels now
      // ride their node's resting opacity instead.
    } else if (scene.showFileLabels && (!dim || scene.chainMode === "hover")) {
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(133,146,171,0.75)";
      ctx.fillText(basename(node.path), s.x, s.y - screenRadius - 5);
    }

    ctx.globalAlpha = 1;
  }
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
