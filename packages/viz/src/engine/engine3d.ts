/**
 * `Nebula3DEngine` — the **second** implementation of the AD-5 seam (FR-32).
 *
 * The point of this file is not the third dimension; it is that the third
 * dimension fits behind an interface that was declared before anyone tried to
 * put anything else behind it. Chrome reaches this engine through exactly the
 * same `GraphEngine` members and the same events as the 2D one, and
 * `chrome/boundary.test.ts` passes unchanged.
 *
 * Three decisions carry the design; all three are in `DECISIONS.md`.
 *
 * **D1 — no simulation library.** `layout3d.ts` is hand-rolled, because the
 * boundary test pins `d3-force` importers to exactly `["layout.ts"]`.
 *
 * **D2 — the orbit camera is derived from `CameraState`, not added to it.**
 * `k` drives orbit distance, `x`/`y` pan the orbit target, and yaw/pitch are
 * engine-internal interaction state — the same kind of thing as hover. That
 * keeps the interface unchanged, which is the whole claim AD-5 makes.
 * `getOrientation()` is a class member and deliberately **not** on the
 * interface: tests and the harness reach it, chrome cannot.
 *
 * **D3 — top-level nodes are simulated; members wake locally on unfold**, as
 * in 2D (ADR-0006). 3D showing every file at once would be a different map,
 * not the same map from another angle.
 *
 * Determinism (AD-6, AC-2): the layout **and the initial camera orientation**
 * are seeded from the document. There is no unseeded randomness and no clock
 * reading anywhere in this file.
 */

import {
  CLICK_SLOP_PX,
  FILE_LABEL_ZOOM,
  FIT_DURATION_MS,
  FIT_PADDING_PX,
  FLY_DURATION_MS,
  FLY_ZOOM_FILE,
  FLY_ZOOM_MODULE,
  HOT_THRESHOLD,
  HOVER_CARRY_MS,
  UNFOLD_ZOOM,
  ZOOM_IN_STEP,
  ZOOM_OUT_STEP,
} from "./constants.js";
import {
  clampZoom,
  easeOutCubic,
  IDENTITY_CAMERA,
  lerpCamera,
  type Viewport,
} from "./camera.js";
import { Emitter } from "./emitter.js";
import {
  createExportSurface,
  DEFAULT_EXPORT_SCALE,
  MIN_EXPORT_SCALE,
  type ExportSurfaceFactory,
} from "./export.js";
import { buildGraph, type Graph } from "./graph.js";
import { ALL_LAYERS } from "./layers.js";
import {
  bounds3D,
  MemberLayout3D,
  ModuleLayout3D,
  type LayoutNode3D,
} from "./layout3d.js";
import { hashString, mulberry32, seedFor, type Rng } from "./prng.js";
import {
  BASE_DISTANCE,
  clampPitch,
  orbitDistance,
  type Orientation,
} from "./project3d.js";
import {
  placeNodes,
  renderFrame3D,
  type Renderable3DEdge,
  type Renderable3DNode,
  type Scene3D,
} from "./render3d.js";
import { inScopeIds, visibleNodeIds } from "./scope.js";
import type {
  CameraState,
  EngineNode,
  EngineOptions,
  ExportPngOptions,
  FitOptions,
  FlyToOptions,
  GraphEngine,
  GraphEngineEvent,
  GraphEngineListener,
  ScreenPoint,
  ViewMode,
} from "./types.js";
import type { AnalysisDocument, Layer } from "@gitnebula/contract";

/** Default fog strength — the prototype's slider position, which read best. */
export const DEFAULT_FOG_STRENGTH = 0.6;

/** Radians of yaw per second of idle auto-rotation. Zero under reduced motion. */
export const AUTO_ROTATE_RAD_PER_MS = 0.0016 / 16.67;

/** Radians of rotation per CSS pixel dragged. */
export const DRAG_YAW_PER_PX = 0.005;
export const DRAG_PITCH_PER_PX = 0.005;

/**
 * How far the camera sits from the cloud when framing it.
 *
 * `fit` in 3D cannot be the 2D `fitCamera`: that solves for a zoom that makes a
 * planar bounding box fit the viewport, and here the box has depth, so the
 * near face projects larger than the far one. The radius of the bounding
 * sphere is used instead, with the same padding contract.
 */
export const FIT_SPHERE_MARGIN = 1.15;

interface CameraFlight {
  readonly from: CameraState;
  readonly to: CameraState;
  startMs: number | null;
  readonly durationMs: number;
  readonly pins: readonly string[];
  readonly resolve: (arrived: boolean) => void;
}

export interface Engine3DOptions extends EngineOptions {
  /** Depth-fog strength, 0–1. Defaults to `DEFAULT_FOG_STRENGTH`. */
  readonly fogStrength?: number;
  /** Injection point for the export surface; the browser path is the default. */
  readonly createExportSurface?: ExportSurfaceFactory;
}

