import { expect, test, type Page } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";
import {
  BUSIEST_FILE_ID,
  EXPECTED_PARTNER_ROWS,
  serveLongCochangeDocument,
} from "./support/long-cochange-document.js";

/**
 * Story 6.4 — the panel's controls stay reachable at a real window size.
 *
 * **What was here before, and why it was not enough.** The only guard on this
 * behaviour is `src/chrome/blast-radius.test.ts:412-431`, which reads
 * `styles.css` as **text** and asserts that `max-height:` and
 * `overflow-y: auto` appear in the `.p-blast-list` and `#panel` rules. Its own
 * comment calls that "a weaker check than a rendered one". It is weaker in
 * three specific ways: it would pass with `max-height: 0`, it would pass if a
 * later rule overrode the cap, and it would pass if a flex parent broke it.
 * That test is not replaced here — a cheap check that runs in `pnpm test` on a
 * machine with no browser still earns its place. This is the rendered one
 * beside it.
 *
 * **What is being asserted, stated precisely.** Not scrolling *behaviour*:
 * nothing in `packages/viz/src/` reads `scrollTop`, `scrollHeight` or calls
 * `scrollIntoView`, so there is no product code that scrolls and none to test.
 * What is asserted is **reachability** — that a reader can get to a control
 * and press it. `body` is `overflow: hidden` (`styles.css:126`), so a control
 * pushed below the fold by a long list is not merely off-screen, it is
 * unreachable; the caps on `#panel` and `.p-blast-list` are what turn "lost"
 * into "scroll the region it lives in". Every check below therefore scrolls
 * the region the way a reader would and then asks whether the control is in
 * the window and answers a hit test.
 *
 * The document is synthesised (see `support/long-cochange-document.ts`) with
 * the 44-partner list `styles.css:874-881` measured on this repository, and
 * served over `page.route` so `ui/playwright.config.ts` is left untouched for
 * stories 6.2 and 6.3.
 */

/** A rectangle, flattened out of `DOMRect` so it survives `page.evaluate`. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What one control's reachability looks like from the browser's side. */
interface ControlReport {
  /** The control's own text, so a failure names it as the reader sees it. */
  readonly label: string;
  /** Where it sat before anything was scrolled — the AC-6 measurement. */
  readonly beforeScroll: Rect;
  /** Where it sits after its own region was scrolled to it. */
  readonly afterScroll: Rect;
  /**
   * The region a reader had to scroll to reach it, or null when none exists.
   * Null with a control outside the window is the unreachable case.
   */
  readonly scrolledRegion: string | null;
  /** Every edge of `afterScroll` inside the window. */
  readonly insideViewport: boolean;
  /**
   * `elementFromPoint` at the control's centre resolves to the control (or a
   * child of it). This is the half that "visible" does not cover: an element
   * with a correct box that something else is painted over is not clickable,
   * and the reader cannot tell the two apart.
   */
  readonly hitTestReachesControl: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
}

interface RegionReport {
  readonly selector: string;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly overflowY: string;
  /** `scrollTop` after asking the region to scroll to its own end. */
  readonly scrolledTo: number;
  readonly rect: Rect;
  readonly insideViewport: boolean;
}

/** The controls this story is about: the toggle, and the panel's own actions. */
const CONTROL_SELECTOR = ".p-blast-show, .p-actions .iconbtn";

/**
 * How long a wheel gesture is given to reach `scrollTop`.
 *
 * Chromium scrolls off the main thread, so the value is not updated by the
 * time `mouse.wheel` resolves. Short, because a wheel that has not landed in
 * this long has not landed.
 */
const WHEEL_SETTLE_TIMEOUT_MS = 5_000;

/** Boot the Viewer on the synthesised document at a stated window size. */
async function openViewerAtSize(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  // Before the navigation, not after: a resize *during* boot would have the
  // engine measure one canvas and the layout settle against another, and the
  // point of a stated viewport is that every number below is a number for
  // that viewport.
  await page.setViewportSize(viewport);
  await serveLongCochangeDocument(page);
  await openViewer(page);
}

