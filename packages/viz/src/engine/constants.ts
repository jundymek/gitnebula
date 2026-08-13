/**
 * Every tunable the nebula's look and feel depends on, in one place.
 *
 * The values are the mockup's (`reference/mockup.html`) — it is the
 * behavioural reference for palette, glow, curve and threshold constants
 * (UX-DR1–5). Tests assert against these exports rather than against literals
 * copied a second time, so a change here is a change the suite sees.
 */

import type { Layer } from "@gitnebula/contract";

/** The void the nebula sits on (`--void`). */
export const VOID_COLOR = "#060911";

/** Layer colours, exactly the mockup's `LAYER_COLOR` (UX-DR1). */
export const LAYER_COLOR: Readonly<Record<Layer, string>> = {
  backend: "#3fcfa0",
  frontend: "#9b8cff",
  infra: "#7c8598",
  test: "#a8cf52",
  // The contract has a fifth layer the mockup's legend does not name; it
  // takes the infra grey rather than inventing a sixth hue.
  other: "#7c8598",
};

/** Hot-spot colour (`--hot`). In structure mode it REPLACES the layer colour. */
export const HOT_COLOR = "#ff7a3d";

/**
 * Default hot-spot threshold on normalized churn (ADR-0003, mockup
 * `HOT_THRESHOLD`). The pipeline carries its own `hotspotThreshold` in the
 * resolved `Config`, but that value never reaches `analysis.json` — so the
 * Viewer owns a default and takes an override through `EngineOptions`.
 */
export const HOT_THRESHOLD = 0.5;

/** Hot-spot pulse period in ms (UX-DR4). Suppressed under reduced motion. */
export const HOT_PULSE_MS = 380;

/** Zoom at which modules unfold into their files (ADR-0006; story 3.3). */
export const UNFOLD_ZOOM = 1.8;

/** Zoom at which file labels appear (ADR-0006; story 3.3). */
export const FILE_LABEL_ZOOM = 3.0;

/** Zoom clamp (FR-15). */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 6.0;

/** Wheel step, mockup's factors. */
export const ZOOM_IN_STEP = 1.12;
export const ZOOM_OUT_STEP = 0.89;

/**
 * Node radius: `base + √LOC / divisor` (UX-DR4, mockup `7 + √loc / 11`).
 * The file base is the mockup's lower bound; where the mockup jittered file
 * radii randomly, the contract gives every file a real LOC, so the same
 * √LOC term drives both and AD-6 keeps its promise that nothing is random
 * outside the seeded stream.
 */
export const MODULE_RADIUS_BASE = 7;
export const FILE_RADIUS_BASE = 1.5;
export const RADIUS_LOC_DIVISOR = 11;

/** Starfield: ~220 stars in two dot sizes (UX-DR3). */
export const STAR_COUNT = 220;
export const STAR_SMALL_RADIUS = 0.6;
export const STAR_LARGE_RADIUS = 1.1;
/** Share of stars drawn at the small size. */
export const STAR_SMALL_SHARE = 0.85;

/** Edge alphas (UX-DR5). Chain/dim levels belong to hover, which is 3.3. */
export const EDGE_ALPHA_BASE = 0.2;
export const EDGE_ALPHA_MEMBER = 0.08;
export const EDGE_ALPHA_CHAIN = 0.62;
export const EDGE_ALPHA_DIMMED = 0.03;
/** Node alpha for everything outside the focused chain (mockup `dim`). */
export const NODE_ALPHA_DIMMED = 0.1;

/** Quadratic control-point offset as a fraction of the edge vector (mockup). */
export const EDGE_CURVE = 0.13;

/** Camera fit must complete within 800 ms (AC-2); the mockup eases in 620 ms. */
export const FIT_DURATION_MS = 620;
/** Padding kept around the graph's bounds when fitting, in CSS px. */
export const FIT_PADDING_PX = 90;

/** Search fly-to duration and targets (mockup; story 3.3 consumes them). */
export const FLY_DURATION_MS = 620;
export const FLY_ZOOM_MODULE = 2.0;
export const FLY_ZOOM_FILE = 3.0;

/**
 * How long a search target pulses after the camera arrives (story 3.3).
 *
 * The pulse answers "which of these did I just land on?" — at 2.0× a module
 * arrives among neighbours, and the flight alone does not say which node was
 * the target. Suppressed under reduced motion, where the camera jumps and
 * there is no arrival to mark.
 */
export const PULSE_DURATION_MS = 900;
/** Peak extra radius of the arrival pulse ring, in screen px. */
export const PULSE_MAX_RADIUS_PX = 26;