export class Nebula3DEngine implements GraphEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly emitter = new Emitter();
  private readonly hotThreshold: number;
  private readonly reducedMotion: boolean;
  private readonly fogStrength: number;
  private readonly makeExportSurface: ExportSurfaceFactory;

  private graph: Graph | null = null;
  private layout: ModuleLayout3D | null = null;
  private rng: Rng = mulberry32(0);
  private seed = 0;

  private viewport: Viewport = { width: 0, height: 0 };
  private camera: CameraState = IDENTITY_CAMERA;
  private orientation: Orientation = { yaw: 0, pitch: 0 };
  /** The orientation `load()` seeded, so `replay()` can return to it exactly. */
  private initialOrientation: Orientation = { yaw: 0, pitch: 0 };
  private flight: CameraFlight | null = null;

  private mode: ViewMode = "structure";
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private isolatedId: string | null = null;
  private carriedHoverId: string | null = null;
  private carryStartMs: number | null = null;
  private blastRadiusIds: readonly string[] = [];

  private readonly memberLayouts = new Map<string, MemberLayout3D>();
  private readonly pinnedUnfolds = new Set<string>();

  private scopeId: string | null = null;
  private scopePin: string | null = null;
  private connectedOnly = false;
  private lastScopeId: string | null = null;
  private visibleCache: ReadonlySet<string> | null = null;
  private visibleCacheKey: string | null = null;
  private hiddenByScope = 0;
  private hiddenByDegree = 0;
  private visibleLayers: ReadonlySet<Layer> = new Set(ALL_LAYERS);

  private frameHandle: number | null = null;
  private settleStartMs: number | null = null;
  private settleAnnounced = false;
  private lastFrameMs = 0;
  /**
   * Whether idle auto-rotation is running. Off under reduced motion (AC-6) and
   * switched off for the session the moment the user rotates by hand — a
   * camera that drifts back into motion after being aimed is a camera fighting
   * its user.
   */
  private autoRotate: boolean;
  private cameraTakenByUser = false;

  private dragging = false;
  private dragOrigin: ScreenPoint | null = null;
  private dragMoved = false;
  private pressOrigin: ScreenPoint | null = null;
  private pressPointerId: number | null = null;
  /** Shift-drag pans the orbit target; a plain drag rotates it. */
  private dragPans = false;

  constructor(options: Engine3DOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      // The same failure the 2D engine reports, and the message `view.ts`
      // turns into the AC-5 fallback reason.
      throw new Error("viz: canvas 2D context unavailable");
    }
    this.ctx = ctx;
    this.hotThreshold = options.hotThreshold ?? HOT_THRESHOLD;
    this.reducedMotion =
      options.reducedMotion ??
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false;
    this.fogStrength = options.fogStrength ?? DEFAULT_FOG_STRENGTH;
    this.makeExportSurface = options.createExportSurface ?? createExportSurface;
    // AC-6: no auto-rotation under `prefers-reduced-motion`, decided once at
    // construction rather than tested per frame.
    this.autoRotate = !this.reducedMotion;

    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    globalThis.addEventListener?.("resize", this.onWindowResize);
    globalThis.addEventListener?.("keydown", this.onKeyDown);
    this.emitter.on("filter", this.onLayerFilterChanged);

    this.resize();
  }

  // ---- lifecycle ---------------------------------------------------------

  load(document: AnalysisDocument, seed?: number): void {
    this.seed = seed ?? seedFor(document.repo.name);
    this.graph = buildGraph(document, this.hotThreshold);
    this.invalidateVisible();
    this.setSelected(null);
    this.setHovered(null, null);
    this.setIsolated(null);
    this.scopeId = null;
    this.lastScopeId = null;
    this.invalidateVisible();
    this.emitScope(null);
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
    // reproduce the load layout exactly rather than continue the stream (AD-6).
    this.rng = mulberry32(this.seed);
    this.cancelFlight();
    this.clearUnfolds();
    this.cameraTakenByUser = false;
    this.autoRotate = !this.reducedMotion;
    this.layout = new ModuleLayout3D(graph, this.rng);
    this.scopePin = this.scopeId;
    // AC-2's second half: the initial orientation is seeded from the document
    // too, not left at a fixed pose and not taken from a clock. Drawn from the
    // same stream as the layout, *after* it, so adding this did not move a
    // single node — the layout consumed its numbers first.
    this.initialOrientation = seedOrientation(this.seed);
    this.orientation = this.initialOrientation;
    this.camera = { x: 0, y: 0, k: 1 };
    this.settleStartMs = null;
    this.settleAnnounced = false;
    this.emitter.emit("settle-start", { reason });

    if (this.reducedMotion) {
      // Reduced motion renders the settled map, not a settling one, and there
      // is no entry animation to play (AC-6, UX-DR15). Determinism is
      // untouched: same seed, same ticks, same result.
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
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    globalThis.removeEventListener?.("resize", this.onWindowResize);
    globalThis.removeEventListener?.("keydown", this.onKeyDown);
    this.cancelFlight();
    this.clearUnfolds();
    this.emitter.clear();
  }

  // ---- 3D-only, deliberately off the interface (D2) -----------------------

  /**
   * Where the camera is looking from.
   *
   * A class member, not a `GraphEngine` one: `CameraState` cannot carry yaw and
   * pitch, and widening the interface to hold them would make every 2D consumer
   * grow a field that means nothing to it. Tests and the perf harness read this;
   * chrome, which only ever holds the interface, cannot.
   */
  getOrientation(): Orientation {
    return this.orientation;
  }

  setOrientation(orientation: Partial<Orientation>): void {
    this.orientation = {
      yaw: orientation.yaw ?? this.orientation.yaw,
      pitch: clampPitch(orientation.pitch ?? this.orientation.pitch),
    };
  }

  /** Whether idle auto-rotation is running (AC-6 asserts this is false). */
  isAutoRotating(): boolean {
    return this.autoRotate;
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
      k: clampZoom(camera.k ?? this.camera.k),
    };
    this.updateUnfolds();
    this.emitter.emit("camera", { camera: this.camera });
  }

  /**
   * Pan by a screen-space delta.
   *
   * The delta is divided by the projected scale at the orbit centre rather than
   * by `k`: in perspective, a screen pixel is worth more world units the
   * farther the camera is, so dividing by zoom alone would make panning drift
   * faster than the cursor at distance.
   */
  panBy(dx: number, dy: number): void {
    this.cameraTakenByUser = true;
    this.cancelFlight();
    const perPixel = orbitDistance(this.camera.k) / BASE_DISTANCE;
    this.setCamera({
      x: this.camera.x - dx * perPixel,
      y: this.camera.y - dy * perPixel,
    });
  }

  /**
   * Zoom about a screen point.
   *
   * In an orbit camera "keep the world point under the cursor" is not
   * achievable without also moving the orbit target off the thing being
   * examined, which turns every wheel tick into a slow drift away from it.
   * So the zoom is about the orbit centre and the screen point is used only
   * for its direction: the target eases toward what the cursor is over, which
   * is the behaviour the 2D view's anchor produces without the drift.
   */
  zoomAt(screen: ScreenPoint, factor: number): void {
    this.cameraTakenByUser = true;
    this.cancelFlight();
    this.setCamera({ k: clampZoom(this.camera.k * factor) });
    void screen;
  }

  private cancelFlight(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    this.releasePins(flight.pins);
    flight.resolve(false);
  }

  private releasePins(pins: readonly string[]): void {
    if (pins.length === 0) return;
    let changed = false;
    for (const moduleId of pins) {
      if (this.pinnedUnfolds.delete(moduleId)) changed = true;
    }
    if (changed) this.updateUnfolds();
  }

  fit(options: FitOptions = {}): Promise<void> {
    const target = this.fitTarget(options.paddingPx);
    const durationMs = options.durationMs ?? FIT_DURATION_MS;
    if (this.reducedMotion || durationMs <= 0) {
      this.setCamera(target);
      return Promise.resolve();
    }
    return this.animateCameraTo(target, durationMs).then(() => undefined);
  }

  /**
   * The camera that frames the whole cloud.
   *
   * Solved on the bounding **sphere** rather than the bounding box: the box has
   * depth, so its near face projects larger than its far one and a planar fit
   * would clip whatever happened to be closest to the camera.
   */
  private fitTarget(paddingPx: number = FIT_PADDING_PX): CameraState {
    const bounds = this.layout ? bounds3D(this.layout.nodes) : null;
    if (!bounds) return IDENTITY_CAMERA;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const radius =
      Math.max(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
        bounds.maxZ - bounds.minZ,
      ) / 2;
    const available = Math.max(
      1,
      Math.min(this.viewport.width, this.viewport.height) - paddingPx * 2,
    );
    // The distance at which a sphere of `radius` subtends `available` px, then
    // inverted through `orbitDistance` back into the `k` the seam speaks in.
    const wanted = Math.max(
      1,
      ((radius * FIT_SPHERE_MARGIN) / Math.max(1, available)) *
        2 *
        BASE_DISTANCE,
    );
    return { x: cx, y: cy, k: clampZoom(BASE_DISTANCE / wanted) };
  }

  async flyTo(id: string, options: FlyToOptions = {}): Promise<void> {
    const node = this.getNode(id);
    if (!node) return;

    const graphForScope = this.graph;
    if (
      this.scopeId !== null &&
      graphForScope &&
      !inScopeIds(graphForScope, this.scopeId).has(id)
    ) {
      const abandoned = this.scopeId;
      this.lastScopeId = abandoned;
      this.scopeId = null;
      this.scopePin = null;
      this.updateUnfolds();
      this.invalidateVisible();
      this.emitScope(id);
    }

    const hiddenByConnectedOnly =
      this.connectedOnly &&
      graphForScope !== null &&
      !visibleNodeIds(graphForScope, {
        scopeId: this.scopeId,
        connectedOnly: true,
      }).visible.has(id);
    if (hiddenByConnectedOnly) {
      this.connectedOnly = false;
      this.invalidateVisible();
      this.emitScope(id);
    }

    this.cameraTakenByUser = true;
    this.cancelFlight();
    this.finishSettle();

    const pins: string[] = [];
    if (node.kind === "file" && node.parent !== null) {
      this.ensureUnfolded(node.parent);
      pins.push(node.parent);
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
      this.setCamera(target);
      this.releasePins(pins);
      this.setSelected(id);
      return;
    }

    const arrived = await this.animateCameraTo(target, durationMs, pins);
    if (!arrived) return;
    this.setSelected(id);
  }

  private finishSettle(): void {
    const layout = this.layout;
    if (!layout || layout.settled) return;
    const frames = layout.runToSettled();
    this.announceSettled(frames, 0);
    this.updateUnfolds();
  }

  private ensureUnfolded(moduleId: string): void {
    this.pinnedUnfolds.add(moduleId);
    this.materialiseUnfold(moduleId);
  }

  private materialiseUnfold(moduleId: string): void {
    if (this.memberLayouts.has(moduleId)) return;
    const graph = this.graph;
    const anchor = this.layout?.nodes.find((node) => node.id === moduleId);
    if (!graph || !anchor) return;
    const memberIndices = graph.membersByModule.get(moduleId) ?? [];
    if (memberIndices.length === 0) return;
    const members = memberIndices.map((graphIndex) => {
      const node = graph.nodes[graphIndex]!;
      return { graphIndex, id: node.id, radius: node.radius };
    });
    const memberIds = new Set(members.map((member) => member.id));
    const links: { source: string; target: string }[] = [];
    for (const edge of graph.fileEdges) {
      const source = graph.nodes[edge.source]!.id;
      const target = graph.nodes[edge.target]!.id;
      if (!memberIds.has(source) || !memberIds.has(target)) continue;
      links.push({ source, target });
    }
    // Seeded per module, so a module's cloud is the same however it got here
    // and in whatever order modules were unfolded (AD-6).
    const wake = new MemberLayout3D(
      { x: anchor.x, y: anchor.y, z: anchor.z },
      members,
      links,
      mulberry32(hashString(moduleId)),
    );
    wake.runToSettled();
    this.memberLayouts.set(moduleId, wake);
    this.emitter.emit("unfold", { moduleIds: [moduleId] });
  }

  private clearUnfolds(): void {
    const ids = [...this.memberLayouts.keys()];
    this.memberLayouts.clear();
    this.pinnedUnfolds.clear();
    if (ids.length > 0) this.emitter.emit("collapse", { moduleIds: ids });
  }

  /**
   * Apply the semantic-zoom rule (ADR-0006): above `UNFOLD_ZOOM`, modules in
   * view unfold; below it they collapse. Pins and the active scope hold their
   * modules open regardless.
   */
  private updateUnfolds(): void {
    const graph = this.graph;
    const layout = this.layout;
    if (!graph || !layout) return;
    const wanted = new Set<string>(this.pinnedUnfolds);
    if (this.scopePin !== null) wanted.add(this.scopePin);
    if (this.camera.k >= UNFOLD_ZOOM) {
      for (const item of layout.nodes) {
        const node = graph.nodes[item.graphIndex]!;
        if (node.kind !== "module") continue;
        wanted.add(node.id);
      }
    }
    const collapsed: string[] = [];
    for (const moduleId of [...this.memberLayouts.keys()]) {
      if (wanted.has(moduleId)) continue;
      this.memberLayouts.delete(moduleId);
      collapsed.push(moduleId);
    }
    if (collapsed.length > 0) {
      this.invalidateVisible();
      this.emitter.emit("collapse", { moduleIds: collapsed });
    }
    for (const moduleId of wanted) {
      if (!this.memberLayouts.has(moduleId)) {
        this.materialiseUnfold(moduleId);
        this.invalidateVisible();
      }
    }
  }

  /** World position of any node the engine currently has one for. */
  private positionOf(id: string): { x: number; y: number; z: number } | null {
    const top = this.layout?.nodes.find((node) => node.id === id);
    if (top) return { x: top.x, y: top.y, z: top.z };
    for (const wake of this.memberLayouts.values()) {
      const member = wake.nodes.find((node) => node.id === id);
      if (member) return { x: member.x, y: member.y, z: member.z };
    }
    return null;
  }

  private animateCameraTo(
    target: CameraState,
    durationMs: number,
    pins: readonly string[] = [],
  ): Promise<boolean> {
    this.cancelFlight();
    return new Promise<boolean>((resolve) => {
      this.flight = {
        from: this.camera,
        to: target,
        startMs: null,
        durationMs,
        pins,
        resolve,
      };
    });
  }

  // ---- picking -----------------------------------------------------------

  /**
   * The topmost node under a screen point.
   *
   * Walks the **same projection the renderer used**, nearest-to-camera first.
   * A second, independent projection would disagree with the frame at the
   * margins and the user would click one node and select its neighbour.
   */
  pick(screen: ScreenPoint): EngineNode | null {
    const scene = this.buildScene(this.lastFrameMs);
    if (!scene) return null;
    const placed = placeNodes(scene);
    let best: EngineNode | null = null;
    let bestZ = Infinity;
    for (const p of placed) {
      // The 7 px slop is the mockup's screen-space forgiveness margin; here it
      // is already screen space, so it is added rather than divided back.
      const hit = Math.max(p.screenR, 3) + 7;
      const distance = Math.hypot(p.sx - screen.x, p.sy - screen.y);
      if (distance > hit) continue;
      // Nearest to the camera wins: that is the node drawn on top, and the one
      // the user is pointing at.
      if (p.viewZ < bestZ) {
        bestZ = p.viewZ;
        best = p.node;
      }
    }
    return best;
  }

  getHovered(): EngineNode | null {
    return this.hoveredId === null ? null : this.getNode(this.hoveredId);
  }

  setHovered(id: string | null, screen: ScreenPoint | null = null): void {
    this.clearHoverCarry();
    this.applyHover(id, screen);
  }

  private applyHover(id: string | null, screen: ScreenPoint | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.emitter.emit("hover", { node: this.getHovered(), screen });
    this.emitHighlight();
  }

  private beginHoverCarry(id: string): void {
    this.carriedHoverId = id;
    this.carryStartMs = null;
  }

  private clearHoverCarry(): void {
    this.carriedHoverId = null;
    this.carryStartMs = null;
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

  // ---- co-change mark (story 5.6) ----------------------------------------

  /**
   * Mark a node's co-change partner set on the map, or clear with `null`.
   *
   * Implemented here **before** the `GraphEngine` interface declares it, by
   * agreement with 5.6's owner: her story adds the declaration, and whichever
   * of our PRs merges second would otherwise have to edit the other's files to
   * make the tree compile. Until then these are ordinary class members.
   *
   * It draws (a ring on each partner, never an edge — co-change is not a
   * dependency) rather than merely storing the set, so switching to 3D with a
   * blast radius marked does not silently lose the mark.
   */
  setBlastRadius(ids: readonly string[] | null): void {
    this.blastRadiusIds = ids === null ? [] : [...ids];
  }

  getBlastRadius(): readonly string[] {
    return this.blastRadiusIds;
  }

  // ---- semantic zoom -----------------------------------------------------

  unfoldedModules(): readonly string[] {
    return [...this.memberLayouts.keys()];
  }

  isUnfolded(moduleId: string): boolean {
    return this.memberLayouts.has(moduleId);
  }

  // ---- layer filter (story 5.3) ------------------------------------------

  getLayerFilter(): readonly Layer[] {
    return ALL_LAYERS.filter((layer) => this.visibleLayers.has(layer));
  }

  setLayerFilter(layers: readonly Layer[]): void {
    const next = new Set(layers.filter((layer) => ALL_LAYERS.includes(layer)));
    const unchanged =
      next.size === this.visibleLayers.size &&
      [...next].every((layer) => this.visibleLayers.has(layer));
    if (unchanged) return;
    this.visibleLayers = next;

    const hovered = this.getHovered();
    if (hovered && !this.isLayerVisible(hovered)) this.setHovered(null);
    const selected = this.getSelected();
    if (selected && !this.isLayerVisible(selected)) {
      this.setIsolated(null);
      this.setSelected(null);
    }

    const hidden = this.hiddenByLayerFilter();
    this.emitter.emit("filter", {
      layers: this.getLayerFilter(),
      hidden,
      visible: (this.graph?.nodes.length ?? 0) - hidden,
    });
    this.draw(this.lastFrameMs);
  }

  private hiddenByLayerFilter(): number {
    const graph = this.graph;
    if (!graph) return 0;
    return graph.nodes.filter((node) => !this.isLayerVisible(node)).length;
  }

  private isLayerVisible(node: EngineNode): boolean {
    return this.visibleLayers.has(node.layer);
  }

  // ---- scope and connected-only (story 5.4) ------------------------------

  getScope(): string | null {
    return this.scopeId;
  }

  setScope(moduleId: string | null): void {
    const graph = this.graph;
    const next =
      moduleId !== null &&
      graph &&
      graph.nodes[graph.indexById.get(moduleId) ?? -1]?.kind === "module"
        ? moduleId
        : null;
    if (this.scopeId === next) return;
    const previous = this.scopeId;
    if (next !== null) this.lastScopeId = null;
    this.scopeId = next;
    this.invalidateVisible();
    this.scopePin = next;
    if (next !== null) this.materialiseUnfold(next);
    if (previous !== null && previous !== next) this.updateUnfolds();
    this.reconcileInteraction();
    this.emitScope(null);
  }

  getConnectedOnly(): boolean {
    return this.connectedOnly;
  }

  setConnectedOnly(connectedOnly: boolean): void {
    if (this.connectedOnly === connectedOnly) return;
    this.connectedOnly = connectedOnly;
    this.invalidateVisible();
    this.reconcileInteraction();
    this.emitScope(null);
  }

  getReturnScope(): string | null {
    return this.lastScopeId;
  }

  private reconcileInteraction(): void {
    const visible = this.visibleIds();
    if (!visible) return;
    if (this.hoveredId !== null && !visible.has(this.hoveredId)) {
      this.setHovered(null);
    }
    if (this.selectedId !== null && !visible.has(this.selectedId)) {
      this.setIsolated(null);
      this.setSelected(null);
    }
    if (this.isolatedId !== null && !visible.has(this.isolatedId)) {
      this.setIsolated(null);
    }
  }

  hiddenCount(): {
    readonly byScope: number;
    readonly byDegree: number;
    readonly visible: number;
  } {
    const visible = this.visibleIds();
    return {
      byScope: this.hiddenByScope,
      byDegree: this.hiddenByDegree,
      visible: visible ? visible.size : (this.graph?.nodes.length ?? 0),
    };
  }

  private visibleIds(): ReadonlySet<string> | null {
    const graph = this.graph;
    if (!graph) return null;
    if (this.scopeId === null && !this.connectedOnly) {
      this.hiddenByScope = 0;
      this.hiddenByDegree = 0;
      return null;
    }
    const layers = this.getLayerFilter();
    const restrictTo =
      layers.length === ALL_LAYERS.length
        ? undefined
        : new Set(
            graph.nodes
              .filter((node) => this.isLayerVisible(node))
              .map((node) => node.id),
          );
    const materialised = this.connectedOnly
      ? this.materialisedIds(graph)
      : undefined;
    const unfoldKey = this.connectedOnly
      ? [...this.memberLayouts.keys()].sort().join(",")
      : "";
    const key = `${this.scopeId ?? ""}|${this.connectedOnly}|${layers.join(",")}|${unfoldKey}`;
    if (this.visibleCache && this.visibleCacheKey === key) {
      return this.visibleCache;
    }
    const result = visibleNodeIds(graph, {
      materialised,
      scopeId: this.scopeId,
      connectedOnly: this.connectedOnly,
      restrictTo,
    });
    this.visibleCacheKey = key;
    this.visibleCache = result.visible;
    this.hiddenByScope = result.hiddenByScope;
    this.hiddenByDegree = result.hiddenByDegree;
    return this.visibleCache;
  }

  private invalidateVisible(): void {
    this.visibleCache = null;
  }

  private materialisedIds(graph: Graph): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const index of graph.topLevelIndices) {
      ids.add(graph.nodes[index]!.id);
    }
    for (const moduleId of this.memberLayouts.keys()) {
      for (const index of graph.membersByModule.get(moduleId) ?? []) {
        ids.add(graph.nodes[index]!.id);
      }
    }
    return ids;
  }

  private emitScope(leftForId: string | null): void {
    const counts = this.hiddenCount();
    const visible = this.visibleIds();
    this.emitter.emit("scope", {
      scopeId: this.scopeId,
      connectedOnly: this.connectedOnly,
      hiddenByScope: counts.byScope,
      hiddenByDegree: counts.byDegree,
      visibleCount: visible ? visible.size : (this.graph?.nodes.length ?? 0),
      leftForId,
      returnToScopeId: this.lastScopeId,
    });
  }

  private readonly onLayerFilterChanged = (): void => {
    if (this.scopeId === null && !this.connectedOnly) return;
    this.invalidateVisible();
    this.reconcileInteraction();
    this.emitScope(null);
  };

  // ---- export ------------------------------------------------------------

  /**
   * Re-render the current frame into an offscreen surface at `scale`× density.
   *
   * The same contract the 2D export honours (AD-5 bans scaling a snapshot), and
   * the same scale floor — `MIN_EXPORT_SCALE` and `DEFAULT_EXPORT_SCALE` are
   * imported rather than restated, so the two views cannot disagree about what
   * FR-22 requires.
   */
  async exportPNG(options: ExportPngOptions = {}): Promise<Blob> {
    const scene = this.buildScene(this.lastFrameMs);
    if (!scene) {
      throw new Error(
        "viz: nothing to export — load an analysis document before exporting",
      );
    }
    const scale = options.scale ?? DEFAULT_EXPORT_SCALE;
    if (!Number.isFinite(scale) || scale < MIN_EXPORT_SCALE) {
      throw new Error(
        `viz: export scale must be >= ${MIN_EXPORT_SCALE} (AD-5), got ${scale}`,
      );
    }
    const { width, height } = scene.viewport;
    if (!(width > 0) || !(height > 0)) {
      throw new Error(
        `viz: cannot export a ${width} x ${height} viewport — the canvas has no size yet`,
      );
    }
    const surface = this.makeExportSurface(
      Math.round(width * scale),
      Math.round(height * scale),
    );
    surface.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    renderFrame3D(surface.ctx, scene);
    return surface.toBlob();
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

  /** One frame: advance the settle, rotate, advance a flight, draw. */
  frame(timeMs: number): void {
    const layout = this.layout;
    if (!layout) return;

    if (!layout.settled) {
      if (this.settleStartMs === null) this.settleStartMs = timeMs;
      layout.tick();
      if (layout.settled) {
        this.announceSettled(layout.frames, timeMs - this.settleStartMs);
        if (!this.cameraTakenByUser) void this.fit();
      }
    }

    for (const wake of this.memberLayouts.values()) {
      if (!wake.settled) wake.tick();
    }

    // Idle auto-rotation, measured on the frame clock like every other
    // animation here. Suppressed entirely under reduced motion (AC-6).
    if (this.autoRotate && !this.reducedMotion) {
      const elapsed = this.lastFrameMs === 0 ? 0 : timeMs - this.lastFrameMs;
      this.orientation = {
        ...this.orientation,
        yaw: this.orientation.yaw + elapsed * AUTO_ROTATE_RAD_PER_MS,
      };
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
    this.updateUnfolds();
    this.emitter.emit("camera", { camera: this.camera });
    if (t >= 1) {
      this.flight = null;
      this.releasePins(flight.pins);
      flight.resolve(true);
    }
  }

  /**
   * Assemble the scene for one frame.
   *
   * Public on the class and not on `GraphEngine`, exactly as the 2D engine's
   * is: the export and the tests reach it, chrome cannot.
   */
  buildScene(timeMs: number): Scene3D | null {
    const graph = this.graph;
    const layout = this.layout;
    if (!graph || !layout) return null;

    const placedIds = new Set<string>();
    const nodes: Renderable3DNode[] = [];
    const push = (item: LayoutNode3D): void => {
      const node = graph.nodes[item.graphIndex]!;
      if (!this.isLayerVisible(node)) return;
      placedIds.add(node.id);
      nodes.push({ node, x: item.x, y: item.y, z: item.z });
    };
    for (const item of layout.nodes) push(item);

    const edges: Renderable3DEdge[] = [];
    for (const [moduleId, wake] of this.memberLayouts) {
      for (const item of wake.nodes) {
        push(item);
        if (
          placedIds.has(moduleId) &&
          placedIds.has(graph.nodes[item.graphIndex]!.id)
        ) {
          edges.push({
            sourceId: moduleId,
            targetId: graph.nodes[item.graphIndex]!.id,
            member: true,
          });
        }
      }
    }

    for (const edge of graph.moduleEdges) {
      const sourceId = graph.nodes[edge.source]!.id;
      const targetId = graph.nodes[edge.target]!.id;
      if (!placedIds.has(sourceId) || !placedIds.has(targetId)) continue;
      edges.push({ sourceId, targetId, member: false });
    }
    for (const edge of graph.fileEdges) {
      const sourceId = graph.nodes[edge.source]!.id;
      const targetId = graph.nodes[edge.target]!.id;
      if (!placedIds.has(sourceId) || !placedIds.has(targetId)) continue;
      edges.push({ sourceId, targetId, member: false });
    }

    // Story 5.4's narrowing, over what the layer filter already produced —
    // the same composition order the 2D engine uses.
    const visible = this.visibleIds();
    const keptNodes = visible
      ? nodes.filter((item) => visible.has(item.node.id))
      : nodes;
    const keptEdges = visible
      ? edges.filter(
          (edge) => visible.has(edge.sourceId) && visible.has(edge.targetId),
        )
      : edges;

    const hoverId = this.hoveredId ?? this.carriedHover(timeMs);
    const focusId = this.isolatedId ?? hoverId;
    const chain = focusId === null ? null : new Set(this.chainOf(focusId));

    return {
      viewport: this.viewport,
      camera: this.camera,
      orientation: this.orientation,
      nodes: keptNodes,
      edges: keptEdges,
      mode: this.mode,
      timeMs,
      reducedMotion: this.reducedMotion,
      chain: chain && chain.size > 0 ? chain : null,
      chainMode: this.isolatedId === null ? "hover" : "isolate",
      selectedId: this.selectedId,
      blastRadius:
        this.blastRadiusIds.length > 0 ? new Set(this.blastRadiusIds) : null,
      showFileLabels: this.camera.k >= FILE_LABEL_ZOOM,
      fogStrength: this.fogStrength,
    };
  }

  private carriedHover(timeMs: number): string | null {
    if (this.carriedHoverId === null) return null;
    if (this.carryStartMs === null) this.carryStartMs = timeMs;
    if (timeMs - this.carryStartMs >= HOVER_CARRY_MS) {
      this.clearHoverCarry();
      return null;
    }
    return this.carriedHoverId;
  }

  private draw(timeMs: number): void {
    const scene = this.buildScene(timeMs);
    if (!scene) return;
    this.lastFrameMs = timeMs;
    renderFrame3D(this.ctx, scene);
  }

  // ---- pointer input -----------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.isPrimary === false) return;
    this.clearHoverCarry();
    this.dragging = true;
    this.dragMoved = false;
    // Shift pans the orbit target; a plain drag rotates it. Same split the
    // prototype used, and the one an orbit camera conventionally has.
    this.dragPans = event.shiftKey;
    this.pressPointerId = event.pointerId;
    this.pressOrigin = { x: event.clientX, y: event.clientY };
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = "grabbing";
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (
      this.dragging &&
      this.dragOrigin &&
      event.pointerId === this.pressPointerId
    ) {
      if (
        !this.dragMoved &&
        this.pressOrigin &&
        Math.hypot(
          event.clientX - this.pressOrigin.x,
          event.clientY - this.pressOrigin.y,
        ) > CLICK_SLOP_PX
      ) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        const dx = event.clientX - this.dragOrigin.x;
        const dy = event.clientY - this.dragOrigin.y;
        if (this.dragPans) {
          this.panBy(dx, dy);
        } else {
          // Rotating by hand ends the idle drift for the session: a camera
          // that resumed drifting after being aimed fights its user.
          this.autoRotate = false;
          this.cameraTakenByUser = true;
          this.setOrientation({
            yaw: this.orientation.yaw + dx * DRAG_YAW_PER_PX,
            pitch: this.orientation.pitch + dy * DRAG_PITCH_PER_PX,
          });
        }
        this.dragOrigin = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    const screen = this.toCanvasPoint(event);
    const node = this.pick(screen);
    const previous = this.hoveredId;
    if (node === null && previous !== null) this.beginHoverCarry(previous);
    if (node !== null) this.clearHoverCarry();
    this.applyHover(node?.id ?? null, screen);
    if (node && this.hoveredId === node.id) {
      this.emitter.emit("hover", { node, screen });
    }
    this.canvas.style.cursor = node ? "pointer" : "grab";
  };

  private readonly onPointerLeave = (): void => {
    this.setHovered(null, null);
  };

  private toCanvasPoint(event: PointerEvent): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pressPointerId) return;
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
    if (event.pointerId !== this.pressPointerId) return;
    this.endPress(event);
  };

  private endPress(event: PointerEvent): boolean {
    if (!this.dragging) return true;
    const moved = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    this.dragOrigin = null;
    this.pressOrigin = null;
    this.pressPointerId = null;
    this.dragPans = false;
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

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.pick({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    if (hit && hit.kind !== "module") return;
    if (!hit || hit.id === this.scopeId) {
      this.setScope(null);
      return;
    }
    this.setScope(hit.id);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (this.scopeId === null) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
        return;
      }
    }
    this.setScope(null);
  };

  private readonly onWindowResize = (): void => {
    this.resize();
  };
}

/**
 * The initial camera orientation, seeded from the document (AC-2).
 *
 * Its own stream, derived from the seed rather than drawn from the layout's:
 * taking numbers from the layout stream would have shifted every node position
 * the moment this was added, so a seeded orientation would have silently
 * changed every existing 3D layout. A separate stream keeps the two
 * independent and both reproducible.
 *
 * The pitch is kept in the readable band rather than allowed anywhere in the
 * clamp: a cloud first seen from almost directly overhead reads as a flat
 * scatter, which is the opposite of the point.
 */
export function seedOrientation(seed: number): Orientation {
  const rng = mulberry32(hashString(`orientation:${seed}`));
  return {
    yaw: rng() * Math.PI * 2,
    pitch: clampPitch((rng() - 0.5) * 0.9),
  };
}

export function createNebula3DEngine(options: Engine3DOptions): GraphEngine {
  return new Nebula3DEngine(options);
}
