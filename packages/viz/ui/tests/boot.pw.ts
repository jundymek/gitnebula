import { expect, test } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";

/**
 * Story 6.2, AC-1 and AC-2 — **the real `boot()` runs.**
 *
 * Before this story `boot()` (`src/app.ts`) was executed by no test in the
 * repository. Its only caller is `src/main.ts:9`; `src/index.ts:9` re-exports
 * it, and `src/app-view-swap.test.ts` imports only the three *pure* helpers
 * beside it (`swapWithFallback`, `unavailabilityAfterSwap`,
 * `failedSwitchReason`) while saying in its own header that `boot()` is not
 * exercised there. So roughly 120 lines — the document fetch, the error
 * screen, mounting the chrome, parsing `?view=3d`, building the engine, wiring
 * the search box and the tooltip — ran only in a browser nobody was watching.
 *
 * It cannot be reached from jsdom, and not for a shallow reason: `boot()`
 * fetches `analysis.json` before it can build anything, and everything
 * interesting in it (`swapEngine`, `captureState`, `restoreState`) is a
 * closure inside the function. There is no export to call and no seam to
 * inject. A browser with a server in front of it is the only way in.
 *
 * **What this file deliberately does not assert.** `smoke.pw.ts` already owns
 * "the harness reaches a booted Viewer and the layout settles" and "the suite
 * serves the fixture its config names". Repeating either here would add a
 * second place to update and no coverage. This file asserts what `boot()`
 * *assembled*.
 */

/** The `root-files` fixture, in contract order. Six nodes, three layers. */
const FIXTURE_NODE_IDS = [
  "fp/",
  "fp/proxy.py",
  "fp/util.py",
  "setup.py",
  "test_proxy.py",
  "version.py",
];

interface BootReadout {
  readonly nodeIds: string[];
  readonly stageIsInMain: boolean;
  readonly hasSearchBox: boolean;
  readonly hasTooltip: boolean;
  readonly pressed2D: string | null;
  readonly pressed3D: string | null;
  readonly threeDDisabled: boolean;
  readonly threeDReason: string;
  readonly is3D: boolean;
}

/**
 * Read what `boot()` built, through the harness handle and the assembled DOM.
 *
 * `getOrientation` is the 3D discriminator throughout this story. It is a
 * `Nebula3DEngine` class member kept deliberately **off** the `GraphEngine`
 * interface (`engine3d.ts:19`, decision D2), so its presence separates the two
 * implementations without either of them growing a `whichAmI()` for the
 * benefit of a test. `perf/tests/degradation-3d.pw.ts:71` already uses exactly
 * this check; following it beats inventing a second convention, and beats
 * `constructor.name`, which a minifier would silently break.
 */
async function readBoot(page: import("@playwright/test").Page, key: string) {
  return page.evaluate(async (handleKey): Promise<BootReadout> => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: {
            nodes: readonly { id: string }[];
            getOrientation?: () => unknown;
          };
          settled: Promise<{ frames: number; durationMs: number }>;
        }
      >
    )[handleKey];
    if (!handle)
      throw new Error(`no harness handle at globalThis.${handleKey}`);
    await handle.settled;

    const stage = document.querySelector("#stage");
    const button = (view: string): HTMLButtonElement | null =>
      document.querySelector(`#view-switch button[data-view="${view}"]`);
    const threeD = button("3d");

    return {
      nodeIds: handle.engine.nodes.map((node) => node.id),
      stageIsInMain: stage?.parentElement?.tagName.toLowerCase() === "main",
      // Both are constructed by `boot()` and handed to `mountChrome` as
      // overlays; neither the header nor the engine creates them.
      //
      // The search box is reached through its accessible handle rather than a
      // class: epic 5 made the role and the label a contract, and
      // `chrome/testids.ts` says outright that a control which already carries
      // one does not get a second. The tooltip has no such handle — its only
      // hook is the `tooltip` class — and `testids.ts` deliberately did not
      // give it one either, so a class is what there is. Presence is all this
      // asserts; the tooltip's rendered behaviour is story 6.4's.
      hasSearchBox:
        document.querySelector(
          '.search input[role="combobox"][aria-label="search files and modules"]',
        ) !== null,
      hasTooltip: document.querySelector(".tooltip") !== null,
      pressed2D: button("2d")?.getAttribute("aria-pressed") ?? null,
      pressed3D: threeD?.getAttribute("aria-pressed") ?? null,
      threeDDisabled: threeD?.disabled ?? true,
      threeDReason:
        document.querySelector("#view-switch-reason")?.textContent ?? "",
      is3D: handle.engine.getOrientation !== undefined,
    };
  }, key);
}

