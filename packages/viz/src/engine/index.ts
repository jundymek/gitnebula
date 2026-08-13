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