/**
 * Open the panel on the file carrying the long list, through the engine's own
 * `setSelected`.
 *
 * That is the product's path, not a synthetic DOM poke: `chrome.ts:370`
 * subscribes to the engine's `select` event and opens the panel from it, so
 * this is exactly what a click on the canvas ends up doing (AD-5). Awaiting
 * `settled` first is AD-6 — never a timeout.
 */
async function openPanelOnBusiestFile(page: Page): Promise<void> {
  await page.evaluate(
    async ([key, nodeId]) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: { setSelected(id: string | null): void };
            settled: Promise<unknown>;
          }
        >
      )[key as string];
      if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
      await handle.settled;
      handle.engine.setSelected(nodeId as string);
    },
    [HARNESS_HANDLE_KEY, BUSIEST_FILE_ID],
  );
  await expect(
    page.locator("#panel"),
    "selecting the busiest file did not open the panel, so nothing below is " +
      "measuring the panel this story is about",
  ).toBeVisible();
}

/**
 * Measure every control, first scrolling the region it lives in the way a
 * reader could.
 *
 * **Why this is hand-rolled rather than `scrollIntoViewIfNeeded`.** The first
 * version of this spec used Playwright's helper, and AC-3's negative control
 * caught it: with the caps removed the controls were still reported reachable.
 * `overflow: hidden` stops a *reader* scrolling, but it does not stop a
 * *script* — `scrollIntoView` happily scrolls the document even though `body`
 * is `overflow: hidden` (`styles.css:126`), so the helper was rescuing the
 * page in a way no mouse can. That is precisely the difference between "the
 * cap works" and "the cap is missing", and a check that cannot see it is the
 * check this story exists to replace.
 *
 * So: find the nearest ancestor that is genuinely a scroll container —
 * computed `overflow-y` of `auto` or `scroll`, *and* actually overflowing —
 * and scroll that one element by the minimum needed, which is what a wheel
 * over that region does. If there is none, nothing moves, and the control is
 * reported where it actually sits.
 *
 * `beforeScroll` is kept as well as `afterScroll` because AC-6 asks whether
 * any control was found below the fold, and that question is only answerable
 * before the scroll.
 */
async function reportControls(page: Page): Promise<ControlReport[]> {
  return page.evaluate((selector) => {
    const isScrollContainer = (element: Element): boolean => {
      const overflowY = window.getComputedStyle(element).overflowY;
      return (
        (overflowY === "auto" || overflowY === "scroll") &&
        element.scrollHeight > element.clientHeight
      );
    };

    const flatten = (rect: DOMRect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });

    return [...document.querySelectorAll(selector)].map((element) => {
      const beforeScroll = flatten(element.getBoundingClientRect());

      let container: Element | null = element.parentElement;
      while (container !== null && !isScrollContainer(container)) {
        container = container.parentElement;
      }
      if (container !== null) {
        // The minimum wheel movement that brings the control into its own
        // region — nothing more, and nothing outside that region.
        const region = container.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        if (box.bottom > region.bottom) {
          container.scrollTop += box.bottom - region.bottom;
        } else if (box.top < region.top) {
          container.scrollTop -= region.top - box.top;
        }
      }

      const rect = element.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const centre = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const topmost = document.elementFromPoint(centre.x, centre.y);
      return {
        label: (element.textContent ?? "").trim(),
        scrolledRegion:
          container === null ? null : container.className || container.id,
        beforeScroll,
        afterScroll: flatten(rect),
        insideViewport:
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= viewport.height &&
          rect.right <= viewport.width,
        hitTestReachesControl:
          topmost !== null &&
          (topmost === element || element.contains(topmost)),
        viewport,
      };
    });
  }, CONTROL_SELECTOR);
}

/** True when every control is in the window and answers a hit test. */
function allReachable(reports: readonly ControlReport[]): boolean {
  return (
    reports.length > 0 &&
    reports.every(
      (report) => report.insideViewport && report.hitTestReachesControl,
    )
  );
}

