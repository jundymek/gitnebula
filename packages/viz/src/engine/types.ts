/**
 * The GraphEngine interface — layout **and** render behind one seam (AD-5).
 *
 * It is declared here **in full**, including the parts story 2.5 does not
 * implement: unfold/collapse and hover chains (3.3), mode and highlight state
 * (3.4), `exportPNG` (3.5). Those stories are frozen against this shape, so
 * reshaping it later is coordination cost paid by other agents. Members 2.5
 * does not implement throw a named error pointing at the owning story — a
 * silent no-op would let a caller believe it worked.
 *
 * Chrome imports this module (via `engine/index.ts`) and nothing else from the
 * engine: no canvas, no context, no simulation. That rule is checked by
 * `src/chrome/boundary.test.ts`.
 */

import type { AnalysisDocument, Layer, NodeKind } from "@gitnebula/contract";

/** The two view modes of the map (FR-21). */
export type ViewMode = "structure" | "heat";

/**
 * The camera. `x`/`y` are the world point held at the viewport centre and `k`
 * is the zoom factor, clamped to [MIN_ZOOM, MAX_ZOOM].
 */
export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

/** A point in CSS pixels relative to the canvas' top-left corner. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A node as chrome may see it: the contract's fields plus what the engine
 * derived from them. Deliberately without positions — chrome moves the camera
 * through the engine rather than doing its own world maths.
 */
export interface EngineNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly parent: string | null;
  readonly path: string;
  readonly layer: Layer;
  readonly loc: number;
  readonly churn: number;
  readonly commits: number;
  readonly authors: number;
  readonly lastChangedAt: string | null;
  /** Reserved for the post-MVP describe layer; always null in MVP (AD-10). */
  readonly description: null;
  /** `churn >= hotThreshold` — computed once, so chrome never re-derives it. */
  readonly hot: boolean;
  /** Rendered radius in world units, ∝ √LOC (UX-DR4). */
  readonly radius: number;
}

/** Events the engine emits. Chrome subscribes; it never polls the canvas. */
export interface GraphEngineEventMap {
  /** A settle run began — on load, on replay, or when a wake starts (3.3). */
  "settle-start": { readonly reason: "load" | "replay" };
  /** Settled reached (AD-6). `frames`/`durationMs` are what FR-12 measures. */
  settled: { readonly frames: number; readonly durationMs: number };
  /** The camera moved, for any reason. */
  camera: { readonly camera: CameraState };
  /** Pointer hover entered, moved within, or left a node (3.3's tooltip). */
  hover: {
    readonly node: EngineNode | null;
    readonly screen: ScreenPoint | null;
  };
  /** Selection changed — a click, or a search fly-to arrival (3.3 → 3.4). */
  select: { readonly node: EngineNode | null };
  /** Modules unfolded into their files (3.3, ADR-0006). */
  unfold: { readonly moduleIds: readonly string[] };
  /** Modules collapsed back (3.3, ADR-0006). */
  collapse: { readonly moduleIds: readonly string[] };
  /** View mode changed (3.4). */
  mode: { readonly mode: ViewMode };
  /** Focus/isolate state changed (3.3 hover chain, 3.4 isolate). */
  highlight: {
    readonly focusId: string | null;
    readonly isolated: boolean;
  };
  /**
   * The layer filter changed (5.3). `layers` is the surviving set in
   * `ALL_LAYERS` order; `hidden` and `visible` are node counts, so chrome can
   * name the cause and decide on its empty state without counting nodes — or
   * subtracting against `nodes`, which is deliberately the *unfiltered* set.
   */
  filter: {
    readonly layers: readonly Layer[];
    readonly hidden: number;
    readonly visible: number;
  };
  /**
   * The scope or the connected-only filter changed (story 5.4). Carries what
   * chrome needs to state the current frame without asking the canvas
   * anything: the active scope, the two hidden counts kept apart by cause
   * (UX-DR14), and — when a search flew out of a scope — the scope it left,
   * so the chrome can offer a one-click way back (AC-5).
   */
  scope: {
    readonly scopeId: string | null;
    readonly connectedOnly: boolean;
    readonly hiddenByScope: number;
    readonly hiddenByDegree: number;
    /**
     * How many nodes survive both filters. Zero while a scope is active is the
     * empty state AC-3 has to name rather than show as a blank map — and it is
     * knowledge only the engine has, since chrome never sees the scene (AD-5).
     */
    readonly visibleCount: number;
    /**
     * Set only on the transition where a search left an active scope; null
     * otherwise. A silent no-op is not acceptable for AC-5, so the event has
     * to be able to say *why* the scope went away.
     */
    readonly leftForId: string | null;
    /**
     * The scope the chrome should currently offer as a way back, or null for
     * "offer nothing" (AC-5).
     *
     * Deliberately the **state of the offer**, not a breadcrumb of the last
     * scope visited. Chrome mirrors this field and infers nothing: a offer
     * derived in the chrome from "was there a previous scope" would greet a
     * user who pressed Escape with "left the scope to reach your search
     * result", and would survive a document being replaced.
     */
    readonly returnToScopeId: string | null;
  };
}

