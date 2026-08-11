/**
 * The application wiring: load the document, mount the chrome, hand the stage
 * to the engine. Kept apart from `main.ts` so that importing the package does
 * not boot a viewer — `main.ts` is the entry with the side effect.
 */

import { connectEngine, mountChrome } from "./chrome/chrome.js";
import { createGraphEngine, type GraphEngine } from "./engine/index.js";
import { renderErrorScreen } from "./error-screen.js";
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
  const store = mountChrome(root, result.document, {
    stage,
    actions: { onReplay: () => engine?.replay() },
  });

  // Constructed after `mountChrome` has put the stage in the document: the
  // engine measures the canvas on construction, and an unattached element
  // measures 0 × 0.
  try {
    engine = createGraphEngine({ canvas: stage });
    connectEngine(store, engine);
    engine.load(result.document);
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