/** Measure one bounded region: does it overflow, and does it scroll? */
async function reportRegion(
  page: Page,
  selector: string,
): Promise<RegionReport> {
  return page.locator(selector).evaluate((element, chosen) => {
    // Ask the region to scroll to its own end. If it is genuinely bounded and
    // overflowing, `scrollTop` lands above zero; if the cap is gone, the
    // element does not scroll and `scrollTop` stays at zero while the content
    // spills past the window instead.
    element.scrollTop = element.scrollHeight;
    const rect = element.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return {
      selector: chosen,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: window.getComputedStyle(element).overflowY,
      scrolledTo: element.scrollTop,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      insideViewport:
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= viewport.height &&
        rect.right <= viewport.width,
    };
  }, selector);
}

/**
 * The window sizes AC-1 names. 1280x800 is an ordinary laptop; 1280x600 is the
 * short screen the caps exist for — a browser with devtools docked at the
 * bottom, or a half-height window.
 */
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1280, height: 600 },
] as const;

test.describe("the panel's controls stay reachable (AC-1)", () => {
  for (const viewport of VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;

    test(`at ${size}, every panel control is in the window and clickable`, async ({
      page,
    }) => {
      await openViewerAtSize(page, viewport);
      await openPanelOnBusiestFile(page);

      // The premise the whole story rests on, asserted rather than assumed. If
      // the page ever gains a scrollable body, "below the fold" stops meaning
      // "unreachable" and every measurement here has to be re-read.
      const bodyOverflow = await page.evaluate(
        () => window.getComputedStyle(document.body).overflow,
      );
      expect(
        bodyOverflow,
        "document.body is no longer `overflow: hidden`, which is the premise " +
          "this story reasons from — content past the fold would now be " +
          "reachable by scrolling the page, and the caps on #panel and " +
          ".p-blast-list would be guarding a defect that no longer exists",
      ).toBe("hidden");

      // Vacuity guard: a 44-row list is what makes the panel taller than a
      // short window. If the rows are not there, everything below passes for
      // the wrong reason.
      await expect(
        page.locator(".p-blast-row"),
        `the panel is not showing ${EXPECTED_PARTNER_ROWS} co-change rows, ` +
          "so the panel is not long enough for reachability to be in " +
          "question and this test would pass without testing anything",
      ).toHaveCount(EXPECTED_PARTNER_ROWS);

      const reports = await reportControls(page);
      expect(
        reports.length,
        `no element matched \`${CONTROL_SELECTOR}\` — the toggle and the ` +
          "panel's actions are what this story is about, so a run that found " +
          "none of them proves nothing",
      ).toBeGreaterThan(0);

      for (const report of reports) {
        expect(
          {
            control: report.label,
            insideViewport: report.insideViewport,
            box: report.afterScroll,
            viewport: report.viewport,
          },
          `at ${size} the control "${report.label}" is outside the window ` +
            "even after its own region was scrolled to it. `body` is " +
            "`overflow: hidden`, so this control cannot be reached at all — " +
            "which is the defect the height caps on #panel and " +
            ".p-blast-list exist to prevent",
        ).toEqual({
          control: report.label,
          insideViewport: true,
          box: report.afterScroll,
          viewport: report.viewport,
        });

        expect(
          { control: report.label, hitTest: report.hitTestReachesControl },
          `at ${size} the control "${report.label}" has a box inside the ` +
            "window but something else is painted over its centre, so a " +
            "reader clicking it would hit the other element instead",
        ).toEqual({ control: report.label, hitTest: true });
      }
    });

    test(`at ${size}, the controls can actually be pressed`, async ({
      page,
    }) => {
      // A rectangle inside the window is necessary and not sufficient. This is
      // the other half of "clickable": press each control through Playwright's
      // real click — which scrolls, hit-tests and dispatches like a reader —
      // and require the state it owns to change.
      await openViewerAtSize(page, viewport);
      await openPanelOnBusiestFile(page);

      const showOnMap = page.locator(".p-blast-show");
      await expect(
        showOnMap,
        "the `show on map` toggle is not rendered, so the control AC-1 names " +
          "cannot be pressed at all",
      ).toHaveAttribute("aria-pressed", "false");
      await showOnMap.click();
      await expect(
        showOnMap,
        `at ${size} clicking \`show on map\` did not flip its pressed state ` +
          "— the control is on screen but the click is not reaching it",
      ).toHaveAttribute("aria-pressed", "true");

      const isolate = page.locator("#p-isolate");
      await isolate.click();
      await expect(
        isolate,
        `at ${size} clicking the panel's \`isolate\` action did not flip its ` +
          "pressed state — the panel's own actions are below the co-change " +
          "list, which is exactly where a long list pushes them out of reach",
      ).toHaveAttribute("aria-pressed", "true");

      // And the engine agrees, so the click drove the product rather than
      // only the button's own attribute.
      const marked = await page.evaluate((key) => {
        const handle = (
          globalThis as unknown as Record<
            string,
            {
              engine: {
                getBlastRadius(): readonly string[];
                getIsolated(): { id: string } | null;
              };
            }
          >
        )[key];
        if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
        return {
          blastRadius: handle.engine.getBlastRadius().length,
          isolated: handle.engine.getIsolated()?.id ?? null,
        };
      }, HARNESS_HANDLE_KEY);

      expect(
        marked,
        `at ${size} the two clicks landed on the buttons but the engine was ` +
          "not asked to mark the partner set or to isolate the node — the " +
          "controls are reachable and inert, which is worse than unreachable",
      ).toEqual({
        blastRadius: EXPECTED_PARTNER_ROWS,
        isolated: BUSIEST_FILE_ID,
      });
    });
  }
});

