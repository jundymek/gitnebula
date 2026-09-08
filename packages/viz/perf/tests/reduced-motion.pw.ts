import { expect, test, type Page } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";

/**
 * AC-5 — the `prefers-reduced-motion` audit (NFR-7, AD-6).
 *
 * Three behaviours are in scope, owned by three different stories: the settle
 * animation and the hot-spot pulse (2.5, merged), and the search fly-to (3.3,
 * in flight beside this one). The audit asserts on what is present and records
 * a reason for what is not — a green suite that quietly skipped a check is
 * worse than a red one.
 *
 * Where a violation is found in a peer's merged code, AC-5 says to file a
 * follow-up rather than to fix it across territory.
 */

const STILLNESS_MS = 700;

/**
 * The preference is emulated with an explicit `page.emulateMedia` rather than
 * the `reducedMotion` fixture option. On this Playwright build the fixture
 * option never reached `matchMedia` in the page: the audit ran green against
 * an *unemulated* browser, which is precisely the failure this file exists to
 * catch. The explicit call was verified to work, and the assertion below makes
 * a future regression of the same kind fail loudly instead of silently.
 */
async function settleAndFit(
  page: Page,
  reducedMotion: "reduce" | "no-preference",
): Promise<{
  frames: number;
  durationMs: number;
}> {
  await page.emulateMedia({ reducedMotion });
  await openViewer(page);
  const emulated = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(
    emulated,
    "prefers-reduced-motion emulation did not reach the page — every " +
      "assertion in this file would then be about the wrong browser",
  ).toBe(reducedMotion === "reduce");
  return page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: { fit(): Promise<void> };
          settled: Promise<{ frames: number; durationMs: number }>;
        }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    const settled = await handle.settled;
    await handle.engine.fit();
    return settled;
  }, HARNESS_HANDLE_KEY);
}

/** Two shots of the canvas, `STILLNESS_MS` apart, with no input in between. */
async function stillnessPair(page: Page): Promise<[Buffer, Buffer]> {
  const stage = page.locator("#stage");
  const first = await stage.screenshot();
  await page.waitForTimeout(STILLNESS_MS);
  const second = await stage.screenshot();
  return [first, second];
}

test.describe("under prefers-reduced-motion: reduce", () => {
  test("the first frame is already settled — no settle animation (AD-6)", async ({
    page,
  }) => {
    const settled = await settleAndFit(page, "reduce");

    // The engine runs the layout to Settled inside `load()` and announces it
    // with a zero duration: determinism is untouched (same seed, same ticks),
    // only the animation is skipped.
    expect(settled.durationMs).toBe(0);
    expect(
      settled.frames,
      "the layout still converges — reduced motion skips the animation, not the work",
    ).toBeGreaterThan(0);

    // And the camera does not fly: it is where it will stay from frame one.
    const cameras = await page.evaluate(async (key) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          { engine: { getCamera(): { x: number; y: number; k: number } } }
        >
      )[key];
      if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
      const samples: { x: number; y: number; k: number }[] = [];
      for (let i = 0; i < 20; i++) {
        samples.push(handle.engine.getCamera());
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return samples;
    }, HARNESS_HANDLE_KEY);
    expect(new Set(cameras.map((c) => `${c.x},${c.y},${c.k}`)).size).toBe(1);
  });

  test("hot spots do not pulse — the canvas is byte-identical over time", async ({
    page,
  }) => {
    await settleAndFit(page, "reduce");
    const [first, second] = await stillnessPair(page);
    expect(
      first.equals(second),
      `the canvas changed over ${STILLNESS_MS} ms with no input — something is still animating`,
    ).toBe(true);
  });

  test("search fly-to is instant (3.3's behaviour, audited here)", async ({
    page,
  }, testInfo) => {
    await settleAndFit(page, "reduce");

    const probe = await page.evaluate(async (key) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: {
              nodes: readonly { id: string; kind: string }[];
              flyTo(id: string): Promise<void>;
              getCamera(): { x: number; y: number; k: number };
            };
          }
        >
      )[key];
      if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
      const target = handle.engine.nodes.find((n) => n.kind === "module")!;
      const before = handle.engine.getCamera();
      // The rejection is captured at the moment the promise is created rather
      // than at an `await` a frame later: an unimplemented member rejects
      // immediately, and a rejection left unhandled for a frame is reported as
      // a page error, which the fps spec treats as a failed run.
      let failure: string | null = null;
      const flight = handle.engine.flyTo(target.id).catch((error: unknown) => {
        failure = error instanceof Error ? error.message : String(error);
      });
      // One frame later the camera must already be at its destination: an
      // eased flight would still be in transit here.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const afterOneFrame = handle.engine.getCamera();
      await flight;
      if (failure !== null) {
        return {
          implemented: false,
          message: failure as string,
          before,
          afterOneFrame: before,
          afterFlight: before,
        };
      }
      return {
        implemented: true,
        message: "",
        before,
        afterOneFrame,
        afterFlight: handle.engine.getCamera(),
      };
    }, HARNESS_HANDLE_KEY);

    if (!probe.implemented) {
      // Not a silent skip: the reason is recorded on the run, and the story
      // that owns the member is named in the engine's own error message.
      testInfo.annotations.push({
        type: "not-audited",
        description:
          `flyTo is not implemented on this branch — ${probe.message}. ` +
          "Story 3.3 owns it; re-run this audit once 3.3 is merged into the epic branch.",
      });
      test.skip(true, `flyTo unimplemented: ${probe.message}`);
      return;
    }

    expect(
      probe.afterOneFrame,
      "the camera should arrive immediately, not ease into place",
    ).toEqual(probe.afterFlight);
    expect(probe.afterFlight).not.toEqual(probe.before);
  });
});

test.describe("control: without the preference, the map does animate", () => {
  test("the hot-spot pulse is visible, so the stillness check can fail", async ({
    page,
  }) => {
    // The reduced-motion assertions are only worth as much as their ability to
    // fail. If the fixture had no hot spots, or the pulse had been removed,
    // "the canvas is byte-identical" would pass while proving nothing.
    await settleAndFit(page, "no-preference");
    const [first, second] = await stillnessPair(page);
    expect(
      first.equals(second),
      "the canvas did not change with animation enabled — the reduced-motion " +
        "check above would then be vacuous",
    ).toBe(false);
  });
});
