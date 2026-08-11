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
  engine = createGraphEngine({ canvas: stage });
  connectEngine(store, engine);
  engine.load(result.document);
  return engine;
}
