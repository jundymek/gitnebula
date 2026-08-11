/**
 * `CanvasGraphEngine` — the one implementation of the AD-5 seam.
 *
 * This is the only module in `viz` that touches a canvas, a 2D context, a
 * simulation or a pointer event. Chrome reaches the map through the
 * `GraphEngine` interface and its events; `src/chrome/boundary.test.ts` holds
 * that line.
 *
 * The frame loop follows story 1.4's verdict: one simulation tick per rendered
 * frame while settling, then **freeze-on-settle** — the simulation stops being
 * ticked at all, and the loop keeps running only to animate the hot-spot pulse
 * and camera flights (~0.2 ms/frame in the spike's frozen phase).
 */

import {
  FIT_DURATION_MS,
  FIT_PADDING_PX,
  FILE_LABEL_ZOOM,
  HOT_THRESHOLD,
  ZOOM_IN_STEP,
  ZOOM_OUT_STEP,
} from "./constants.js";
import {
  fitCamera,
  IDENTITY_CAMERA,
  easeOutCubic,
  lerpCamera,
  panBy,
  toWorld,
  zoomAt,
  type Viewport,
} from "./camera.js";
import { Emitter } from "./emitter.js";
import { buildGraph, type Graph } from "./graph.js";
import { ModuleLayout } from "./layout.js";
import { mulberry32, seedFor, type Rng } from "./prng.js";
import {
  renderFrame,
  type RenderableEdge,
  type RenderableNode,
} from "./render.js";
import { seedStars, type Star } from "./starfield.js";
import type {
  CameraState,
  EngineOptions,
  EngineNode,
  FitOptions,
  GraphEngine,
  GraphEngineEvent,
  GraphEngineListener,
  ScreenPoint,
  ViewMode,
} from "./types.js";
import type { AnalysisDocument } from "@gitnebula/contract";

/**
 * Declared on the interface (AC-7), owned by a later story. Throwing names the
 * story: a silent no-op would let a caller believe the map moved when it did
 * not.
 */
function notYet<T>(member: string, story: string): Promise<T> {
  return Promise.reject(
    new Error(
      `GraphEngine.${member} is declared for story ${story} and not implemented in 2.5`,
    ),
  );
}

interface CameraFlight {
  readonly from: CameraState;
  readonly to: CameraState;
  /**
   * Set on the flight's first animated frame rather than at creation, so the
   * flight is timed by the frame clock it is animated on. Reading a second
   * clock here is how a flight created outside the loop ends up with a
   * negative or already-elapsed `t`.
   */
  startMs: number | null;
  readonly durationMs: number;
  readonly resolve: () => void;
}