test.describe("the three bounded regions scroll their own content (AC-2)", () => {
  // Run at the short window: `#start-here`'s cap is `calc(100% - 190px)` and
  // `#panel`'s is `calc(100% - 36px)`, both against `main`, so 600 px is where
  // all three regions are actually pushed past their bounds. Measuring at 800
  // as well would mostly measure regions that do not overflow, which is a
  // vacuous check dressed as a second data point — the 800 px numbers are in
  // the story's README instead.
  const viewport = { width: 1280, height: 600 };

  test("#panel, #start-here and .p-blast-list are each bounded and scrollable", async ({
    page,
  }) => {
    await openViewerAtSize(page, viewport);
    await openPanelOnBusiestFile(page);

    // The start-here panel is a **disclosure** (story 5.1, UX-DR12), and it
    // may already be up: `chrome.ts:241-247` opens it on the first settle when
    // nothing is selected, and the engine's `settled` reaches chrome
    // synchronously — before the `setSelected` above, which runs a microtask
    // later. Clicking the header button unconditionally would therefore *shut*
    // it about as often as it opened it, which is how the first run of this
    // spec failed. Asking `aria-expanded` first is what the attribute is for.
    const disclosure = page.locator("#start-here-button");
    if ((await disclosure.getAttribute("aria-expanded")) !== "true") {
      await disclosure.click();
    }
    await expect(
      page.locator("#start-here"),
      "the start-here panel did not open from its header button, so one of " +
        "the three regions AC-2 names cannot be measured",
    ).toBeVisible();

    for (const selector of ["#panel", "#start-here", ".p-blast-list"]) {
      const region = await reportRegion(page, selector);

      expect(
        {
          selector,
          overflows: region.scrollHeight > region.clientHeight,
          scrollHeight: region.scrollHeight,
          clientHeight: region.clientHeight,
        },
        `${selector} does not overflow at ${viewport.width}x${viewport.height}` +
          ", so every other assertion about it here is vacuously green. " +
          "Either the region is no longer bounded, or the synthetic document " +
          "stopped filling it — check support/long-cochange-document.ts",
      ).toEqual({
        selector,
        overflows: true,
        scrollHeight: region.scrollHeight,
        clientHeight: region.clientHeight,
      });

      expect(
        {
          selector,
          scrolls: region.overflowY === "auto" || region.overflowY === "scroll",
        },
        `${selector} computes \`overflow-y: ${region.overflowY}\`. It has ` +
          "more content than it can show, so anything but a scrolling " +
          "overflow loses that content where `body` cannot scroll to it",
      ).toEqual({ selector, scrolls: true });

      expect(
        { selector, scrolledTo: region.scrolledTo > 0 },
        `${selector} was asked to scroll to its own end and \`scrollTop\` ` +
          "stayed at 0 — it reports overflowing content that it will not " +
          "scroll to, which is the same as losing it",
      ).toEqual({ selector, scrolledTo: true });

      expect(
        { selector, insideViewport: region.insideViewport, box: region.rect },
        `${selector} has grown outside the window (box ${JSON.stringify(
          region.rect,
        )} against ${viewport.width}x${viewport.height}). A bounded region ` +
          "that outgrows the viewport takes every control below it out of " +
          "reach, which is the whole failure this story guards",
      ).toEqual({
        selector,
        insideViewport: true,
        box: region.rect,
      });
    }
  });

  test("a real wheel over the panel scrolls the panel, not the page", async ({
    page,
  }) => {
    // Setting `scrollTop` proves the region *can* scroll. It does not prove
    // the reader's own gesture reaches it — a wheel over an overlay can be
    // swallowed by a handler, or scroll an ancestor instead. This drives the
    // actual wheel.
    //
    // It is also what retires story 5.6's open item. That story left
    // "Scrolling felt in a browser" unticked because "no pixels were rendered
    // here"; a wheel event over a rendered panel is the mechanical half of
    // that question, and the half a browser can answer.
    await openViewerAtSize(page, viewport);
    await openPanelOnBusiestFile(page);

    // A wheel is consumed by the **innermost** scroll container under the
    // pointer, which is the first thing this test found out: aimed at the
    // panel's centre it moves `.p-blast-list`, not `#panel`. That is correct
    // browser behaviour and it is also what the reader experiences, so both
    // gestures are exercised where they actually apply — over the list, and
    // over the panel above the list.
    const scrollTops = () =>
      page.evaluate(() => ({
        panel: document.querySelector("#panel")?.scrollTop ?? -1,
        list: document.querySelector(".p-blast-list")?.scrollTop ?? -1,
        page: document.scrollingElement?.scrollTop ?? -1,
      }));

    /**
     * Wait for a region's `scrollTop` to pass `from`.
     *
     * Chromium applies wheel scrolling asynchronously, off the main thread, so
     * reading `scrollTop` on the line after `mouse.wheel` reads the value from
     * before the gesture — which is how this test first failed, reporting a
     * panel that scrolls perfectly well as unscrollable. Resolved as a
     * boolean rather than left to throw, so the assertion below carries the
     * prose rather than a bare Playwright timeout.
     */
    const scrolledPast = (selector: string, from: number): Promise<boolean> =>
      page
        .waitForFunction(
          ([css, start]) =>
            (document.querySelector(css as string)?.scrollTop ?? 0) >
            (start as number),
          [selector, from],
          { timeout: WHEEL_SETTLE_TIMEOUT_MS },
        )
        .then(() => true)
        .catch(() => false);

    const before = await scrollTops();

    const listBox = await page.locator(".p-blast-list").boundingBox();
    expect(
      listBox === null ? "no box" : "has a box",
      "the co-change list has no rendered box, so no wheel gesture can be " +
        "aimed at it",
    ).toBe("has a box");
    await page.mouse.move(
      listBox!.x + listBox!.width / 2,
      listBox!.y + listBox!.height / 2,
    );
    await page.mouse.wheel(0, 400);
    const listMoved = await scrolledPast(".p-blast-list", before.list);

    expect(
      { listMoved },
      "a 400px wheel over the co-change list never moved its scrollTop past " +
        `${before.list}. A long partner list in a bounded region is the case ` +
        "this story is about, and a list the reader cannot wheel through " +
        "hides every partner past the first handful",
    ).toEqual({ listMoved: true });

    // Above the list — the metric rows — where `#panel` itself is the nearest
    // scroll container.
    const panelBox = await page.locator("#panel").boundingBox();
    await page.mouse.move(panelBox!.x + panelBox!.width / 2, panelBox!.y + 40);
    await page.mouse.wheel(0, 400);
    const panelMoved = await scrolledPast("#panel", before.panel);
    const afterPanel = await scrollTops();

    expect(
      { panelMoved },
      "a 400px wheel over the panel's upper rows never moved `#panel`'s " +
        `scrollTop past ${before.panel}. That is the region carrying \`show ` +
        "on map` and the panel's own actions below the fold at this window " +
        "size, so a panel the reader cannot wheel is a panel whose controls " +
        "are lost",
    ).toEqual({ panelMoved: true });

    expect(
      { pageMoved: afterPanel.page !== before.page },
      `the wheel moved the page itself (${before.page} -> ` +
        `${afterPanel.page}). \`body\` is \`overflow: hidden\` precisely so ` +
        "the map stays put under its overlays; a scrolling page would slide " +
        "the canvas out from under the reader",
    ).toEqual({ pageMoved: false });
  });
});

