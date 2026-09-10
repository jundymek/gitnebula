import { expect, test } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";

/**
 * Story 6.1 — the skeleton, and the proof that it can fail.
 *
 * **This file adds no behavioural coverage, on purpose.** The readouts are
 * already asserted by ~318 jsdom tests across `src/chrome/`, driving the
 * components with fake engines; fps, export parity and reduced motion are
 * already asserted by `perf/`; the built artefact by `bundle/`. What none of
 * them prove is that *this* suite — its config, its port, its server, its
 * fixture, its helper — actually reaches a booted Viewer. That is the whole
 * claim made here, and the negative control below is what makes the claim
 * worth anything.
 *
 * Wave B (6.2, 6.3, 6.4) writes its specs beside this one and inherits the
 * pattern: `openViewer` rather than `page.goto`, `HARNESS_HANDLE_KEY` rather
 * than the literal, and a prose message on every `expect`.
 */

/** How long a deliberately wrong wait is given before it is called a failure. */
const NEGATIVE_CONTROL_TIMEOUT_MS = 5_000;

test("the harness reaches a booted Viewer and the layout settles", async ({
  page,
}) => {
  await openViewer(page);

  const settled = await page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        { settled: Promise<{ frames: number; durationMs: number }> }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    return handle.settled;
  }, HARNESS_HANDLE_KEY);

  // Both numbers come from the engine's own `settled` event (AD-6). The
  // assertion is deliberately weak — that the layout ran at all — because
  // anything stronger is a behavioural claim, and behavioural claims are wave
  // B's to make. What this pins is that the handle exists and resolves.
  expect(
    settled.frames,
    "the layout settled without running a single frame — the harness reached " +
      "a page, but not a Viewer that laid anything out",
  ).toBeGreaterThan(0);
  expect(
    settled.durationMs,
    "the settle reported a non-positive duration, which no real settle can",
  ).toBeGreaterThan(0);
});

test("the suite serves the fixture its config names, not the dev default", async ({
  page,
}) => {
  await openViewer(page);

  const repoName = await page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: { nodes: ReadonlyArray<{ id: string }> };
          settled: Promise<unknown>;
        }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    await handle.settled;
    return document.querySelector("header .repo")?.textContent ?? "";
  }, HARNESS_HANDLE_KEY);

  // `webServer.env` pins GITNEBULA_FIXTURE=root-files. Without it the dev
  // server serves `synthetic-100x2000`, and every wave B assertion written
  // against a 6-node document would be run against a 2,000-file one — slowly,
  // and wrongly, while still looking like a normal run. That is exactly the
  // silent-fallback failure story 1.4 learned from, so it is pinned here
  // rather than trusted.
  expect(
    repoName,
    "the page is not serving the `root-files` fixture the config names — " +
      "check GITNEBULA_FIXTURE in ui/playwright.config.ts",
  ).toContain("root-files");
});

test("the smoke check can fail: the same wait, given a key that is not the handle", async ({
  page,
}) => {
  // The assertion above is only worth as much as its ability to go red. It
  // passes because `openViewer` waits for a key to appear on `globalThis`; if
  // that wait would resolve for *any* key, it would be proving nothing about
  // the Viewer and every spec built on it would be decoration.
  //
  // So: the identical wait, one input deliberately falsified. This is the
  // shape `perf/tests/export.pw.ts:165` uses — feed the positive assertion's
  // own machinery a wrong input and require it not to pass.
  await openViewer(page);

  const wrongKey = `${HARNESS_HANDLE_KEY}__not_the_handle`;
  const settledForWrongKey = await page
    .waitForFunction((key) => key in globalThis, wrongKey, {
      timeout: NEGATIVE_CONTROL_TIMEOUT_MS,
    })
    .then(() => true)
    .catch(() => false);

  expect(
    settledForWrongKey,
    `waiting for globalThis.${wrongKey} succeeded on a booted page — the ` +
      "handle wait resolves for keys the Viewer never publishes, so the " +
      "positive smoke assertion proves nothing",
  ).toBe(false);

  // And the real key still resolves on that same page, so the control above
  // demonstrates a discriminating check rather than a broken one.
  const realKeyPresent = await page.evaluate(
    (key) => key in globalThis,
    HARNESS_HANDLE_KEY,
  );
  expect(
    realKeyPresent,
    "the real harness handle was absent from the very page the negative " +
      "control ran against, which would make the control vacuous",
  ).toBe(true);
});