export class CanvasGraphEngine implements GraphEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly emitter = new Emitter();
  private readonly hotThreshold: number;
  private readonly reducedMotion: boolean;

  private graph: Graph | null = null;
  private layout: ModuleLayout | null = null;
  private rng: Rng = mulberry32(0);
  private stars: readonly Star[] = [];
  private seed = 0;

  private viewport: Viewport = { width: 0, height: 0 };
  private camera: CameraState = IDENTITY_CAMERA;
  private flight: CameraFlight | null = null;

  private mode: ViewMode = "structure";
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private isolatedId: string | null = null;

  private frameHandle: number | null = null;
  private settleStartMs: number | null = null;
  private settleAnnounced = false;

  private dragging = false;
  private dragOrigin: ScreenPoint | null = null;

  constructor(options: EngineOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error("viz: canvas 2D context unavailable");
    }
    this.ctx = ctx;
    this.hotThreshold = options.hotThreshold ?? HOT_THRESHOLD;
    this.reducedMotion =
      options.reducedMotion ??
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false;

    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    globalThis.addEventListener?.("resize", this.onWindowResize);

    this.resize();
  }

  // ---- lifecycle ---------------------------------------------------------

  load(document: AnalysisDocument, seed?: number): void {
    this.seed = seed ?? seedFor(document.repo.name);
    this.graph = buildGraph(document, this.hotThreshold);
    this.selectedId = null;
    this.hoveredId = null;
    this.isolatedId = null;
    this.startSettle("load");
    this.startLoop();
  }

  replay(): void {
    if (!this.graph) return;
    this.startSettle("replay");
  }

  private startSettle(reason: "load" | "replay"): void {
    const graph = this.graph;
    if (!graph) return;
    // One stream per settle run, re-derived from the same seed: replay must
    // reproduce the load layout exactly, not continue the earlier stream
    // (AD-6 — "the same analysis.json always settles into the same map").
    this.rng = mulberry32(this.seed);
    this.layout?.stop();
    this.layout = new ModuleLayout(graph, this.rng);
    this.stars = seedStars(this.rng);
    this.camera = IDENTITY_CAMERA;
    this.flight = null;
    this.settleStartMs = null;
    this.settleAnnounced = false;
    this.emitter.emit("settle-start", { reason });

    if (this.reducedMotion) {
      // Reduced motion renders the settled map, not a settling one (UX-DR11).
      // Determinism is untouched: same seed, same ticks, same result — only
      // the animation is skipped (AD-6).
      const frames = this.layout.runToSettled();
      this.announceSettled(frames, 0);
      this.setCamera(this.fitTarget());
    }
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.clientWidth;
    const height = rect.height || this.canvas.clientHeight;
    const dpr = globalThis.devicePixelRatio || 1;
    this.viewport = { width, height };
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    // Camera and picking maths stay in CSS pixels; the DPR lives here alone.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  destroy(): void {
    if (this.frameHandle !== null) {
      globalThis.cancelAnimationFrame?.(this.frameHandle);
      this.frameHandle = null;
    }
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    globalThis.removeEventListener?.("resize", this.onWindowResize);
    this.layout?.stop();
    this.emitter.clear();
  }

  // ---- graph -------------------------------------------------------------

  get nodes(): readonly EngineNode[] {
    return this.graph?.nodes ?? [];
  }

  getNode(id: string): EngineNode | null {
    const graph = this.graph;
    if (!graph) return null;
    const index = graph.indexById.get(id);
    return index === undefined ? null : (graph.nodes[index] ?? null);
  }

  chainOf(id: string): readonly string[] {
    const graph = this.graph;
    if (!graph || !graph.indexById.has(id)) return [];
    const chain = new Set<string>([id]);
    for (const neighbour of graph.neighboursById.get(id) ?? []) {
      chain.add(neighbour);
    }
    // A module also lights its members, but only once they are on screen —
    // and in 2.5 nothing is unfolded, so this is empty by construction.
    if (this.isUnfolded(id)) {
      for (const index of graph.membersByModule.get(id) ?? []) {
        chain.add(graph.nodes[index]!.id);
      }
    }
    return [...chain];
  }

  // ---- camera ------------------------------------------------------------

  getCamera(): CameraState {
    return this.camera;
  }

  setCamera(camera: Partial<CameraState>): void {
    this.camera = {
      x: camera.x ?? this.camera.x,
      y: camera.y ?? this.camera.y,
      k: camera.k ?? this.camera.k,
    };
    this.emitter.emit("camera", { camera: this.camera });
  }

  panBy(dx: number, dy: number): void {
    this.flight = null;
    this.setCamera(panBy(this.camera, dx, dy));
  }

  zoomAt(screen: ScreenPoint, factor: number): void {
    this.flight = null;
    this.setCamera(zoomAt(this.camera, this.viewport, screen, factor));
  }

  fit(options: FitOptions = {}): Promise<void> {
    const target = this.fitTarget(options.paddingPx);
    const durationMs = options.durationMs ?? FIT_DURATION_MS;
    if (this.reducedMotion || durationMs <= 0) {
      this.setCamera(target);
      return Promise.resolve();
    }
    return this.animateCameraTo(target, durationMs);
  }

  flyTo(id: string): Promise<void> {
    return notYet(`flyTo(${id})`, "3.3-viz-navigation");
  }

  private fitTarget(paddingPx: number = FIT_PADDING_PX): CameraState {
    return fitCamera(this.layout?.bounds() ?? null, this.viewport, paddingPx);
  }

  private animateCameraTo(
    target: CameraState,
    durationMs: number,
  ): Promise<void> {
    this.flight?.resolve();
    return new Promise<void>((resolve) => {
      this.flight = {
        from: this.camera,
        to: target,
        startMs: null,
        durationMs,
        resolve,
      };
    });
  }

  // ---- picking and interaction state -------------------------------------

  pick(screen: ScreenPoint): EngineNode | null {
    const layout = this.layout;
    const graph = this.graph;
    if (!layout || !graph) return null;
    const world = toWorld(screen, this.camera, this.viewport);
    let best: EngineNode | null = null;
    let bestDistance = Infinity;
    for (const item of layout.nodes) {
      const node = graph.nodes[item.graphIndex]!;
      const dx = item.x - world.x;
      const dy = item.y - world.y;
      const distance = Math.hypot(dx, dy);
      // The 7 px slop is a screen-space forgiveness margin (mockup), so it is
      // divided back into world units rather than compared against them.
      const hit = Math.max(node.radius, 3 / this.camera.k) + 7 / this.camera.k;
      if (distance <= hit && distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  }

  getHovered(): EngineNode | null {
    return this.hoveredId === null ? null : this.getNode(this.hoveredId);
  }

  setHovered(id: string | null, screen: ScreenPoint | null = null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.emitter.emit("hover", { node: this.getHovered(), screen });
    this.emitHighlight();
  }

  getSelected(): EngineNode | null {
    return this.selectedId === null ? null : this.getNode(this.selectedId);
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emitter.emit("select", { node: this.getSelected() });
  }

  getIsolated(): EngineNode | null {
    return this.isolatedId === null ? null : this.getNode(this.isolatedId);
  }

  setIsolated(id: string | null): void {
    if (this.isolatedId === id) return;
    this.isolatedId = id;
    this.emitHighlight();
  }

  private emitHighlight(): void {
    this.emitter.emit("highlight", {
      focusId: this.isolatedId ?? this.hoveredId,
      isolated: this.isolatedId !== null,
    });
  }

  getMode(): ViewMode {
    return this.mode;
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emitter.emit("mode", { mode });
  }

  // ---- semantic zoom (story 3.3) -----------------------------------------

  unfoldedModules(): readonly string[] {
    // Truthful, not a stub: 2.5 never unfolds, so nothing is unfolded.
    return [];
  }

  isUnfolded(moduleId: string): boolean {
    return this.unfoldedModules().includes(moduleId);
  }

  // ---- export (story 3.5) ------------------------------------------------

  exportPNG(): Promise<Blob> {
    return notYet("exportPNG", "3.5-viz-export-perf");
  }

  // ---- events ------------------------------------------------------------

  on<K extends GraphEngineEvent>(
    event: K,
    listener: GraphEngineListener<K>,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  off<K extends GraphEngineEvent>(
    event: K,
    listener: GraphEngineListener<K>,
  ): void {
    this.emitter.off(event, listener);
  }

  // ---- frame loop --------------------------------------------------------

  private startLoop(): void {
    if (this.frameHandle !== null) return;
    const raf = globalThis.requestAnimationFrame;
    if (!raf) return;
    const step = (timeMs: number): void => {
      this.frame(timeMs);
      this.frameHandle = raf(step);
    };
    this.frameHandle = raf(step);
  }

  /** One frame: advance the settle, advance a flight, draw. Exposed for tests. */
  frame(timeMs: number): void {
    const layout = this.layout;
    if (!layout) return;

    if (!layout.settled) {
      if (this.settleStartMs === null) this.settleStartMs = timeMs;
      layout.tick();
      if (layout.settled) {
        this.announceSettled(layout.frames, timeMs - this.settleStartMs);
        // The camera frames the graph once the map has stopped moving; the
        // 800 ms in AC-2 is this flight, and it starts here.
        void this.fit();
      }
    }

    this.advanceFlight(timeMs);
    this.draw(timeMs);
  }

  private announceSettled(frames: number, durationMs: number): void {
    if (this.settleAnnounced) return;
    this.settleAnnounced = true;
    this.emitter.emit("settled", { frames, durationMs });
  }

  private advanceFlight(timeMs: number): void {
    const flight = this.flight;
    if (!flight) return;
    if (flight.startMs === null) flight.startMs = timeMs;
    const t = (timeMs - flight.startMs) / flight.durationMs;
    this.camera = lerpCamera(flight.from, flight.to, easeOutCubic(t));
    this.emitter.emit("camera", { camera: this.camera });
    if (t >= 1) {
      this.flight = null;
      flight.resolve();
    }
  }

  private draw(timeMs: number): void {
    const graph = this.graph;
    const layout = this.layout;
    if (!graph || !layout) return;

    const positions = new Map<string, { x: number; y: number }>();
    const nodes: RenderableNode[] = layout.nodes.map((item) => {
      const node = graph.nodes[item.graphIndex]!;
      positions.set(node.id, { x: item.x, y: item.y });
      return { node, x: item.x, y: item.y };
    });

    const edges: RenderableEdge[] = [];
    for (const edge of graph.moduleEdges) {
      const source = positions.get(graph.nodes[edge.source]!.id);
      const target = positions.get(graph.nodes[edge.target]!.id);
      if (!source || !target) continue;
      edges.push({
        sourceId: graph.nodes[edge.source]!.id,
        targetId: graph.nodes[edge.target]!.id,
        sx: source.x,
        sy: source.y,
        tx: target.x,
        ty: target.y,
        member: false,
      });
    }

    const focusId = this.isolatedId ?? this.hoveredId;
    const chain = focusId === null ? null : new Set(this.chainOf(focusId));

    renderFrame(this.ctx, {
      viewport: this.viewport,
      camera: this.camera,
      stars: this.stars,
      nodes,
      edges,
      mode: this.mode,
      timeMs,
      reducedMotion: this.reducedMotion,
      chain: chain && chain.size > 0 ? chain : null,
      selectedId: this.selectedId,
      showFileLabels: this.camera.k >= FILE_LABEL_ZOOM,
    });
  }

  // ---- pointer input (FR-15) ---------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = "grabbing";
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || !this.dragOrigin) return;
    this.panBy(
      event.clientX - this.dragOrigin.x,
      event.clientY - this.dragOrigin.y,
    );
    this.dragOrigin = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragOrigin = null;
    this.canvas.style.cursor = "grab";
    this.canvas.releasePointerCapture?.(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAt(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      event.deltaY < 0 ? ZOOM_IN_STEP : ZOOM_OUT_STEP,
    );
  };

  private readonly onWindowResize = (): void => {
    this.resize();
  };
}

export function createGraphEngine(options: EngineOptions): GraphEngine {
  return new CanvasGraphEngine(options);
}