export type GraphEngineEvent = keyof GraphEngineEventMap;

export type GraphEngineListener<K extends GraphEngineEvent> = (
  payload: GraphEngineEventMap[K],
) => void;

/** Construction-time options. */
export interface EngineOptions {
  /** Where the nebula is drawn. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Churn at or above which a node is a hot spot. Defaults to
   * `HOT_THRESHOLD` (0.5) — the pipeline's `hotspotThreshold` never reaches
   * `analysis.json`, so the Viewer carries its own.
   */
  readonly hotThreshold?: number;
  /**
   * Honour `prefers-reduced-motion`. Defaults to the media query; tests and
   * the 3.5 audit pass it explicitly.
   */
  readonly reducedMotion?: boolean;
}

export interface FitOptions {
  /** Animation length in ms. Must stay under 800 ms (AC-2). */
  readonly durationMs?: number;
  /** Padding kept around the graph bounds, in CSS px. */
  readonly paddingPx?: number;
}

export interface FlyToOptions {
  readonly durationMs?: number;
  /** Target zoom; defaults to 2.0 for a module and 3.0 for a file (mockup). */
  readonly zoom?: number;
}

export interface ExportPngOptions {
  /** Pixel density multiplier; AD-5 requires ≥ 2. */
  readonly scale?: number;
}

/**
 * The seam. Everything the chrome may do to the map is on this interface.
 */
export interface GraphEngine {
  // ---- lifecycle -------------------------------------------------------

  /**
   * Take a validated document and lay it out. `seed` defaults to
   * `hash(document.repo.name)` (AD-6); passing it explicitly is for tests.
   */
  load(document: AnalysisDocument, seed?: number): void;

  /** Re-seed and re-run the settle animation from scratch (FR-12 replay). */
  replay(): void;

  /** Re-read the canvas' CSS size and device pixel ratio. */
  resize(): void;

  /** Stop the frame loop and detach every listener. */
  destroy(): void;

  // ---- graph -----------------------------------------------------------

  /** Every node in the document, modules and files, in contract order. */
  readonly nodes: readonly EngineNode[];

  getNode(id: string): EngineNode | null;

  /**
   * One-hop dependency chain of a node — itself, its import neighbours, and
   * (for an unfolded module) its members. Story 3.3's hover highlight.
   */
  chainOf(id: string): readonly string[];

  // ---- camera ----------------------------------------------------------

  getCamera(): CameraState;
  setCamera(camera: Partial<CameraState>): void;

  /** Pan by a screen-space delta in CSS pixels. */
  panBy(dx: number, dy: number): void;

