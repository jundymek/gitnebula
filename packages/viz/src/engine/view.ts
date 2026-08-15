/**
 * Choosing a view, and degrading when the chosen one cannot be built (AC-5).
 *
 * **On AC-5's wording.** The criterion says "on a machine without working
 * WebGL". This 3D view does not use WebGL — it projects onto the same 2D
 * canvas the 2D view uses, which is exactly what the story's own Context
 * section praises the prototype for proving. The criterion was written against
 * the Three.js design that prototype talked us out of, so a literal WebGL
 * probe would test a dependency the implementation deliberately does not have.
 *
 * What is implemented is the criterion's *intent*, which is unambiguous under
 * either reading: **if 3D cannot be built, the user gets the 2D map with a
 * stated reason, never a blank canvas.** A missing or refused rendering
 * context is one failure case among several; so is a browser without
 * `requestAnimationFrame`, and so is any error the 3D constructor throws.
 * See `DECISIONS.md` D4.
 *
 * The fallback is a *degradation*, not an error: product principle 1 says the
 * tool always produces a useful result, so the reason is something the chrome
 * can show beside a working map rather than a screen the map is replaced by.
 */

import { createGraphEngine } from "./engine.js";
import { createNebula3DEngine, type Engine3DOptions } from "./engine3d.js";
import type { EngineOptions, GraphEngine } from "./types.js";

/** The views the viewer can be in. 2D is the default everywhere (AC-1). */
export type ViewKind = "2d" | "3d";

export const DEFAULT_VIEW: ViewKind = "2d";

export function isViewKind(value: unknown): value is ViewKind {
  return value === "2d" || value === "3d";
}

/**
 * Read the requested view from a URL.
 *
 * `?view=3d` makes the 3D view linkable and is how the perf harness and a
 * human reproduce a 3D run (`DECISIONS.md` D6). Anything unrecognised — and
 * anything absent — is 2D, because the default has to survive a typo.
 */
export function viewFromSearch(search: string): ViewKind {
  try {
    const value = new URLSearchParams(search).get("view");
    return isViewKind(value) ? value : DEFAULT_VIEW;
  } catch {
    // A malformed query string is not a reason to fail to draw a map.
    return DEFAULT_VIEW;
  }
}

/** What `createViewEngine` produced, and whether it had to fall back. */
export interface ViewEngineResult {
  readonly engine: GraphEngine;
  /** The view actually built — not necessarily the one requested. */
  readonly view: ViewKind;
  /**
   * Why the requested view could not be built, or null when it was.
   *
   * A sentence for a person, not an error code: it is shown in the chrome
   * beside a working 2D map, and "3D is unavailable" without a reason is the
   * kind of message that makes a user think the app is broken.
   */
  readonly reason: string | null;
}

/**
 * Probe whether the 3D view can run at all, before anything is constructed.
 *
 * Split from construction so the switch can be *disabled with a reason* rather
 * than offered and then silently refused — a control that does nothing when
 * clicked is worse than one that explains why it is off.
 */
export function probe3D(canvas: HTMLCanvasElement): string | null {
  let ctx: unknown;
  try {
    ctx = canvas.getContext("2d");
  } catch (cause) {
    return `3D needs a 2D canvas context, and this browser refused one (${
      cause instanceof Error ? cause.message : String(cause)
    }). Showing the 2D map instead.`;
  }
  if (!ctx) {
    return (
      "3D needs a 2D canvas context and this browser did not provide one — " +
      "canvas may be blocked by a privacy setting or an extension. " +
      "Showing the 2D map instead."
    );
  }
  if (typeof globalThis.requestAnimationFrame !== "function") {
    return (
      "3D needs requestAnimationFrame to drive its camera, and this browser " +
      "does not provide it. Showing the 2D map instead."
    );
  }
  return null;
}

export interface CreateViewEngineOptions extends Engine3DOptions {
  /** Which view to build. Defaults to 2D. */
  readonly view?: ViewKind;
  /** Injection point for tests: overrides the built-in probe. */
  readonly probe?: (canvas: HTMLCanvasElement) => string | null;
  /** Injection point for tests: overrides the 3D constructor. */
  readonly create3D?: (options: Engine3DOptions) => GraphEngine;
}

/**
 * Build the requested view, degrading to 2D with a stated reason (AC-5).
 *
 * Both 3D failure routes end in the same place. The probe catches what can be
 * known in advance; the `catch` catches a 3D constructor that threw anyway,
 * because a probe that passed is a prediction and not a guarantee. Either way
 * the caller gets a *working 2D engine* — never null, never a blank canvas.
 *
 * **What this deliberately does not do** is swallow a failure of the 2D engine
 * itself. If the 2D map cannot be built either — no canvas context at all —
 * there is nothing left to degrade *to*, and pretending otherwise would hand
 * the caller a dead engine that satisfies a null check and draws nothing. That
 * error propagates, and `app.ts` turns it into the FR-6 error screen, which
 * explains the situation instead of showing an empty page. Degradation and
 * total failure are different outcomes and are reported differently.
 */
export function createViewEngine(
  options: CreateViewEngineOptions,
): ViewEngineResult {
  const view = options.view ?? DEFAULT_VIEW;
  const engineOptions: EngineOptions = options;

  if (view !== "3d") {
    return {
      engine: createGraphEngine(engineOptions),
      view: "2d",
      reason: null,
    };
  }

  const fallbackTo2D = (reason: string): ViewEngineResult => ({
    engine: createGraphEngine(engineOptions),
    view: "2d",
    reason,
  });

  const probe = options.probe ?? probe3D;
  const blocked = probe(options.canvas);
  if (blocked !== null) return fallbackTo2D(blocked);

  try {
    const create = options.create3D ?? createNebula3DEngine;
    return { engine: create(options), view: "3d", reason: null };
  } catch (cause) {
    return fallbackTo2D(
      `The 3D view could not be started (${
        cause instanceof Error ? cause.message : String(cause)
      }). Showing the 2D map instead.`,
    );
  }
}