test.describe("the reachability check can fail (AC-3)", () => {
  const viewport = { width: 1280, height: 600 };

  test("with the height caps defeated, the same check goes red", async ({
    page,
  }) => {
    // 6.1's negative-control pattern, which it took from
    // `perf/tests/export.pw.ts:165`: feed the positive assertion's own
    // machinery a deliberately falsified input and require it not to pass.
    //
    // Here the falsified input is the layout itself. Nothing in
    // `packages/viz/src/` is touched — the override is injected into this one
    // page, after boot, and dies with the page. What it removes is exactly the
    // two rules `styles.css:389-390` and `styles.css:884-885` carry, which is
    // the state the repository was in before story 5.6 fixed it.
    await openViewerAtSize(page, viewport);
    await openPanelOnBusiestFile(page);

    const intact = await reportControls(page);
    expect(
      { reachableWithTheCap: allReachable(intact), controls: intact.length },
      "with the caps in place the controls were already unreachable, so the " +
        "negative control below would be measuring a broken page rather than " +
        "a defeated cap — a control that is red either way proves nothing",
    ).toEqual({ reachableWithTheCap: true, controls: intact.length });

    await page.addStyleTag({
      content: `
        #panel { max-height: none !important; overflow: visible !important; }
        .p-blast-list { max-height: none !important; overflow: visible !important; }
      `,
    });

    // The falsification has to be shown to have taken, or a stylesheet that
    // silently failed to apply would produce a "still reachable" result that
    // says nothing about the caps. Measured, not assumed: with the caps gone
    // the panel's own box must exceed the window it sits in.
    const panelAfter = await page.locator("#panel").evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      windowHeight: window.innerHeight,
      overflowY: window.getComputedStyle(element).overflowY,
    }));
    expect(
      {
        capDefeated: panelAfter.height > panelAfter.windowHeight,
        overflowY: panelAfter.overflowY,
      },
      `the injected override did not take: #panel is ${panelAfter.height}px ` +
        `tall in a ${panelAfter.windowHeight}px window with ` +
        `\`overflow-y: ${panelAfter.overflowY}\`. Without a genuinely ` +
        "unbounded panel the check below is not a negative control at all",
    ).toEqual({ capDefeated: true, overflowY: "visible" });

    const defeated = await reportControls(page);
    const offScreen = defeated
      .filter((report) => !report.insideViewport)
      .map((report) => report.label);
    expect(
      {
        reachableWithoutTheCap: allReachable(defeated),
        someControlOffScreen: offScreen.length > 0,
        offScreen,
      },
      "the height caps were removed and every panel control was still " +
        "reachable, so the check above cannot distinguish a bounded panel " +
        "from an unbounded one. That is the failure mode the stylesheet-text " +
        "guard has (`blast-radius.test.ts:412-431` would pass with " +
        "`max-height: 0`), and reproducing it here would make this whole " +
        "spec decoration",
    ).toEqual({
      reachableWithoutTheCap: false,
      someControlOffScreen: true,
      offScreen,
    });
  });
});