  /** Zoom about a screen point, so the world point under it stays put. */
  zoomAt(screen: ScreenPoint, factor: number): void;

  /** Frame the whole graph. Resolves when the movement is finished. */
  fit(options?: FitOptions): Promise<void>;

  /** Fly the camera to a node and select it (story 3.3). */
  flyTo(id: string, options?: FlyToOptions): Promise<void>;

  // ---- picking and interaction state -----------------------------------

  /** The topmost node under a screen point, or null. */
  pick(screen: ScreenPoint): EngineNode | null;

  getHovered(): EngineNode | null;
  setHovered(id: string | null, screen?: ScreenPoint | null): void;

  getSelected(): EngineNode | null;
  setSelected(id: string | null): void;

  /** Isolate dims everything outside a node's chain until cleared (3.4). */
  getIsolated(): EngineNode | null;
  setIsolated(id: string | null): void;

  getMode(): ViewMode;
  setMode(mode: ViewMode): void;

  // ---- semantic zoom (story 3.3, ADR-0006) -----------------------------

  /** Module ids currently unfolded into their file nodes. */
  unfoldedModules(): readonly string[];
  isUnfolded(moduleId: string): boolean;

  // ---- layer filter (story 5.3, FR-28) ---------------------------------

  /** The layers currently drawn, in `ALL_LAYERS` order. */
  getLayerFilter(): readonly Layer[];

  /**
   * Restrict the frame to `layers`.
   *
   * **Excluded means not drawn, never dimmed** — a node whose layer is absent
   * leaves the scene entirely, so it cannot be hovered, picked, or counted as
   * pointer hit-area. Dimming is the hover encoding's business (5.2) and this
   * is deliberately not it.
   *
   * Filtering is a frame concern, not a layout concern: the simulation keeps
   * running on the whole graph, so switching a layer back on restores nodes
   * exactly where they were and never re-runs the settle.
   */
  setLayerFilter(layers: readonly Layer[]): void;

  // ---- scope and connected-only (story 5.4, FR-30) ---------------------

  /** The module the map is scoped to, or null for the whole repository. */
  getScope(): string | null;

  /**
   * Scope the map to a module, or leave the scope with `null`.
   *
   * A frame concern only: the simulation keeps running on the whole graph and
   * positions do not move, which is what makes leaving instant and keeps the
   * settle from being re-run (AC-4). Passing an id that is not a module in the
   * document leaves the scope rather than scoping to nothing.
   */
  setScope(moduleId: string | null): void;

  /** Whether degree-0 nodes are being dropped from the frame (AC-3). */
  getConnectedOnly(): boolean;
  setConnectedOnly(connectedOnly: boolean): void;

  /**
   * How many nodes each filter is currently hiding, kept apart by cause.
   * Never a combined total — UX-DR14 asks a hidden state to name its cause,
   * and the two counts are not additive.
   */
  hiddenCount(): {
    readonly byScope: number;
    readonly byDegree: number;
    /**
     * How many nodes actually survive every filter and can be drawn right now.
     * Reported rather than left to the caller to subtract: the survivors are
     * what is left after scope, connected-only, story 5.3's layers AND
     * semantic zoom, and a caller doing the arithmetic from the two counts
     * above would silently miss the last two.
     */
    readonly visible: number;
  };

  // ---- export (story 3.5) ----------------------------------------------

  /**
   * Re-render the current camera, mode and highlight state into an offscreen
   * target at `scale`× density and return it as a PNG. AD-5 bans scaling a
   * canvas snapshot: this must go through the same render path.
   */
  exportPNG(options?: ExportPngOptions): Promise<Blob>;

  // ---- events ----------------------------------------------------------

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends GraphEngineEvent>(
    event: K,
    listener: GraphEngineListener<K>,
  ): () => void;

  off<K extends GraphEngineEvent>(
    event: K,
    listener: GraphEngineListener<K>,
  ): void;
}
