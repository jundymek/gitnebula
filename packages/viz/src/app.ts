/**
 * The application wiring: load the document, mount the chrome, hand the stage
 * to the engine. Kept apart from `main.ts` so that importing the package does
 * not boot a viewer — `main.ts` is the entry with the side effect.
 */

import { connectEngine, mountChrome } from "./chrome/chrome.js";
import { createSearchBox } from "./chrome/search.js";
import { createTooltip } from "./chrome/tooltip.js";
import { createGraphEngine, type GraphEngine } from "./engine/index.js";
import { renderErrorScreen } from "./error-screen.js";
import { publishHarnessHandle } from "./harness-handle.js";
import { loadAnalysis } from "./loader.js";

export async function boot(root: Element): Promise<GraphEngine | null> {
  const result = await loadAnalysis();
  if (!result.ok) {
    renderErrorScreen(root, result.failure);
    return null;
  }

  const stage = document.createElement("canvas");
  stage.id = "stage";

  let engine: GraphEngine | null = null;
  // Search asks the engine to fly; the engine selects on arrival and emits
  // `select`, which is what opens the panel. Chrome never moves the camera by
  // hand (AD-5).
  const search = createSearchBox({
    onSelect: (id) => void engine?.flyTo(id),
  });
  const tooltip = createTooltip();
  const store = mountChrome(root, result.document, {
    stage,
    actions: { onReplay: () => engine?.replay() },
    overlays: [search.element, tooltip.element],
  });

  // Constructed after `mountChrome` has put the stage in the document: the
  // engine measures the canvas on construction, and an unattached element
  // measures 0 × 0.
  try {
    engine = createGraphEngine({ canvas: stage });
    // Before `load()`: the settle is announced synchronously inside it under
    // reduced motion, and the harness has to be listening by then.
    publishHarnessHandle(engine);
    engine.load(result.document);
    // After `load`, so the search corpus is the document's node set rather
    // than the empty one an unloaded engine reports.
    connectEngine(store, engine, { search, tooltip });
  } catch (cause) {
    // The loader's shape guard covers what the Viewer dereferences, but it is
    // a guard, not the schema. Anything it lets through that the engine still
    // cannot build becomes the FR-6 screen rather than a blank page with a
    // stack trace in the console.
    engine?.destroy();
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
