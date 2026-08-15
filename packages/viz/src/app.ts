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
  probe3D,
  viewFromSearch,
  type ViewKind,
} from "./engine/view.js";
import { renderErrorScreen } from "./error-screen.js";
import { publishHarnessHandle } from "./harness-handle.js";
import { loadAnalysis } from "./loader.js";

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
    onChange: (next) => {
      if (next === view) return;
      view = next;
      swapEngine();
    },
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
   * Stand up the engine for the current view, tearing down whatever was there.
   *
   * The document is re-loaded into the new engine rather than transplanted:
   * positions in a 3D layout have a third axis a 2D layout has no place for,
   * so there is nothing meaningful to carry across. Both layouts are seeded
   * from the same document (AD-6), so switching back and forth returns to the
   * *same* map every time rather than to a slightly different one.
   */
  function swapEngine(): void {
    teardown();

    const built = createViewEngine({ canvas: stage, view });
    engine = built.engine;
    // The switch reflects what was actually built, not what was asked for: a
    // 3D request that fell back must not leave "3D" looking selected.
    viewSwitch.setCurrent(built.view);
    viewSwitch.setUnavailable(built.reason);
    view = built.view;

    // Before `load()`: under reduced motion the settle is announced
    // synchronously inside it, and the harness has to be listening by then.
    publishHarnessHandle(engine);
    engine.load(analysis);
    disconnect = connectEngine(chrome, engine, {
      search,
      tooltip,
      analysis,
    });
  }

  // Constructed after `mountChrome` has put the stage in the document: the
  // engine measures the canvas on construction, and an unattached element
  // measures 0 × 0.
  try {
    swapEngine();
    // Offered only where it can actually run, with the reason attached when it
    // cannot (AC-5). Asked once here rather than per click, so the control is
    // never briefly enabled for a browser that will refuse it.
    if (view === "2d") viewSwitch.setUnavailable(probe3D(stage));
  } catch (cause) {
    // The loader's shape guard covers what the Viewer dereferences, but it is
    // a guard, not the schema. Anything it lets through that the engine still
    // cannot build becomes the FR-6 screen rather than a blank page with a
    // stack trace in the console.
    teardown();
    renderErrorScreen(root, {
      kind: "malformed",
      title: "analysis.json could not be rendered",
      detail: `The document loaded but the map could not be built from it: ${
        cause instanceof Error ? cause.message : String(cause)
      }. Re-run gitnebula to regenerate the file.`,
    });
    return null;
  }
  return engine;
}
