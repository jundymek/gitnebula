/**
 * The renderer: one function that turns a scene into canvas calls.
 *
 * Every encoding rule from UX-DR1–5 lives here and nowhere else — palette,
 * radius, glow ∝ churn, the hot override and its pulse, curved edges, module
 * labels. It takes a context rather than owning a canvas, so the encoding is
 * testable against a recording double instead of against pixels.
 */

import {
  EDGE_ALPHA_BASE,
  EDGE_ALPHA_CHAIN,
  EDGE_ALPHA_DIMMED,
  EDGE_ALPHA_MEMBER,
  EDGE_CURVE,
  HOT_COLOR,
  HOT_PULSE_MS,
  LAYER_COLOR,
  NODE_ALPHA_DIMMED,
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
  readonly selectedId: string | null;
  /** File labels appear from 3.0× (story 3.3). */
  readonly showFileLabels: boolean;
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
    let alpha = edge.member ? EDGE_ALPHA_MEMBER : EDGE_ALPHA_BASE;
    if (scene.chain) {
      alpha =
        scene.chain.has(edge.sourceId) && scene.chain.has(edge.targetId)
          ? EDGE_ALPHA_CHAIN
          : EDGE_ALPHA_DIMMED;
    }
    ctx.strokeStyle = `rgba(150,170,215,${alpha})`;
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
    const color = nodeColor(node, scene.mode);
    const screenRadius = node.radius * camera.k;
    const glow = glowRadius(node, screenRadius, pulse);

    ctx.globalAlpha = dim ? NODE_ALPHA_DIMMED : 1;

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

    if (node.id === scene.selectedId) {
      ctx.strokeStyle = "rgba(230,238,252,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, screenRadius + 5, 0, TAU);
      ctx.stroke();
    }

    if (node.kind === "module") {
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = dim ? "rgba(214,222,236,0.16)" : "rgba(214,222,236,0.88)";
      ctx.fillText(node.path, s.x, s.y - screenRadius - 8);
    } else if (scene.showFileLabels && !dim) {
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