test("boot() assembles the viewer over the document it fetched (AC-1)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);
  const boot = await readBoot(page, HARNESS_HANDLE_KEY);

  // The engine holds the document `boot()` went and got. Asserting the ids
  // rather than a count is what makes this a statement about *this* fixture:
  // a count of six would also be satisfied by six nodes of some other
  // document, which is the failure `smoke.pw.ts`'s fixture check exists for
  // and which there is no reason to leave half-closed here.
  expect(
    boot.nodeIds,
    "the engine is not holding the `root-files` document — boot() fetched " +
      "analysis.json and loaded it, so these ids are the fixture's or the " +
      "boot path is not the one under test",
  ).toEqual(FIXTURE_NODE_IDS);

  // The stage is created by `boot()` and placed by `mountChrome`, inside
  // `<main>` and after the `<header>`. That ordering is what gives the canvas
  // a non-zero top offset in a real page — the property `pointer-hit.pw.ts`
  // depends on and jsdom cannot produce.
  expect(
    boot.stageIsInMain,
    "the stage canvas is not a child of <main> — boot() creates it and " +
      "mountChrome places it there; if that changed, the canvas offset the " +
      "pointer specs rely on has changed with it",
  ).toBe(true);

  // The search box and the tooltip are `boot()`'s, passed to `mountChrome` as
  // overlays. Their absence would mean the chrome mounted but the wiring at
  // the end of `boot()` did not run.
  expect(
    { search: boot.hasSearchBox, tooltip: boot.hasTooltip },
    "boot() did not wire the search box and the tooltip into the page; the " +
      "chrome mounted without the overlays boot() constructs",
  ).toEqual({ search: true, tooltip: true });

  // `DEFAULT_VIEW` is 2D and story 5.7's AC-1 says so. The pressed state and
  // the engine that was actually built have to agree — that agreement is the
  // whole subject of AC-5, and this is its uninteresting, must-hold case.
  expect(
    { pressed2D: boot.pressed2D, pressed3D: boot.pressed3D, is3D: boot.is3D },
    "a plain boot did not land in 2D with the 2D button pressed — 2D is the " +
      "default view everywhere (view.ts DEFAULT_VIEW)",
  ).toEqual({ pressed2D: "true", pressed3D: "false", is3D: false });

  // 3D is *offered* on a boot that did not ask for it: `probe3D` passes in a
  // real Chromium, so `unavailabilityAfterSwap` returns null and the button
  // stays enabled with an empty reason. This is the baseline the AC-5 failure
  // case is measured against — without it, "the button is disabled with a
  // reason" would be indistinguishable from "the button is always disabled".
  expect(
    { disabled: boot.threeDDisabled, reason: boot.threeDReason },
    "the 3D button is not being offered on an ordinary boot; probe3D passes " +
      "in Chromium, so the switch should be enabled with no reason attached",
  ).toEqual({ disabled: false, reason: "" });

  expect(
    pageErrors,
    "the page threw while booting, which no assertion above would " +
      "necessarily have noticed",
  ).toEqual([]);
});

test("?view=3d boots directly into the 3D view, and a plain boot does not (AC-2)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  // Both directions, in one test, on one page. A one-sided assertion here
  // would pass just as happily against a viewer that is *always* 3D — or
  // against a `getOrientation` check that is simply wrong — and the URL is
  // the thing under test, so both of its values have to be exercised.
  await openViewer(page);
  const plain = await readBoot(page, HARNESS_HANDLE_KEY);

  await openViewer(page, { view: "3d" });
  const requested = await readBoot(page, HARNESS_HANDLE_KEY);

  expect(
    { plainIs3D: plain.is3D, requestedIs3D: requested.is3D },
    "the view query parameter did not decide which engine boot() built: " +
      "`/` must give the 2D engine and `/?view=3d` the 3D one. This is the " +
      "URL the perf harness and a human both use to reproduce a 3D run, and " +
      "it is unreachable from jsdom because boot() fetches analysis.json",
  ).toEqual({ plainIs3D: false, requestedIs3D: true });

  // The switch reflects the view that was *built*. On this path nothing fell
  // back, so "asked for" and "built" coincide — the case where they diverge is
  // AC-5's, in view-swap.pw.ts.
  expect(
    { pressed2D: requested.pressed2D, pressed3D: requested.pressed3D },
    "the viewer is running the 3D engine but the view switch does not show " +
      "3D as pressed; the control and the engine have disagreed",
  ).toEqual({ pressed2D: "false", pressed3D: "true" });

  // The same document, whichever view drew it. `load()` is called on the
  // engine `createViewEngine` returned, so a 3D boot that quietly loaded
  // something else would show up here and nowhere else in this suite.
  expect(
    requested.nodeIds,
    "the 3D boot is not holding the `root-files` document the 2D boot holds " +
      "— both views are meant to be the same map, drawn differently",
  ).toEqual(FIXTURE_NODE_IDS);

  expect(pageErrors, "the page threw during one of the two boots").toEqual([]);
});
