/**
 * The application wiring: load the document, mount the chrome, hand the stage
 * to the engine. Kept apart from `main.ts` so that importing the package does
 * not boot a viewer — `main.ts` is the entry with the side effect.
 *
 * Story 5.7 makes this the owner of the **view swap**. Chrome cannot build an
 * engine — it may not name a canvas (`boundary.test.ts`) — so the 2D/3D switch
 * reports a click and this module tears the old engine down and stands the new
 * one up behind the same interface. 2D remains the default (AC-1).
 */

import { connectEngine, mountChrome } from "./chrome/chrome.js";
import { createSearchBox } from "./chrome/search.js";
import { createTooltip } from "./chrome/tooltip.js";
import { renderViewSwitch } from "./chrome/view-switch.js";
import { type GraphEngine } from "./engine/index.js";
import {
  createViewEngine,
  DEFAULT_VIEW,
  probe3D,
  viewFromSearch,
  type ViewKind,
} from "./engine/view.js";
import { renderErrorScreen } from "./error-screen.js";
import { publishHarnessHandle } from "./harness-handle.js";
import { loadAnalysis } from "./loader.js";

/**
 * What the 3D button should say after a swap: a reason (disabled) or null
 * (offered).
 *
 * A reason produced by `createViewEngine` always wins — it describes a 3D view
 * that was actually attempted and failed, which is strictly better evidence
 * than a probe. The probe is only consulted when 3D was *not* attempted.
 *
 * Extracted as a pure function because the bug it encodes was an ordering
 * mistake rather than a logic one, and an ordering mistake inside `boot()` —
 * which needs a document fetch to run at all — is exactly the kind that gets
 * re-introduced. Here it is directly testable.
 */
export function unavailabilityAfterSwap(
  built: { readonly view: ViewKind; readonly reason: string | null },
  probe: () => string | null,
): string | null {
  if (built.reason !== null) return built.reason;
  return built.view === "2d" ? probe() : null;
}

/**
 * The outcome of a reader-initiated view change.
 *
 * `"switched"` — the requested view is running.
 * `"kept"` — it failed and the previous view was restored, with a reason.
 * `"broken"` — neither could be built; the caller shows the error screen.
 */
export type ViewChangeOutcome = "switched" | "kept" | "broken";

/**
 * Try to switch views, falling back to the view that was working.
 *
 * Extracted from `boot()` and pure over its two callbacks, because the defect
 * it encodes is a *sequencing* one: the engine is destroyed before the
 * replacement exists, so a throw after that point leaves nothing drawing.
 * Testing it inside `boot()` would need a document fetch and a canvas; here
 * the policy is asserted directly.
 *
 * `attempt` is called with the view to build and may throw. It is called at
 * most twice — once for `next`, once for `previous` — and exactly once when
 * the two are the same view, since there is then nothing to fall back to.
 */
export function swapWithFallback(
  next: ViewKind,
  previous: ViewKind,
  attempt: (view: ViewKind) => void,
): { outcome: ViewChangeOutcome; view: ViewKind; cause: unknown } {
  try {
    attempt(next);
    return { outcome: "switched", view: next, cause: null };
  } catch (cause) {
    // Nothing else to try: retrying the same view would just fail again, and
    // twice is not more informative than once.
    if (previous === next) return { outcome: "broken", view: previous, cause };
    try {
      attempt(previous);
      return { outcome: "kept", view: previous, cause };
    } catch {
      // The original cause is reported, not the second: it describes the
      // actual problem, where the second is a consequence of it.
      return { outcome: "broken", view: previous, cause };
    }
  }
}

