/**
 * The one seam the performance harness needs (story 3.5, AC-3).
 *
 * The Playwright harness has to drive the *real* engine — story 1.4's spike
 * measured a stand-in simulation, and the whole point of productionising it is
 * that the number now describes what ships. Driving it from outside means the
 * page must hand the engine out somewhere, so it hands it out here, in one
 * named place, rather than by the harness reaching into module internals.
 *
 * It is deliberately not a feature: no UI reaches it, nothing in `viz` reads
 * it, and it exposes only what the AD-5 interface already exposes to chrome.
 * Removing this file would break the harness and nothing else.
 */

import type { GraphEngine } from "./engine/index.js";

export const HARNESS_HANDLE_KEY = "__gitnebula";

export interface HarnessHandle {
  readonly engine: GraphEngine;
  /**
   * Resolves when the layout reaches Settled (AD-6). Subscribed *before*
   * `load()`, because under `prefers-reduced-motion` the settle is announced
   * synchronously inside it — a harness that subscribed afterwards would wait
   * forever for an event that already happened.
   */
  readonly settled: Promise<{ frames: number; durationMs: number }>;
}

export function publishHarnessHandle(engine: GraphEngine): void {
  const settled = new Promise<{ frames: number; durationMs: number }>(
    (resolve) => {
      const off = engine.on("settled", (payload) => {
        off();
        resolve({ frames: payload.frames, durationMs: payload.durationMs });
      });
    },
  );
  (globalThis as unknown as Record<string, HarnessHandle>)[HARNESS_HANDLE_KEY] =
    { engine, settled };
}
