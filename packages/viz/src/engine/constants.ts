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
  // The contract's fifth layer, which the mockup's legend does not name. It
  // shared the infra grey until story 6.5, on the reasoning that a layer with
  // no legend key should not invent a hue. Story 5.3 then gave `other` a
  // filter toggle, and measured it as the LARGEST layer on this repository
  // (145 of 363 nodes, against infra's 3) — so the reader got a toggle whose
  // colour keyed to a different label, on 40% of the map.
  //
  // Two layers may no longer share a swatch; `legend.test.ts` now fails if any
  // two entries do. The departure from the mockup's four-layer palette is
  // deliberate and recorded in ADR-0008, which carries the measurements.
  other: "#cf81cf",
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

/**
 * Hover's resting opacities — what the map keeps while a chain is lit
 * (FR-29, story 5.2).
 *
 * The two constants above stay where they are and keep their values: they are
 * *isolate's* encoding, and isolate means "show me this and nothing else".
 * Hover cannot mean that. Measured on a real langgraph checkout, a hovered
 * node dims 647 of 650 nodes to `NODE_ALPHA_DIMMED`, because the median 1-hop
 * chain is 3 nodes — and at 6× zoom pointer hit-areas cover 78% of the
 * viewport, so the cursor is nearly always over something and the map strobes
 * as it moves. Dimming-as-mechanism does not survive that density; the chain
 * is carried by emphasis below instead.
 *
 * The values are the maintainer's decision, not a re-derivation.
 */
export const NODE_ALPHA_HOVER_REST = 0.55;
export const EDGE_ALPHA_HOVER_REST = 0.12;

/**
 * Chain emphasis under hover (story 5.2): the chain is found because it is
 * brighter and ringed, not because everything else went dark.
 *
 * The ring sits inside the selection ring's +5 px so the two never read as the
 * same mark — a hovered neighbour is not a selected node.
 */
export const CHAIN_GLOW_BOOST = 1.35;
export const CHAIN_RING_OFFSET_PX = 3;
export const CHAIN_RING_ALPHA = 0.5;

/**
 * How long a hover chain is held after the pointer leaves a node, in ms on the
 * frame clock (story 5.2, AC-3).
 *
 * A pointer sweeping a dense map crosses a few pixels of background between
 * two nodes. Dropping the chain on that frame and picking up the next one on
 * the following frame is precisely the flicker this story exists to remove, so
 * the previous chain is *held* across the gap and replaced the moment a new
 * node is hovered. This is a debounce, not a transition: nothing interpolates
 * and no drawn value is a function of elapsed time, which is why it is
 * unaffected by `prefers-reduced-motion` (AC-5, UX-DR11).
 *
 * An explicit `setHovered(null)` — `pointerleave`, or chrome clearing the
 * highlight — bypasses the hold entirely and restores full opacity at once
 * (AC-2).
 */
export const HOVER_CARRY_MS = 120;

/**
 * The blast-radius mark (story 5.6, AC-4): how a co-change partner is drawn.
 *
 * Co-change is **not** a dependency, and the story's binding context says
 * drawing it like one would tell the reader something false. So the encoding
 * is deliberately not an edge and not the chain's vocabulary either:
 *
 * - a **dashed** ring, where every other ring on the map is solid. The dash
 *   carries the distinction on its own, independently of hue — the same
 *   argument story 5.5 used for pairing an absent value with italics rather
 *   than trusting colour alone;
 * - **outside** the selection ring's +5 px, so a partner and the selected node
 *   never produce the same mark at the same radius;
 * - in a magenta the layer palette does not contain and the hot orange is not
 *   adjacent to, so the mark cannot be mistaken for a layer or a hot spot.
 */
export const COCHANGE_RING_COLOR = "#ff5fa2";
export const COCHANGE_RING_OFFSET_PX = 9;
export const COCHANGE_RING_ALPHA = 0.85;
export const COCHANGE_RING_WIDTH = 1.5;
/** Dash pattern in screen px — the mark's primary distinction. */
export const COCHANGE_RING_DASH: readonly number[] = [3, 4];

/** Quadratic control-point offset as a fraction of the edge vector (mockup). */
export const EDGE_CURVE = 0.13;

/** Camera fit must complete within 800 ms (AC-2); the mockup eases in 620 ms. */
export const FIT_DURATION_MS = 620;
/** Padding kept around the graph's bounds when fitting, in CSS px. */
export const FIT_PADDING_PX = 90;

/**
 * How far a press may travel and still count as a click rather than a drag
 * (story 3.4, AC-4). The mockup used any movement at all, which loses the
 * click to a hand tremor on a trackpad.
 */
export const CLICK_SLOP_PX = 4;

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