export async function boot(root: Element): Promise<GraphEngine | null> {
  const result = await loadAnalysis();
  if (!result.ok) {
    renderErrorScreen(root, result.failure);
    return null;
  }

  // Captured once, after the guard: the narrowing of `result` does not reach
  // inside `swapEngine`, which is called again on every view change.
  const analysis = result.document;

  const stage = document.createElement("canvas");
  stage.id = "stage";

  let engine: GraphEngine | null = null;
  let disconnect: (() => void) | null = null;
  // `?view=3d` makes the 3D view linkable and is how the perf harness and a
  // human reproduce a 3D run. Anything unrecognised is 2D.
  let view: ViewKind = viewFromSearch(globalThis.location?.search ?? "");

  const search = createSearchBox({
    onSelect: (id) => void engine?.flyTo(id),
  });
  const tooltip = createTooltip();

  const viewSwitch = renderViewSwitch({
    current: view,
    onChange: (next) => requestView(next),
  });

  const chrome = mountChrome(root, analysis, {
    stage,
    actions: { onReplay: () => engine?.replay() },
    overlays: [search.element, tooltip.element],
    viewSwitch: viewSwitch.element,
  });

  /** Drop the current engine and its chrome subscriptions, in that order. */
  const teardown = (): void => {
    disconnect?.();
    disconnect = null;
    engine?.destroy();
    engine = null;
  };

  /**
   * What a view change must **not** silently discard.
   *
   * A view switch changes how the graph is drawn, not what the reader is
   * looking at. Without this, flipping to 3D would quietly reset the view
   * mode, the layer filter, the scope, and any selection or isolate — the
   * reader would lose the frame they had built up and be told nothing. Every
   * field here is read and re-applied **through the `GraphEngine` interface**,
   * which is also the neatest demonstration that the seam is real: the state
   * is portable precisely because neither engine owns its definition.
   *
   * Positions are deliberately *not* carried across: a 3D layout has a third
   * axis a 2D layout has no place for. Both are seeded from the same document
   * (AD-6), so switching back and forth returns to the same map every time.
   */
  interface CarriedState {
    readonly mode: ReturnType<GraphEngine["getMode"]>;
    readonly layers: readonly Parameters<
      GraphEngine["setLayerFilter"]
    >[0][number][];
    readonly scopeId: string | null;
    readonly connectedOnly: boolean;
    readonly selectedId: string | null;
    readonly isolatedId: string | null;
    /**
     * Story 5.6's co-change mark. This story argued that a blast radius which
     * vanished on the view switch would falsify the claim that both views are
     * the same map — which is why 3D *draws* the mark instead of merely
     * storing it. Dropping it here would have reintroduced the same defect one
     * layer up, with the panel still implying the radius was active.
     */
    readonly blastRadius: readonly string[];
  }

  const captureState = (from: GraphEngine): CarriedState => ({
    mode: from.getMode(),
    layers: [...from.getLayerFilter()],
    scopeId: from.getScope(),
    connectedOnly: from.getConnectedOnly(),
    selectedId: from.getSelected()?.id ?? null,
    isolatedId: from.getIsolated()?.id ?? null,
    blastRadius: [...from.getBlastRadius()],
  });

  const restoreState = (to: GraphEngine, state: CarriedState): void => {
    // Order matters. Mode and the two filters first, because they decide what
    // is in the frame; selection and isolate last, because an engine drops
    // interaction state whose node the filters have removed — restoring them
    // first would just have them reconciled away again.
    to.setMode(state.mode);
    to.setLayerFilter(state.layers);
    to.setScope(state.scopeId);
    to.setConnectedOnly(state.connectedOnly);
    // A node hidden by the restored filters is not selectable; the engine
    // reconciles that itself, so this is safe to ask for unconditionally.
    if (state.selectedId !== null) to.setSelected(state.selectedId);
    if (state.isolatedId !== null) to.setIsolated(state.isolatedId);
    // Restored unconditionally: an empty set is the correct "nothing marked"
    // instruction, and `setBlastRadius` treats `[]` and `null` alike.
    to.setBlastRadius(state.blastRadius);
  };

  /**
   * Stand up the engine for the current view, tearing down whatever was there
   * and carrying the reader's state across.
   */
  function swapEngine(carriedIn?: CarriedState | null): void {
    // `carriedIn` lets a caller capture the state *before* a first attempt, so
    // a retry after a failed swap can still restore the reader's frame — by
    // then the engine it would have been read from is already destroyed.
    const carried = carriedIn ?? (engine ? captureState(engine) : null);
    teardown();

    const built = createViewEngine({ canvas: stage, view });
    engine = built.engine;
    // The switch reflects what was actually built, not what was asked for: a
    // 3D request that fell back must not leave "3D" looking selected.
    viewSwitch.setCurrent(built.view);
    view = built.view;
    // Probing unconditionally after the swap re-enabled the button and erased
    // the constructor's reason in exactly the case AC-5 exists for:
    // `?view=3d`, probe passes, constructor throws, fall back to 2D — and the
    // reader was shown an enabled 3D button and no explanation.
    viewSwitch.setUnavailable(
      unavailabilityAfterSwap(built, () => probe3D(stage)),
    );

    // Before `load()`: under reduced motion the settle is announced
    // synchronously inside it, and the harness has to be listening by then.
    publishHarnessHandle(engine);
    engine.load(analysis);
    // After `load()`, which resets interaction state by design, and before
    // `connectEngine`, so the chrome reads the restored state on connect
    // rather than the defaults followed by a flurry of change events.
    if (carried) restoreState(engine, carried);
    disconnect = connectEngine(chrome, engine, {
      search,
      tooltip,
      analysis,
      // The search box is shared across engines and outlives any one of them.
      destroyControls: false,
    });
  }

  /**
   * A reader-initiated view change, which — unlike the boot-time swap — must
   * not be able to leave the viewer without a working map.
   *
   * `swapEngine` destroys the old engine before building the new one, so a
   * throw anywhere after that point (construction, `load()`, restoring state)
   * would otherwise leave a canvas with nothing drawing on it, and a toggle
   * that had already recorded the new view and so treated the next click as a
   * no-op. The reader would be left with a dead map and no way back.
   *
   * So a failed swap **falls back to the view that was working**, carrying the
   * state captured before the attempt and saying why the other view is now
   * unavailable. Only if that also fails — nothing can be drawn at all — does
   * this reach the FR-6 error screen.
   */
  function requestView(next: ViewKind): void {
    if (next === view) return;
    const previous = view;
    // Captured before the first attempt: `swapEngine` tears the old engine
    // down, so after a failure there is nothing left to read it from.
    const carried = engine ? captureState(engine) : null;

    const result = swapWithFallback(next, previous, (target) => {
      view = target;
      swapEngine(carried);
    });

    if (result.outcome === "switched") return;

    const because =
      result.cause instanceof Error
        ? result.cause.message
        : String(result.cause);

    if (result.outcome === "kept") {
      viewSwitch.setUnavailable(
        `The ${next.toUpperCase()} view could not be started (${because}). ` +
          `Staying in ${previous.toUpperCase()}.`,
      );
      return;
    }

    teardown();
    renderErrorScreen(root, {
      kind: "malformed",
      title: "The map could not be redrawn",
      detail:
        `Switching to the ${next.toUpperCase()} view failed and the previous ` +
        `view could not be restored: ${because}. Reload the page to start again.`,
    });
  }

  // Constructed after `mountChrome` has put the stage in the document: the
  // engine measures the canvas on construction, and an unattached element
  // measures 0 × 0.
  //
  // The boot path takes the **same** fallback policy as a reader-initiated
  // change, and for the same reason. `createViewEngine` only guards its own
  // construction, so opening `?view=3d` on a document that 3D can build but
  // cannot `load()` would otherwise replace a perfectly renderable 2D map with
  // an error screen — the opposite of AC-5, reached by the one path AC-5 did
  // not cover. When the requested view is already 2D there is nothing to fall
  // back to and this behaves exactly as it did before.
  const booted = swapWithFallback(view, DEFAULT_VIEW, (target) => {
    view = target;
    swapEngine();
  });

  if (booted.outcome === "broken") {
    // The loader's shape guard covers what the Viewer dereferences, but it is
    // a guard, not the schema. Anything it lets through that no engine can
    // build becomes the FR-6 screen rather than a blank page with a stack
    // trace in the console.
    teardown();
    renderErrorScreen(root, {
      kind: "malformed",
      title: "analysis.json could not be rendered",
      detail: `The document loaded but the map could not be built from it: ${
        booted.cause instanceof Error
          ? booted.cause.message
          : String(booted.cause)
      }. Re-run gitnebula to regenerate the file.`,
    });
    return null;
  }

  if (booted.outcome === "kept") {
    // 3D was asked for and could not be built, but 2D could. That is a
    // degradation with a stated reason, not a failure (AC-5).
    viewSwitch.setUnavailable(
      `The 3D view could not be started (${
        booted.cause instanceof Error
          ? booted.cause.message
          : String(booted.cause)
      }). Showing the 2D map instead.`,
    );
  }

  return engine;
}
