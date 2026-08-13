/**
 * Shared page-side plumbing for the harness specs.
 *
 * `page.goto` resolves on the load event, but the Viewer boots asynchronously
 * — it fetches `analysis.json` before it can build an engine — so the harness
 * handle appears some time *after* the navigation resolves. Evaluating against
 * it straight away is a race that fails as
 * `TypeError: Cannot read properties of undefined`, intermittently, in
 * whichever spec happened to win the scheduler that run. Waiting for the
 * handle is the fix, and it belongs in one place.
 */

import type { Page } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";

/** Navigate and wait until the Viewer has published its engine. */
export async function openViewer(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    (key) => key in globalThis,
    HARNESS_HANDLE_KEY,
    // Generous: a cold Vite dev server transforms the whole module graph on
    // the first request, and this is not the thing being measured.
    { timeout: 60_000 },
  );
}
