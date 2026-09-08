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
  HOVER_CARRY_MS,
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
import { ALL_LAYERS } from "./layers.js";
import { MemberLayout, ModuleLayout, type LayoutNode } from "./layout.js";
import { hashString, mulberry32, seedFor, type Rng } from "./prng.js";
import {
  renderFrame,
  type RenderableEdge,
  type RenderableNode,
  type RenderScene,
} from "./render.js";
import { inScopeIds, visibleNodeIds } from "./scope.js";
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
import type { AnalysisDocument, Layer } from "@gitnebula/contract";

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
   * Modules this flight holds unfolded against the viewport rule. Owned per
   * flight rather than globally: a second search cancels the first flight, and
   * a shared pin set would let the cancelled flight's cleanup release the pin
   * the new flight depends on.
   */
  readonly pins: readonly string[];
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
   * The chain held while the pointer crosses the background between two nodes
   * (story 5.2, AC-3), and the frame clock at which the hold started. Resolved
   * on the first frame that sees it, like the arrival pulse, so the hold is
   * measured on the frame clock rather than on a second clock of its own.
   */
  private carriedHoverId: string | null = null;
  private carryStartMs: number | null = null;

  /**
   * One local wake per unfolded module (story 3.3, ADR-0006). Insertion order
   * is the unfold order, but nothing depends on it: each wake is seeded from
   * its own module id, so a module's cloud is the same however it got here.
   */
  private readonly memberLayouts = new Map<string, MemberLayout>();
  /**
   * Modules held unfolded regardless of the viewport rule, for the duration of
   * a fly-to that needs one of their files to exist. Without this the very next
   * `updateUnfolds` — which runs per animated frame — collapses the module
   * `ensureUnfolded` just opened, because the camera has not climbed past
   * `UNFOLD_ZOOM` yet. Reported from story 3.4's manual testing.
   */
  private readonly pinnedUnfolds = new Set<string>();
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

  // ---- scope and connected-only (story 5.4, FR-30) -----------------------
  /**
   * The module the map is scoped to, or null for the whole repository.
   *
   * Deliberately **not** part of the layout: the simulation keeps running on
   * the whole graph and no position moves when this changes, which is what
   * makes entering and leaving a scope instant and keeps the settle from being
   * re-run (AC-4).
   */
  private scopeId: string | null = null;
  /**
   * The module the active scope holds unfolded, kept **separate** from
   * `pinnedUnfolds`. A camera flight owns entries in that set and drops them
   * when it lands; one shared entry for two owners is how searching inside
   * your own scope used to collapse it.
   */
  private scopePin: string | null = null;
  private connectedOnly = false;
  /**
   * The scope currently offered as a way back, or null for "offer nothing"
   * (AC-5).
   *
   * This is the **state of the offer**, not a breadcrumb of the last scope
   * visited: it is set only when a search left a scope, and cleared when a
   * scope becomes active again or a new document is loaded. Keeping it as a
   * breadcrumb is what made the chrome claim a search had happened after the
   * user simply pressed Escape.
   */
  private lastScopeId: string | null = null;
  /**
   * The co-change partner set the map is marking, in the order chrome gave it
   * (story 5.6, AC-4).
   *
   * A frame concern like the scope above it: nothing here reaches the layout,
   * the graph or the edge list. Marking a blast radius adds **no** edge —
   * co-change is not a dependency, and drawing it as a line would say it is.
   */
  private blastRadiusIds: readonly string[] = [];
  /**
   * Cached visible-id set, or null when no filter is active. Rebuilt only when
   * a filter or the document changes, never per frame: `buildScene` runs on
   * every one of them and rebuilding a 2,100-id set at 60 fps is exactly the
   * kind of cost this story exists to remove.
   */
  private visibleCache: ReadonlySet<string> | null = null;
  /**
   * What the cached set was computed for: this story's two filters **and**
   * story 5.3's layer set. Keying on the layers rather than subscribing to
   * their change is what keeps the two stories uncoupled — neither setter has
   * to know the other exists.
   */
  private visibleCacheKey: string | null = null;
  private hiddenByScope = 0;
  private hiddenByDegree = 0;

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
  /**
   * The pointer that owns the current gesture. A second finger's release must
   * not end the first finger's drag, so every pointer event is matched
   * against this before it is allowed to change anything.
   */
  private pressPointerId: number | null = null;

  /**
   * Story 5.3's layer filter: the layers the frame carries. All five by
   * default, so an untouched Viewer behaves exactly as it did before.
   */
  private visibleLayers: ReadonlySet<Layer> = new Set(ALL_LAYERS);

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
    // Story 5.4. `dblclick` is the drill-down gesture: the single click
    // already means "select" (story 3.4) and AC-1 requires a distinct one.
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    globalThis.addEventListener?.("resize", this.onWindowResize);
    // On `globalThis`, not on the canvas: a canvas is not focusable, so a
    // canvas-level keydown never fires and Escape would silently do nothing.
    globalThis.addEventListener?.("keydown", this.onKeyDown);
    // Story 5.4 listens to story 5.3's `filter` event rather than editing its
    // setter — the two belong to different stories and different branches.
    // With connected-only on, a layer change alters which nodes still have an
    // edge in the frame, so the counts, the interaction state and the chrome
    // all need to follow. Without this the scope bar kept stale numbers and a
    // node removed by the resulting cascade stayed selected.
    this.emitter.on("filter", this.onLayerFilterChanged);

    this.resize();
  }

  // ---- lifecycle ---------------------------------------------------------

  load(document: AnalysisDocument, seed?: number): void {
    this.seed = seed ?? seedFor(document.repo.name);
    this.graph = buildGraph(document, this.hotThreshold);
    // The cache is keyed on nothing but "the graph and the filters" — a new
    // document invalidates it even when the filters themselves are unchanged.
    this.invalidateVisible();
    // Through the setters, not by assigning the fields: the interface says
    // these publish `select` and `highlight`, so clearing them silently makes
    // `load()` untruthful about its own state. Chrome mirrors both into its
    // store, so a second load would otherwise leave a panel open on a node the
    // new document need not contain. Each setter no-ops when unchanged, so a
    // first load still emits nothing.
    this.setSelected(null);
    this.setHovered(null, null);
    this.setIsolated(null);
    // Story 5.4: a scope names a module of the *previous* document, so neither
    // it nor a pending "return to scope" offer can survive a load — an offer
    // pointing into a document that is gone is worse than no offer, and
    // clicking it would no-op against the new graph forever.
    //
    // Assigned directly and published once, deliberately unlike the three
    // setters above. Routing through `setScope(null)` cannot do this job: it
    // returns early when no scope is active, so an offer left over from a
    // search would be cleared in the field but never announced, and chrome
    // would keep a stale button on screen. It also *repopulates* `lastScopeId`
    // from the scope it just left, which is the opposite of what a load needs.
    this.scopeId = null;
    this.lastScopeId = null;
    // Story 5.6: the marked partners name nodes of the *previous* document.
    // Carrying the set across a load would mark whichever nodes of the new
    // document happen to share an id — a mark that means nothing about the
    // repository now on screen.
    this.blastRadiusIds = [];
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
    // reproduce the load layout exactly, not continue the earlier stream
    // (AD-6 — "the same analysis.json always settles into the same map").
    this.rng = mulberry32(this.seed);
    this.cancelFlight();
    this.clearUnfolds();
    this.clearPulse();
    this.cameraTakenByUser = false;
    this.layout?.stop();
    this.layout = new ModuleLayout(graph, this.rng);
    // Story 5.4: `clearUnfolds()` above drops every hold, including the one an
    // active scope has on its focus module — but a replay does not leave the
    // scope, so the chrome goes on reporting it. Without this the scope
    // survives with its member files gone, which is the promise of AC-1
    // quietly broken by a button that is supposed to change nothing but the
    // animation. Re-taken here; the wake is rebuilt by `updateUnfolds` once
    // the new layout has settled and the anchor positions are real.
    this.scopePin = this.scopeId;
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
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    globalThis.removeEventListener?.("resize", this.onWindowResize);
    globalThis.removeEventListener?.("keydown", this.onKeyDown);
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
    this.releasePins(flight.pins);
    flight.resolve(false);
  }

  /**
   * Drop one flight's pins and re-apply the viewport rule, so a module held
   * open for a flight collapses as soon as that flight ends. Done here rather
   * than in the awaiting caller because that resumes a microtask later, which
   * leaves the map briefly disagreeing with ADR-0006 — and because the caller
   * would clear pins belonging to whichever flight replaced it.
   */
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

    // Story 5.4 / AC-5, the maintainer's binding decision: a search that
    // targets a node outside the active scope **leaves the scope and flies**.
    // Search stays globally useful and the scope stays a view filter rather
    // than a cage. A silent no-op — refusing to fly because the target is out
    // of frame — is explicitly not acceptable. The chrome is told the scope
    // was left and which one, so it can offer the way back.
    // Membership is tested against the scope alone, not against the whole
    // visible set: a node that is *in* scope but hidden by connected-only is
    // not out of scope, and clearing the scope for it would lose the user's
    // frame without putting the target on screen.
    const graphForScope = this.graph;
    if (
      this.scopeId !== null &&
      graphForScope &&
      !inScopeIds(graphForScope, this.scopeId).has(id)
    ) {
      const abandoned = this.scopeId;
      this.lastScopeId = abandoned;
      this.scopeId = null;
      // The hold `setScope` took to reveal this module's files goes with it.
      // Without this the abandoned module stays unfolded for the rest of the
      // session, outside the semantic-zoom rule and keeping a member layout
      // nobody is looking at — every other way of leaving a scope hands the
      // module back to the viewport rule, and a search-driven exit must not
      // be the odd one out.
      this.scopePin = null;
      this.updateUnfolds();
      this.invalidateVisible();
      this.emitScope(id);
    }

    // The same rule, applied to this story's other filter. Connected-only can
    // hide a search target on its own — a file with no dependencies is exactly
    // the sort of thing someone searches for by name — and flying to a node
    // that is not drawn is worse than the silent no-op AC-5 already forbids:
    // the camera lands on empty space and the panel describes something the
    // user cannot see.
    //
    // So the filter gives way, exactly as the scope does. It is turned off
    // rather than suspended: it is a view the user chose, and quietly
    // half-applying it would be a third state nobody asked for. The `scope`
    // event carries the change, so the toggle in the chrome follows.
    //
    // Story 5.3's layer filter can hide a target too. That one is NOT touched
    // here: it belongs to another story, and switching off somebody else's
    // control from inside this code path is exactly the kind of surprise this
    // comment exists to prevent. Reported rather than silently handled.
    // Asked of THIS story's filters alone, deliberately not of `visibleIds()`.
    // That set also carries story 5.3's layer restriction, so a target hidden
    // only by a layer would have looked like a connected-only exclusion — and
    // switching connected-only off could not have revealed it. Turning off a
    // filter the user chose, to no effect, is a worse outcome than the one
    // this whole branch exists to avoid.
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

    // Retire any flight already in the air BEFORE taking out this one's pin.
    // `pinnedUnfolds` is a set, so two searches for files in the same module
    // share one entry: acquiring first and cancelling second would have the
    // outgoing flight delete the very entry the incoming one depends on, and
    // the module would collapse mid-flight. Cancelling first makes the later
    // `cancelFlight()` inside `animateCameraTo` a no-op.
    this.cancelFlight();

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
      // Reduced motion jumps; there is no arrival to pulse (UX-DR11).
      this.setCamera(target);
      this.releasePins(pins);
      this.setSelected(id);
      return;
    }

    const arrived = await this.animateCameraTo(target, durationMs, pins);
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
    this.pinnedUnfolds.add(moduleId);
    this.materialiseUnfold(moduleId);
  }

  /**
   * Build a module's wake now, without claiming a pin on it.
   *
   * Split out for story 5.4: a scope holds a module open too, but through its
   * **own** ownership rather than `pinnedUnfolds`. Sharing that set was a real
   * defect — searching for a file inside the module you are already scoped to
   * puts one entry in the set for two reasons, and the flight's cleanup then
   * removed the scope's hold as well, collapsing the module and emptying the
   * scope of the very files it promises to show.
   */
  private materialiseUnfold(moduleId: string): void {
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
    pins: readonly string[] = [],
  ): Promise<boolean> {
    // Cancels whatever was already in the air — releasing only *that* flight's
    // pins, so the ones this new flight depends on survive.
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
    const visible = this.visibleIds();
    for (const item of [...this.memberNodes(), ...layout.nodes]) {
      const node = graph.nodes[item.graphIndex]!;
      // Story 5.3: a filtered-out node is not on screen, so it is not under
      // the pointer either. This is the half of AC-2 that dimming can never
      // give you — a dimmed node still catches every pick.
      if (!this.isLayerVisible(node)) continue;
      // Story 5.4 / AC-6: a node the frame does not carry is absent, not
      // dimmed — so it cannot be hovered, tooltipped or clicked either.
      // Two independent guards, resolved as a union at the 5.3/5.4 rebase:
      // either filter alone is enough to take a node out of the pointer's
      // reach, and neither subsumes the other.
      if (visible && !visible.has(node.id)) continue;
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

  /**
   * Set the hovered node.
   *
   * An explicit call is an explicit answer: it cancels any held chain, so
   * `setHovered(null)` restores full opacity on the very next frame (AC-2).
   * `pointerleave` and chrome both come through here. The pointer-move path
   * takes `applyHover` instead, which leaves the hold alone.
   */
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

  /** Hold `id`'s chain for `HOVER_CARRY_MS` of frame clock (story 5.2). */
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

  // ---- blast radius (story 5.6, FR-27) -----------------------------------

  /**
   * Mark a node's co-change partners, or clear the mark with `null` / `[]`.
   *
   * Ids that are not in the document are kept rather than rejected: they
   * simply match no node when the scene is built, so a set that outlives its
   * document marks less instead of throwing. No event is emitted — chrome
   * asked for this set and already knows it, and `getBlastRadius()` is here
   * for anything that connects later.
   */
  setBlastRadius(ids: readonly string[] | null): void {
    this.blastRadiusIds = ids === null ? [] : [...ids];
  }

  getBlastRadius(): readonly string[] {
    return this.blastRadiusIds;
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

  // ---- scope and connected-only (story 5.4, FR-30) -----------------------

  getScope(): string | null {
    return this.scopeId;
  }

  /**
   * Scope the map to a module, or leave the scope with `null` (AC-1, AC-2).
   *
   * Nothing here touches `layout`, `memberLayouts`, `rng` or the camera. That
   * is the story's central claim: scoping filters the built frame, so a
   * scope/unscope cycle leaves every node exactly where it was and the settle
   * is never re-run (AC-4).
   */
  setScope(moduleId: string | null): void {
    const graph = this.graph;
    // An id that is not a module in this document leaves the scope rather
    // than scoping to nothing — a frame of zero nodes is never what a caller
    // meant, and a silent empty map is the worst possible answer.
    const next =
      moduleId !== null &&
      graph &&
      graph.nodes[graph.indexById.get(moduleId) ?? -1]?.kind === "module"
        ? moduleId
        : null;
    if (this.scopeId === next) return;
    const previous = this.scopeId;
    // Entering a scope answers the offer, so it goes. Leaving one by hand does
    // NOT create an offer: only AC-5's search transition does, and it sets the
    // field itself. An ordinary exit that left a breadcrumb behind is what had
    // the chrome announce a search the user never ran.
    if (next !== null) this.lastScopeId = null;
    this.scopeId = next;
    this.invalidateVisible();
    // A scope promises the focus module's **member files**, not merely
    // permission for them to be drawn. Members live in `memberLayouts`, which
    // the viewport rule fills — so without this, drilling in at overview zoom
    // shows the module and its neighbours and none of its files, which is the
    // one thing the gesture exists to reveal.
    //
    // Held through `scopePin`, NOT through `pinnedUnfolds`: a camera flight
    // uses that set and releases it on landing, and one shared entry for two
    // owners meant searching for a file inside the scope you are already in
    // collapsed the module the moment the flight finished.
    this.scopePin = next;
    if (next !== null) this.materialiseUnfold(next);
    // Re-apply the viewport rule, so a module this scope was holding open can
    // collapse now that nothing holds it.
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

  /**
   * Drop hover, selection and isolate when their node has just left the frame.
   *
   * Without this the panel keeps describing a node that is no longer on the
   * map and a stale hover chain keeps lighting nodes that are. Routed through
   * the existing setters, so `hover` / `select` / `highlight` fire exactly as
   * chrome already expects — this story adds no semantics to those three. The
   * layer filter (5.3) does the same thing for the same reason; the two are
   * deliberately consistent.
   */
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
    // Isolate is checked on its own, not merely as a side effect of dropping
    // the selection. `setIsolated` is a public operation independent of
    // `setSelected`, so isolate can outlive a selection that is null or that
    // points at a node still on screen — and a highlight focused on a node the
    // filter just removed keeps dimming everything around nothing.
    if (this.isolatedId !== null && !visible.has(this.isolatedId)) {
      this.setIsolated(null);
    }
  }

  hiddenCount(): {
    readonly byScope: number;
    readonly byDegree: number;
    readonly visible: number;
  } {
    // Recomputed lazily so a caller asking before the first frame gets the
    // truth rather than the zeroes the fields were initialised with.
    const visible = this.visibleIds();
    return {
      byScope: this.hiddenByScope,
      byDegree: this.hiddenByDegree,
      // The survivor count is reported, never left to the caller to subtract:
      // nodes also leave the frame through story 5.3's layers and through
      // semantic zoom, and neither of those appears in the two counts above.
      //
      // `visibleIds()` returns `null` as an early-out when there is no scope
      // and no connected-only filter — nothing needs materialising then. That
      // `null` means "there is no *set* to consult", NOT "everything
      // survives": the layer filter is still live, and on this path it is the
      // only thing removing nodes. Reading it as the whole graph is debt 7b,
      // reported by story 5.7 and fixed in 6.5.
      visible: visible
        ? visible.size
        : this.graph
          ? this.graph.nodes.length - this.hiddenByLayerFilter()
          : 0,
    };
  }

  /** The scope a search last flew out of, for the chrome's way back (AC-5). */
  getReturnScope(): string | null {
    return this.lastScopeId;
  }

  /**
   * Restore a pending "return to scope" offer (story 5.7's view swap).
   *
   * Deliberately does nothing but set the field: no event, no scope change, no
   * camera move. The offer's *creation* still belongs solely to the search
   * transition in `flyTo` — this only hands an existing one to a replacement
   * engine, and `connectEngine` mirrors `getReturnScope()` on attach, so
   * publishing here would duplicate it.
   */
  setReturnScope(moduleId: string | null): void {
    this.lastScopeId = moduleId;
  }

  /**
   * The ids the frame may carry, or **null when no filter is active**.
   *
   * The null fast path matters: with nothing filtered there is no set to build
   * and no membership test per node, so an unscoped map costs exactly what it
   * cost before this story. `buildScene` and `pick` both read this, which is
   * what makes "absent, not dimmed" true for the pointer as well as for the
   * eye (AC-6).
   */
  private visibleIds(): ReadonlySet<string> | null {
    const graph = this.graph;
    if (!graph) return null;
    if (this.scopeId === null && !this.connectedOnly) {
      this.hiddenByScope = 0;
      this.hiddenByDegree = 0;
      return null;
    }

    // Connected-only asks "does this node have an edge **in the frame**", and
    // story 5.3's layer filter narrows that frame too. So its exclusions are
    // fed in as a restriction — otherwise a file whose only dependency sits in
    // a hidden layer survives this filter and is drawn edgeless anyway.
    //
    // The layer filter belongs to another story and this one must not reach
    // into its setter to invalidate a cache, so the cache is keyed on the
    // active layers instead: a change there produces a different key and the
    // set is rebuilt on the next read, with no coupling in either direction.
    const layers = this.getLayerFilter();
    const restrictTo =
      layers.length === ALL_LAYERS.length
        ? undefined
        : new Set(
            graph.nodes
              .filter((node) => this.isLayerVisible(node))
              .map((node) => node.id),
          );
    // What the scene can actually draw right now: the top-level nodes, plus
    // the members of whichever modules are unfolded (ADR-0006). A file inside
    // a collapsed module has no position, so `buildScene` drops every edge
    // touching it — counting those edges would mark a node connected and then
    // draw it with nothing attached.
    //
    // Only computed while connected-only is on, because it is the only filter
    // that asks about edges; scoping alone does not care.
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

  /**
   * Every id the scene can give a position to right now: the top-level nodes
   * the module layout carries, plus the members of the unfolded modules.
   *
   * This is the same set `buildScene` can place, which is the point — the
   * connectivity question has to be asked about the frame the user is looking
   * at, not about the document.
   */
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

  /** Publish the frame's filter state. `leftForId` is set only for AC-5. */
  private emitScope(leftForId: string | null): void {
    const counts = this.hiddenCount();
    this.emitter.emit("scope", {
      scopeId: this.scopeId,
      connectedOnly: this.connectedOnly,
      hiddenByScope: counts.byScope,
      hiddenByDegree: counts.byDegree,
      // Taken from `counts`, not recomputed. This line used to carry its own
      // copy of the survivor expression, which is how debt 7b came to exist in
      // two places at once — and it is reachable here: leaving a scope while a
      // layer filter is on emits with no scope left to consult.
      visibleCount: counts.visible,
      leftForId,
      returnToScopeId: this.lastScopeId,
    });
  }

  /**
   * The drill-down gesture (AC-1, AC-2). A module under the pointer scopes to
   * it; the focus module again, or empty space, leaves the scope. Both
   * directions are the same gesture, which is what makes the exit as
   * discoverable as the entry.
   */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.pick({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    // A file is not an exit. Scoping is what puts member files on screen in
    // the first place, so double-clicking one is a likely thing to do by
    // accident — and throwing the user out of the scope for it contradicts
    // the gesture this method documents: empty space, or the focus module
    // again. A file simply has no drill-down meaning, so nothing happens.
    if (hit && hit.kind !== "module") return;
    if (!hit || hit.id === this.scopeId) {
      this.setScope(null);
      return;
    }
    this.setScope(hit.id);
  };

  /**
   * `Escape` leaves the scope (AC-2).
   *
   * Skipped while the keystroke is destined for a field: `chrome/search.ts`
   * already owns Escape inside its input, where it closes the result list, and
   * two handlers racing for one key is how a search box stops being able to
   * dismiss itself. Story 5.1's owner ceded the key explicitly, so with the
   * start-here panel open Escape still means exactly one thing.
   */
  /**
   * Story 5.3 changed the layer set. If connected-only is on, that changes
   * which nodes still carry an edge in the frame — so recompute, drop any
   * interaction state whose node the cascade removed, and publish, exactly as
   * this story's own setters do.
   *
   * A no-op when connected-only is off and nothing is scoped: `visibleIds()`
   * short-circuits and the layer filter is entirely 5.3's business.
   */
  private readonly onLayerFilterChanged = (): void => {
    if (this.scopeId === null && !this.connectedOnly) return;
    this.invalidateVisible();
    this.reconcileInteraction();
    this.emitScope(null);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (this.scopeId === null) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
    }
    this.setScope(null);
  };

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

    // Modules only. The layout also carries the repository's root files (4.7),
    // and they have no members to unfold into — asking would build an empty
    // wake and emit an `unfold` for a node that never folds.
    const candidates: UnfoldCandidate[] = layout.nodes
      .filter((node) => graph.nodes[node.graphIndex]!.kind === "module")
      .map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        radius: node.radius,
      }));
    const wanted = wantedUnfolds(candidates, this.camera, this.viewport);
    // A pinned module stays open even below the threshold: it is the target of
    // a flight in progress, and collapsing it would destroy the very node the
    // camera is flying toward.
    for (const moduleId of this.pinnedUnfolds) wanted.add(moduleId);
    // The active scope holds its focus module open for the same reason and by
    // its own right (story 5.4) — kept apart from the flight pins above so
    // neither owner can release the other's hold.
    if (this.scopePin !== null) wanted.add(this.scopePin);
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

    // Story 5.4. Unfolding or collapsing changes which nodes the scene can
    // place, and connected-only judges connectivity on exactly that — so a
    // module crossing the zoom threshold changes the visible set as surely as
    // toggling a filter does. Treated the same way: recompute, drop any
    // interaction state whose node has gone, and publish.
    //
    // Only while a filter of this story's is active; otherwise semantic zoom
    // is nobody's business but ADR-0006's, and this must not add an event to
    // the ordinary pan-and-zoom path.
    if (this.scopeId !== null || this.connectedOnly) {
      this.invalidateVisible();
      this.reconcileInteraction();
      this.emitScope(null);
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
    this.pinnedUnfolds.clear();
    this.scopePin = null;
    for (const wake of this.memberLayouts.values()) wake.stop();
    this.memberLayouts.clear();
  }

  /** Every member node currently on screen, across all unfolded modules. */
  private memberNodes(): LayoutNode[] {
    const nodes: LayoutNode[] = [];
    for (const wake of this.memberLayouts.values()) nodes.push(...wake.nodes);
    return nodes;
  }

  // ---- layer filter (story 5.3, FR-28) -----------------------------------

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

    // A node that just left the frame must not stay hovered or selected: the
    // hover chain would keep highlighting an invisible node and story 3.4's
    // panel would keep describing one. Routed through the existing setters, so
    // the `hover` / `select` / `highlight` events fire exactly as chrome
    // already expects — this story adds no event semantics to those three.
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
    // No re-settle, no re-seed, no simulation call (AC-6): the layout keeps
    // running on the whole graph and only the frame narrows. Redrawing is the
    // whole of the visual change, and the frozen-on-settle loop is not ticking
    // the simulation, so one draw is what a toggle costs.
    this.draw(this.lastFrameMs);
  }

  /** How many nodes the active filter removes from the frame. */
  private hiddenByLayerFilter(): number {
    const graph = this.graph;
    if (!graph) return 0;
    return graph.nodes.filter((node) => !this.isLayerVisible(node)).length;
  }

  /** Whether a node's layer survives the active filter. */
  private isLayerVisible(node: EngineNode): boolean {
    return this.visibleLayers.has(node.layer);
  }

  /**
   * Drop what the layer filter excludes from an assembled scene (AC-2, AC-3).
   *
   * Called from `buildScene`, which means the live frame and `exportPNG` are
   * filtered by one line of code rather than two that could disagree (AC-5).
   */
  private applyLayerFilter(
    nodes: readonly RenderableNode[],
    edges: readonly RenderableEdge[],
  ): { nodes: readonly RenderableNode[]; edges: readonly RenderableEdge[] } {
    if (this.visibleLayers.size === ALL_LAYERS.length) return { nodes, edges };
    const kept = nodes.filter((item) => this.isLayerVisible(item.node));
    const surviving = new Set(kept.map((item) => item.node.id));
    return {
      nodes: kept,
      edges: edges.filter(
        (edge) => surviving.has(edge.sourceId) && surviving.has(edge.targetId),
      ),
    };
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
      // Arrived: the viewport rule takes over again, and at the arrival zoom
      // the module stays open on its own merits.
      this.releasePins(flight.pins);
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

    // Story 5.3 — the layer filter narrows the frame, and this is the only
    // place it does so. A node whose layer is off is ABSENT, not dimmed: it
    // leaves the scene, so the renderer never sees it and `pick()` (which
    // carries the matching guard) never returns it. An edge survives only when
    // both of its endpoints do — a half-anchored edge would point at nothing.
    //
    // The all-on case returns the arrays untouched, so an unfiltered map
    // allocates nothing extra per frame.
    const filtered = this.applyLayerFilter(nodes, edges);

    // ---- story 5.4: scope / connected-only narrowing ----------------------
    // Applied over the arrays 5.3 just produced, which is the composition
    // order its owner and I agreed before either of us wrote a line: two
    // successive narrowings compose, two rewrites of the same lines do not.
    // It only ever removes; it never rebuilds what the layer filter dropped.
    // An edge survives only when BOTH ends do — a half-visible edge would
    // point at a node that is not on screen.
    //
    // `visibleIds()` returns null when neither of this story's filters is
    // active, and then the arrays pass straight through with no allocation,
    // exactly as the layer filter's all-on case does.
    const visible = this.visibleIds();
    const scoped = visible
      ? {
          nodes: filtered.nodes.filter((item) => visible.has(item.node.id)),
          edges: filtered.edges.filter(
            (edge) => visible.has(edge.sourceId) && visible.has(edge.targetId),
          ),
        }
      : filtered;

    // Isolate outranks hover, and hover outranks the chain still being held
    // from the node the pointer just left (story 5.2, AC-3).
    const hoverId = this.hoveredId ?? this.carriedHover(timeMs);
    const focusId = this.isolatedId ?? hoverId;
    const chain = focusId === null ? null : new Set(this.chainOf(focusId));

    return {
      viewport: this.viewport,
      camera: this.camera,
      stars: this.stars,
      nodes: scoped.nodes,
      edges: scoped.edges,
      mode: this.mode,
      timeMs,
      reducedMotion: this.reducedMotion,
      chain: chain && chain.size > 0 ? chain : null,
      // Which interaction the chain came from decides how the rest of the map
      // is encoded: isolate extinguishes it, hover leaves it legible (FR-29).
      chainMode: this.isolatedId === null ? "hover" : "isolate",
      selectedId: this.selectedId,
      showFileLabels: this.camera.k >= FILE_LABEL_ZOOM,
      pulse: this.pulseProgress(timeMs),
      // Story 5.6 — the co-change mark. Note what is NOT here: no entry was
      // added to `edges` above, and nothing was removed from `nodes`. The
      // partners are marked exactly where they already are (AC-4).
      blastRadius:
        this.blastRadiusIds.length > 0 ? new Set(this.blastRadiusIds) : null,
    };
  }

  /**
   * The chain held across the gap between two nodes, or null once the hold has
   * run out (story 5.2, AC-3).
   *
   * Nothing here is drawn as a function of `timeMs` — the held chain is the
   * same chain, at the same alphas, for every frame of the hold and then gone.
   * That is what keeps this a debounce rather than a transition, and why
   * reduced motion needs no special case (AC-5).
   */
  private carriedHover(timeMs: number): string | null {
    if (this.carriedHoverId === null) return null;
    if (this.carryStartMs === null) this.carryStartMs = timeMs;
    if (timeMs - this.carryStartMs >= HOVER_CARRY_MS) {
      this.clearHoverCarry();
      return null;
    }
    return this.carriedHoverId;
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
    // Refuse the gesture at its start, not at its end. Guarding only the
    // release stops a right-click selecting but still lets it pan the map on
    // the way to the context menu.
    if (event.button !== 0 || event.isPrimary === false) return;
    // Hover stays suppressed for the whole gesture (AC-2), so a press must
    // also end a chain that is still being held from before it.
    this.clearHoverCarry();
    this.dragging = true;
    this.dragMoved = false;
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
      // Story 3.4's AC-4 lives in this branch: a press only becomes a drag
      // once it has travelled, and a press that never became one selects.
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
      // Nothing pans until the press has become a drag. Panning inside the
      // slop would shift the map by a few pixels on every click, and a user
      // who clicks a dozen nodes would watch the graph drift out from under
      // them. Crossing the threshold pans from the press point, so the
      // motion held back here is not lost.
      if (this.dragMoved) {
        this.panBy(
          event.clientX - this.dragOrigin.x,
          event.clientY - this.dragOrigin.y,
        );
        this.dragOrigin = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    // Hover (FR-17, FR-29). Deliberately not evaluated while dragging: a pan
    // would otherwise light up and dim every node it swept past.
    const screen = this.toCanvasPoint(event);
    const node = this.pick(screen);
    const previous = this.hoveredId;
    // A pointer sweeping a dense map spends a frame or two over the background
    // between two nodes. Dropping the chain there and picking the next one up
    // a frame later is the flicker AC-3 forbids, so the chain the pointer just
    // left is held (`carriedHover`) until it either times out or a new node
    // takes over. `applyHover`, not `setHovered`: the latter is the explicit
    // "hover is over" answer and cancels the hold.
    if (node === null && previous !== null) this.beginHoverCarry(previous);
    if (node !== null) this.clearHoverCarry();
    this.applyHover(node?.id ?? null, screen);
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

  /** Drop the press state. Returns whether it had become a drag. */
  private endPress(event: PointerEvent): boolean {
    if (!this.dragging) return true;
    const moved = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    this.dragOrigin = null;
    this.pressOrigin = null;
    this.pressPointerId = null;
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
