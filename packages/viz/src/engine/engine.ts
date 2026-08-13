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
  CLICK_SLOP_PX,
  FIT_DURATION_MS,
  FIT_PADDING_PX,
  FILE_LABEL_ZOOM,
  FLY_DURATION_MS,
  FLY_ZOOM_FILE,
  FLY_ZOOM_MODULE,
  HOT_THRESHOLD,
  PULSE_DURATION_MS,
  ZOOM_IN_STEP,
  ZOOM_OUT_STEP,
} from "./constants.js";
import {
  clampZoom,
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
import { renderSceneToPng } from "./export.js";
import { buildGraph, type Graph } from "./graph.js";
import { MemberLayout, ModuleLayout, type LayoutNode } from "./layout.js";
import { hashString, mulberry32, seedFor, type Rng } from "./prng.js";
import {
  renderFrame,
  type RenderableEdge,
  type RenderableNode,
  type RenderScene,
} from "./render.js";
import { seedStars, type Star } from "./starfield.js";
import {
  unfoldTransition,
  wantedUnfolds,
  type UnfoldCandidate,
} from "./unfold.js";
import type {
  CameraState,
  EngineOptions,
  EngineNode,
  ExportPngOptions,
  FitOptions,
  FlyToOptions,
  GraphEngine,
  GraphEngineEvent,
  GraphEngineListener,
  ScreenPoint,
  ViewMode,
} from "./types.js";
import type { AnalysisDocument } from "@gitnebula/contract";

// `notYet()` lived here from story 2.5: members the interface declared before
// anyone implemented them rejected with the name of the story that owed them,
// so a caller could never mistake a stub for a working call. Stories 3.3
// (`flyTo`) and 3.5 (`exportPNG`) were the last two debts, so the helper has
// no callers left and is gone rather than kept warm for a hypothetical.

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
  /**
   * Resolved with `true` on arrival and `false` when the flight was cancelled.
   * A cancelled flight must not run its caller's arrival effects — panning
   * during a search flight would otherwise still select the node the user
   * just steered away from.
   */
  readonly resolve: (arrived: boolean) => void;
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

  /**
   * One local wake per unfolded module (story 3.3, ADR-0006). Insertion order
   * is the unfold order, but nothing depends on it: each wake is seeded from
   * its own module id, so a module's cloud is the same however it got here.
   */
  private readonly memberLayouts = new Map<string, MemberLayout>();
  /** Search-arrival pulse: the node, and the frame clock when it started. */
  private pulseId: string | null = null;
  private pulseStartMs: number | null = null;
  /**
   * Set once the user has aimed the camera themselves (a pan, a zoom, or a
   * search fly-to). The settle-completion fit is suppressed afterwards: the
   * map takes 2–3 s to settle and the search box works from the first frame,
   * so a fly-to started during the settle would otherwise be cancelled by the
   * automatic fit the moment the layout finished — the search appeared to do
   * nothing at all. Cleared on load and replay, which re-frame deliberately.
   */
  private cameraTakenByUser = false;

  private frameHandle: number | null = null;
  private settleStartMs: number | null = null;
  private settleAnnounced = false;
  /** Clock of the last drawn frame — the export re-renders at that instant. */
  private lastFrameMs = 0;

  private dragging = false;
  private dragOrigin: ScreenPoint | null = null;
  /** True once a press has travelled far enough to be a drag (story 3.4). */
  private dragMoved = false;
  /** Where the press started, kept apart from the per-move pan origin. */
  private pressOrigin: ScreenPoint | null = null;

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
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    globalThis.addEventListener?.("resize", this.onWindowResize);

    this.resize();
  }

  // ---- lifecycle ---------------------------------------------------------

  load(document: AnalysisDocument, seed?: number): void {
    this.seed = seed ?? seedFor(document.repo.name);
    this.graph = buildGraph(document, this.hotThreshold);
    // Through the setters, not by assigning the fields: the interface says
    // these publish `select` and `highlight`, so clearing them silently makes
    // `load()` untruthful about its own state. Chrome mirrors both into its
    // store, so a second load would otherwise leave a panel open on a node the
    // new document need not contain. Each setter no-ops when unchanged, so a
    // first load still emits nothing.
    this.setSelected(null);
    this.setHovered(null, null);
    this.setIsolated(null);
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
    this.cancelFlight();
    this.clearUnfolds();
    this.clearPulse();
    this.cameraTakenByUser = false;
    this.layout?.stop();
    this.layout = new ModuleLayout(graph, this.rng);
    this.stars = seedStars(this.rng);
    this.camera = IDENTITY_CAMERA;
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
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    globalThis.removeEventListener?.("resize", this.onWindowResize);
    this.cancelFlight();
    this.clearUnfolds();
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
      // Clamped here too, not only on the wheel path: FR-15's range is an
      // invariant of the camera, and a `k` of 0 or Infinity from a caller
      // would divide through picking and panning.
      k: clampZoom(camera.k ?? this.camera.k),
    };
    // Semantic zoom is a consequence of the camera, so it is recomputed here
    // rather than in each of pan/zoom/fit/fly — every one of those routes
    // through `setCamera`, and a route that forgot to ask would be a module
    // that silently stayed collapsed.
    this.updateUnfolds();
    this.emitter.emit("camera", { camera: this.camera });
  }

  panBy(dx: number, dy: number): void {
    this.cameraTakenByUser = true;
    this.cancelFlight();
    this.setCamera(panBy(this.camera, dx, dy));
  }

  zoomAt(screen: ScreenPoint, factor: number): void {
    this.cameraTakenByUser = true;
    this.cancelFlight();
    this.setCamera(zoomAt(this.camera, this.viewport, screen, factor));
  }

  /**
   * Drop the running flight, resolving its promise. A caller taking the
   * camera by hand cancels the flight, but a `fit()` whose promise never
   * settles would hang whatever awaited it.
   */
  private cancelFlight(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    flight.resolve(false);
  }

  fit(options: FitOptions = {}): Promise<void> {
    const target = this.fitTarget(options.paddingPx);
    const durationMs = options.durationMs ?? FIT_DURATION_MS;
    if (this.reducedMotion || durationMs <= 0) {
      this.setCamera(target);
      return Promise.resolve();
    }
    // `fit` has no arrival effects, so it does not care which way it ended.
    return this.animateCameraTo(target, durationMs).then(() => undefined);
  }

  /**
   * Fly the camera to a node and select it (FR-18).
   *
   * Selection is set on *arrival*, not on departure: the `select` event opens
   * story 3.4's panel, and a panel that opened at the start of a 620 ms flight
   * would describe a node the user cannot see yet.
   */
  async flyTo(id: string, options: FlyToOptions = {}): Promise<void> {
    const node = this.getNode(id);
    if (!node) return;
    this.cameraTakenByUser = true;

    // The search box works from the first frame, but the layout keeps moving
    // for 2–3 s. Aiming at a node that is still drifting means arriving where
    // it *was*: the target is captured once, and 620 ms later the node has
    // moved on. So a navigation during the settle finishes the settle first —
    // the user asked to go somewhere, and a stable destination is worth more
    // than the remainder of an animation they interrupted. It also gives a
    // file's local wake a final parent position to settle around instead of a
    // transient one.
    this.finishSettle();

    // A file inside a collapsed module has no position of its own yet, so the
    // module is unfolded first and the wake run to Settled — the target must
    // exist before we can aim at it (AC-3).
    if (node.kind === "file" && node.parent !== null) {
      this.ensureUnfolded(node.parent);
    }

    const zoom =
      options.zoom ??
      (node.kind === "module" ? FLY_ZOOM_MODULE : FLY_ZOOM_FILE);
    const position = this.positionOf(id);
    const target: CameraState = {
      x: position?.x ?? this.camera.x,
      y: position?.y ?? this.camera.y,
      k: clampZoom(zoom),
    };

    const durationMs = options.durationMs ?? FLY_DURATION_MS;
    if (this.reducedMotion || durationMs <= 0) {
      // Reduced motion jumps; there is no arrival to pulse (UX-DR11).
      this.setCamera(target);
      this.setSelected(id);
      return;
    }

    const arrived = await this.animateCameraTo(target, durationMs);
    // Cancelled — the user panned, zoomed, searched again, or reloaded while
    // this flight was in the air. Selecting now would open a panel on a node
    // they steered away from.
    if (!arrived) return;
    this.startPulse(id);
    this.setSelected(id);
  }

  /**
   * Run the module layout to Settled immediately, as if the animation had
   * finished. Used when the user navigates during the settle; the reduced-motion
   * path does the same thing for the same reason, and reports a zero duration
   * because nothing was animated.
   */
  private finishSettle(): void {
    const layout = this.layout;
    if (!layout || layout.settled) return;
    const frames = layout.runToSettled();
    this.announceSettled(frames, 0);
    this.updateUnfolds();
  }

  /**
   * Unfold a module now, outside the viewport rule — the one deliberate
   * exception, for a fly-to whose target is a file (AC-3). The wake is run to
   * Settled synchronously so the file has a real position to aim at within
   * this call rather than several frames later.
   */
  private ensureUnfolded(moduleId: string): void {
    if (this.memberLayouts.has(moduleId)) return;
    const anchor = this.layout?.nodes.find((node) => node.id === moduleId);
    if (!anchor) return;
    const wake = this.createMemberLayout(moduleId, anchor);
    if (!wake) return;
    wake.runToSettled();
    this.memberLayouts.set(moduleId, wake);
    this.emitter.emit("unfold", { moduleIds: [moduleId] });
  }

  /** World position of any node the engine currently has one for. */
  private positionOf(id: string): { x: number; y: number } | null {
    const module = this.layout?.nodes.find((node) => node.id === id);
    if (module) return { x: module.x, y: module.y };
    for (const wake of this.memberLayouts.values()) {
      const member = wake.nodes.find((node) => node.id === id);
      if (member) return { x: member.x, y: member.y };
    }
    return null;
  }

  private startPulse(id: string): void {
    if (this.reducedMotion) return;
    this.pulseId = id;
    // Started by the frame loop, like a flight: a pulse timed off a second
    // clock drifts from the frames that draw it.
    this.pulseStartMs = null;
  }

  private clearPulse(): void {
    this.pulseId = null;
    this.pulseStartMs = null;
  }

  private fitTarget(paddingPx: number = FIT_PADDING_PX): CameraState {
    return fitCamera(this.layout?.bounds() ?? null, this.viewport, paddingPx);
  }

  private animateCameraTo(
    target: CameraState,
    durationMs: number,
  ): Promise<boolean> {
    this.cancelFlight();
    return new Promise<boolean>((resolve) => {
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
    // Members first, then modules: an unfolded file sits on top of its module,
    // and the nearest-centre tie-break below would otherwise hand every pick
    // inside a module's disc to the module — making an unfolded file
    // unhoverable and unclickable, which is exactly what AC-2 needs.
    for (const item of [...this.memberNodes(), ...layout.nodes]) {
      const node = graph.nodes[item.graphIndex]!;
      const dx = item.x - world.x;
      const dy = item.y - world.y;
      const distance = Math.hypot(dx, dy);
      // The 7 px slop is a screen-space forgiveness margin (mockup), so it is
      // divided back into world units rather than compared against them.
      const hit = Math.max(node.radius, 3 / this.camera.k) + 7 / this.camera.k;
      if (distance > hit) continue;
      // A file beats a module it overlaps, whatever the centre distance. An
      // unfolded file sits inside its module's disc and is drawn on top of it,
      // so nearest-centre alone would hand every pick to the module and make
      // members unhoverable — the file is what the user is pointing at.
      const beatsBest =
        best === null ||
        (node.kind === "file" && best.kind === "module") ||
        (node.kind === best.kind && distance < bestDistance);
      if (beatsBest) {
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

  // ---- semantic zoom (story 3.3, ADR-0006) -------------------------------

  unfoldedModules(): readonly string[] {
    return [...this.memberLayouts.keys()];
  }

  isUnfolded(moduleId: string): boolean {
    return this.memberLayouts.has(moduleId);
  }

  /**
   * Bring the unfolded set in line with the camera. Called on every camera
   * change, which is what makes unfold a *pan*-triggered event and not only a
   * zoom-triggered one (ADR-0006: "panning a collapsed module into view at
   * ≥ 1.8× unfolds it").
   *
   * Cheap enough to run per camera change: it is one AABB test per module,
   * against the module count (~100 at the DoD scale), not per file.
   */
  private updateUnfolds(): void {
    const layout = this.layout;
    const graph = this.graph;
    // Nothing unfolds while the global layout is still moving: members spawn
    // at their module's position, and a position that is still travelling
    // would fling the cloud across the map behind it.
    if (!layout || !graph || !layout.settled) return;

    const candidates: UnfoldCandidate[] = layout.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      radius: node.radius,
    }));
    const wanted = wantedUnfolds(candidates, this.camera, this.viewport);
    const transition = unfoldTransition(
      new Set(this.memberLayouts.keys()),
      wanted,
    );
    if (!transition.changed) return;

    for (const moduleId of transition.left) {
      this.memberLayouts.get(moduleId)?.stop();
      this.memberLayouts.delete(moduleId);
    }

    const anchors = new Map(layout.nodes.map((node) => [node.id, node]));
    const entered: string[] = [];
    for (const moduleId of transition.entered) {
      const anchor = anchors.get(moduleId);
      if (!anchor) continue;
      const wake = this.createMemberLayout(moduleId, anchor);
      if (!wake) continue;
      this.memberLayouts.set(moduleId, wake);
      entered.push(moduleId);
    }

    // Emitted after the whole diff is applied, so a listener that reads
    // `unfoldedModules()` sees the finished state rather than a half-applied
    // one.
    if (transition.left.length > 0) {
      this.emitter.emit("collapse", { moduleIds: transition.left });
    }
    if (entered.length > 0) {
      this.emitter.emit("unfold", { moduleIds: entered });
    }
  }

  /**
   * Build one module's wake.
   *
   * The stream is seeded from the module id combined with the document seed —
   * **not** drawn from the shared settle stream. Unfolds happen in whatever
   * order the user pans, so consuming the shared stream would make a module's
   * cloud depend on which modules were visited first, and AD-6's promise that
   * determinism holds through unfold would quietly become false.
   */
  private createMemberLayout(
    moduleId: string,
    anchor: LayoutNode,
  ): MemberLayout | null {
    const graph = this.graph;
    if (!graph) return null;
    const memberIndices = graph.membersByModule.get(moduleId) ?? [];
    if (memberIndices.length === 0) return null;

    const members = memberIndices.map((graphIndex) => {
      const node = graph.nodes[graphIndex]!;
      return { graphIndex, id: node.id, radius: node.radius };
    });
    const memberIds = new Set(members.map((member) => member.id));

    const links: { source: string; target: string }[] = [];
    for (const edge of graph.fileEdges) {
      const source = graph.nodes[edge.source]!.id;
      const target = graph.nodes[edge.target]!.id;
      if (memberIds.has(source) && memberIds.has(target)) {
        links.push({ source, target });
      }
    }

    const rng = mulberry32((hashString(moduleId) ^ this.seed) >>> 0);
    const wake = new MemberLayout(anchor, members, links, rng);
    // Reduced motion gets the settled cloud, not a settling one (UX-DR11) —
    // the same rule the initial load already follows.
    if (this.reducedMotion) wake.runToSettled();
    return wake;
  }

  private clearUnfolds(): void {
    for (const wake of this.memberLayouts.values()) wake.stop();
    this.memberLayouts.clear();
  }

  /** Every member node currently on screen, across all unfolded modules. */
  private memberNodes(): LayoutNode[] {
    const nodes: LayoutNode[] = [];
    for (const wake of this.memberLayouts.values()) nodes.push(...wake.nodes);
    return nodes;
  }

  // ---- export (story 3.5) ------------------------------------------------

  /**
   * Re-render the frame the user is looking at into an offscreen surface at
   * `scale`× density (AD-5 — never a scaled canvas snapshot).
   *
   * The clock is the **last drawn frame's**, not a fresh reading: the hot-spot
   * pulse is a function of time, so exporting at "now" would catch the pulse
   * at a different phase than the pixels on screen and the two would legibly
   * disagree. Reusing the frame clock is what makes AC-1's parity check able
   * to compare pixel for pixel.
   */
  exportPNG(options: ExportPngOptions = {}): Promise<Blob> {
    const scene = this.buildScene(this.lastFrameMs);
    if (!scene) {
      return Promise.reject(
        new Error(
          "viz: nothing to export — load an analysis document before exporting",
        ),
      );
    }
    return renderSceneToPng(scene, { scale: options.scale });
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
        // 800 ms in AC-2 is this flight, and it starts here. Skipped if the
        // user already aimed the camera during the settle — framing the graph
        // would cancel their fly-to.
        if (!this.cameraTakenByUser) void this.fit();
      }
    }

    // Local wakes tick independently of the global layout, which stays frozen
    // (story 1.4's freeze-on-settle). Each stops on its own Settled, so an
    // unfolded module costs nothing once its cloud has resolved.
    for (const wake of this.memberLayouts.values()) {
      if (!wake.settled) wake.tick();
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
    // A flight moves the camera without going through `setCamera` — it must
    // not, because `setCamera` cancels the flight it is animating. But the
    // unfold set is a function of the camera, so it has to be recomputed here
    // too, or a fly-to lands zoomed in with only its own module unfolded and
    // every other module in view still collapsed until the user nudges the
    // map. (Caught in the browser; the unit tests flew with duration 0, which
    // does route through `setCamera` and hid it.)
    this.updateUnfolds();
    this.emitter.emit("camera", { camera: this.camera });
    if (t >= 1) {
      this.flight = null;
      flight.resolve(true);
    }
  }

  /**
   * Assemble the scene for one frame.
   *
   * Extracted from `draw()` so the live frame and story 3.5's PNG export
   * render the *same* scene through the same path — AD-5 bans exporting a
   * scaled canvas snapshot, which means export must re-render, which means
   * there has to be one place the scene is built. Agreed with 3.5's owner as
   * the shared seam; the export delegates here rather than rebuilding it.
   *
   * Public on the class, not on `GraphEngine` — so the export and the tests
   * can reach it while chrome, which only ever holds the interface, cannot.
   */
  buildScene(timeMs: number): RenderScene | null {
    const graph = this.graph;
    const layout = this.layout;
    if (!graph || !layout) return null;

    const positions = new Map<string, { x: number; y: number }>();
    const nodes: RenderableNode[] = layout.nodes.map((item) => {
      const node = graph.nodes[item.graphIndex]!;
      positions.set(node.id, { x: item.x, y: item.y });
      return { node, x: item.x, y: item.y };
    });

    const edges: RenderableEdge[] = [];

    // Unfolded members and the edges tying them to their module (ADR-0006).
    for (const [moduleId, wake] of this.memberLayouts) {
      const anchor = positions.get(moduleId);
      for (const item of wake.nodes) {
        const node = graph.nodes[item.graphIndex]!;
        positions.set(node.id, { x: item.x, y: item.y });
        nodes.push({ node, x: item.x, y: item.y });
        if (!anchor) continue;
        edges.push({
          sourceId: moduleId,
          targetId: node.id,
          sx: anchor.x,
          sy: anchor.y,
          tx: item.x,
          ty: item.y,
          member: true,
        });
      }
    }

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

    // File-level import edges, drawn only where both ends are unfolded — a
    // half-visible edge would point at a file that is not on screen.
    for (const edge of graph.fileEdges) {
      const sourceId = graph.nodes[edge.source]!.id;
      const targetId = graph.nodes[edge.target]!.id;
      const source = positions.get(sourceId);
      const target = positions.get(targetId);
      if (!source || !target) continue;
      edges.push({
        sourceId,
        targetId,
        sx: source.x,
        sy: source.y,
        tx: target.x,
        ty: target.y,
        member: false,
      });
    }

    const focusId = this.isolatedId ?? this.hoveredId;
    const chain = focusId === null ? null : new Set(this.chainOf(focusId));

    return {
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
      pulse: this.pulseProgress(timeMs),
    };
  }

  /** The arrival pulse as `{ id, t }` with `t` running 0 → 1, or null. */
  private pulseProgress(timeMs: number): { id: string; t: number } | null {
    if (this.pulseId === null) return null;
    if (this.pulseStartMs === null) this.pulseStartMs = timeMs;
    const t = (timeMs - this.pulseStartMs) / PULSE_DURATION_MS;
    if (t >= 1) {
      this.clearPulse();
      return null;
    }
    return { id: this.pulseId, t: Math.max(0, t) };
  }

  private draw(timeMs: number): void {
    const scene = this.buildScene(timeMs);
    if (!scene) return;
    // Story 3.5: the export re-renders at the clock of the frame the user is
    // looking at, so the hot-spot pulse and the search-arrival pulse come out
    // at the phase they were on screen rather than at a fresh instant.
    this.lastFrameMs = timeMs;
    renderFrame(this.ctx, scene);
  }

  // ---- pointer input (FR-15) ---------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.dragMoved = false;
    this.pressOrigin = { x: event.clientX, y: event.clientY };
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = "grabbing";
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragging && this.dragOrigin) {
      // Story 3.4's AC-4 lives in this branch: a press only becomes a drag
      // once it has travelled, and a press that never became one selects.
      if (
        this.pressOrigin &&
        Math.hypot(
          event.clientX - this.pressOrigin.x,
          event.clientY - this.pressOrigin.y,
        ) > CLICK_SLOP_PX
      ) {
        this.dragMoved = true;
      }
      this.panBy(
        event.clientX - this.dragOrigin.x,
        event.clientY - this.dragOrigin.y,
      );
      this.dragOrigin = { x: event.clientX, y: event.clientY };
      return;
    }

    // Hover (FR-17). Deliberately not evaluated while dragging: a pan would
    // otherwise light up and dim every node it swept past.
    const screen = this.toCanvasPoint(event);
    const node = this.pick(screen);
    this.setHovered(node?.id ?? null, screen);
    // The tooltip follows the cursor, so a move *within* the same node still
    // has to reach chrome — `setHovered` returns early on an unchanged id,
    // which is right for the highlight and wrong for the pointer position.
    if (node && this.hoveredId === node.id) {
      this.emitter.emit("hover", { node, screen });
    }
    this.canvas.style.cursor = node ? "pointer" : "grab";
  };

  private readonly onPointerLeave = (): void => {
    // Leaving the canvas restores full opacity (AC-2) and takes the tooltip
    // with it; a highlight left behind by a pointer that is gone reads as a
    // stuck selection.
    this.setHovered(null, null);
  };

  /** Pointer position relative to the canvas, in CSS pixels. */
  private toCanvasPoint(event: PointerEvent): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Story 3.4's AC-4: a press that did not travel selects what is under it —
   * a node, or nothing at all, which is how the panel closes. The mockup sets
   * its `moved` flag on any pointermove at all, so a hand tremor eats the
   * click; the slop threshold is the fix, and pan behaviour is untouched
   * either way.
   *
   * Only a released primary button selects. A `pointercancel` (the browser
   * taking the gesture away — a touch turning into a system scroll, a stylus
   * leaving range) is a cleanup, not a click, and its coordinates are wherever
   * the gesture was abandoned; a right-click is a press this map has no
   * meaning for.
   */
  private readonly onPointerUp = (event: PointerEvent): void => {
    const moved = this.endPress(event);
    if (moved || event.button !== 0 || event.isPrimary === false) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.pick({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    this.setSelected(hit?.id ?? null);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.endPress(event);
  };

  /** Drop the press state. Returns whether it had become a drag. */
  private endPress(event: PointerEvent): boolean {
    if (!this.dragging) return true;
    const moved = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    this.dragOrigin = null;
    this.pressOrigin = null;
    this.canvas.style.cursor = "grab";
    this.canvas.releasePointerCapture?.(event.pointerId);
    return moved;
  }

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
