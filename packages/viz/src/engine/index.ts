/**
 * The engine's public face — and the ONLY engine module chrome may import
 * (AD-5). Everything reachable from here is either the interface, an event
 * type, or an encoding constant chrome needs to draw a legend swatch that
 * matches the canvas.
 *
 * `src/chrome/boundary.test.ts` fails the build if a chrome file reaches past
 * this barrel into `engine/render.js`, `engine/layout.js` or a canvas API.
 */

export { createGraphEngine, CanvasGraphEngine } from "./engine.js";

/**
 * The 3D view (story 5.7) — a second implementation of the same interface,
 * reached through the same barrel. `app.ts` picks between them via
 * `createViewEngine`, which is also where the AC-5 fallback lives; chrome
 * never names either constructor.
 */
export { createNebula3DEngine, Nebula3DEngine } from "./engine3d.js";
export {
  createViewEngine,
  DEFAULT_VIEW,
  isViewKind,
  probe3D,
  viewFromSearch,
  type ViewEngineResult,
  type ViewKind,
} from "./view.js";

export {
  FILE_LABEL_ZOOM,
  HOT_COLOR,
  HOT_PULSE_MS,
  HOT_THRESHOLD,
  LAYER_COLOR,
  MAX_ZOOM,
  MIN_ZOOM,
  UNFOLD_ZOOM,
  VOID_COLOR,
} from "./constants.js";

export { SETTLE_DISPLACEMENT_PX, SETTLE_FRAMES } from "./settle.js";

/**
 * The search box's ranking (story 3.3). It lives engine-side because it is
 * pure scoring over node ids with no DOM in it, and chrome reaches it through
 * this barrel like everything else.
 */
export { fuzzySearch, scoreMatch, type FuzzyMatch } from "./fuzzy.js";

export { hashString, seedFor } from "./prng.js";

/**
 * Story 5.6's co-change mark. Exported for the same reason the layer colours
 * are: chrome describes the mark in the panel, and a swatch that drifts from
 * the canvas is worse than no swatch.
 */
export {
  COCHANGE_RING_ALPHA,
  COCHANGE_RING_COLOR,
  COCHANGE_RING_DASH,
  COCHANGE_RING_OFFSET_PX,
  COCHANGE_RING_WIDTH,
} from "./constants.js";

/**
 * Story 5.3's layer list. The filter control draws one toggle per entry, so
 * the order it renders in and the order the engine defaults to are one
 * constant rather than two that can drift.
 */
export { ALL_LAYERS, LAYER_LABEL, isLayer } from "./layers.js";

export type {
  CameraState,
  EngineNode,
  EngineOptions,
  ExportPngOptions,
  FitOptions,
  FlyToOptions,
  GraphEngine,
  GraphEngineEvent,
  GraphEngineEventMap,
  GraphEngineListener,
  ScreenPoint,
  ViewMode,
} from "./types.js";
