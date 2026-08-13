// @gitnebula/viz — the browser viewer: GraphEngine + chrome (AD-5).
// viz depends on the contract and its fixtures — never on the analyzers.

import { packageName as contractPackageName } from "@gitnebula/contract";

export const packageName = "@gitnebula/viz";
export const contractEdge = contractPackageName;

export { boot } from "./app.js";
export { ANALYSIS_URL, checkVersion, loadAnalysis } from "./loader.js";
export type { LoadFailure, LoadFailureKind, LoadResult } from "./loader.js";
export { renderErrorScreen } from "./error-screen.js";

export {
  CanvasGraphEngine,
  createGraphEngine,
  FILE_LABEL_ZOOM,
  HOT_COLOR,
  HOT_PULSE_MS,
  HOT_THRESHOLD,
  LAYER_COLOR,
  MAX_ZOOM,
  MIN_ZOOM,
  SETTLE_DISPLACEMENT_PX,
  SETTLE_FRAMES,
  UNFOLD_ZOOM,
  VOID_COLOR,
} from "./engine/index.js";

export type {
  CameraState,
  EngineNode,
  EngineOptions,
  GraphEngine,
  GraphEngineEvent,
  GraphEngineEventMap,
  ScreenPoint,
  ViewMode,
} from "./engine/index.js";
