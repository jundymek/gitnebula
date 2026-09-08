import { expect, test, type Page } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";
import {
  LONG_PATH_ID,
  serveLongCochangeDocument,
} from "./support/long-cochange-document.js";

/**
 * Story 6.4, AC-4 — the tooltip's edge flip, against a box that was actually
 * measured.
 *
 * **What is already covered, and is not repeated here.** `tooltipPosition` is
 * a pure function and `src/chrome/tooltip.test.ts:46-86` sweeps a grid of the
 * viewport across it, asserting the never-overflow invariant. That is a good
 * test and this story does not touch it (AC-5).
 *
 * **What has never run.** `tooltip.ts:104-107` measures the live element with
 * `offsetWidth` / `offsetHeight`, and in jsdom both are permanently **0**. So
 * every existing assertion about the rendered tooltip has been made against a
 * 0x0 box — `tooltip.test.ts:116-122` passes for exactly that reason. The
 * chain "a real font renders the label -> the box has a real width -> the flip
 * decision is made against that width" has no coverage at all, because its
 * inputs have never been real. That chain is what this file exercises: on the
 * machine this story was measured on the label renders 643 x 26 CSS px, and a
 * 643 px box 14 px from a cursor 40 px inside the right edge is a flip a 0x0
 * box could never provoke.
 *
 * The tooltip carries `aria-hidden="true"` (`tooltip.ts:89`) — deliberately,
 * since it mirrors what the canvas already shows — so it is invisible to role
 * and accessible-name queries by construction. It is selected by class, and
 * what is asserted is its **rectangle**.
 */

/** Gap the tooltip keeps from the cursor (`TOOLTIP_OFFSET_PX`). */
const OFFSET_PX = 14;

/** Fixed, so a layout-dependent number means the same thing on every machine. */
const VIEWPORT = { width: 1280, height: 800 };

/** A point in canvas space — what `ScreenPoint` means (`engine/types.ts`). */
interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

interface CanvasBox {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface HoverProbe {
  /** The node `pick()` reports at the point about to be hovered. */
  readonly pickedAtTarget: string | null;
  /** Where the pointer will be put, in client (page) coordinates. */
  readonly cursor: { readonly x: number; readonly y: number };
}

interface TooltipBox {
  readonly hidden: boolean;
  readonly text: string;
  /** What `tooltip.ts` itself measures before deciding where to put the box. */
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
  };
  readonly viewport: { readonly width: number; readonly height: number };
}

async function bootAtFixedSize(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await serveLongCochangeDocument(page);
  await openViewer(page);
}

/**
 * The canvas' own box.
 *
 * Read on the Node side and the target point computed here, so what crosses
 * into the browser is plain numbers. `ScreenPoint` is relative to this box's
 * top-left corner, and the canvas sits below the header — so this offset is
 * the whole conversion between what the mouse is driven in and what the engine
 * is handed.
 */
async function canvasBox(page: Page): Promise<CanvasBox> {
  return page.locator("canvas").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  });
}

/**
 * Put the long-path node under a chosen canvas point, and report what is
 * there.
 *
 * `flyTo` centres the node and selects it (`engine.ts:509-562`); the selection
 * is then cleared, because an open `#panel` covers the right-hand edge of the
 * window and would swallow the very pointer event this spec is about. `panBy`
 * then moves the map by an exact screen delta — `camera.ts:76-86` shifts the
 * camera by `dx / k`, so the node lands precisely on the target — and `pick()`
 * is asked what is actually there, so the spec never trusts its own
 * arithmetic.
 */
async function placeNodeUnderCursor(
  page: Page,
  canvas: CanvasBox,
  target: CanvasPoint,
): Promise<HoverProbe> {
  const picked = await page.evaluate(
    async ({ key, nodeId, target: point, centre }) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: {
              flyTo(id: string): Promise<void>;
              setSelected(id: string | null): void;
              setHovered(id: string | null): void;
              panBy(dx: number, dy: number): void;
              pick(at: { x: number; y: number }): { id: string } | null;
            };
            settled: Promise<unknown>;
          }
        >
      )[key];
      if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
      await handle.settled;

      await handle.engine.flyTo(nodeId);
      handle.engine.setSelected(null);
      handle.engine.setHovered(null);

      // `flyTo` leaves the node at the centre of the canvas; move the map so
      // it sits under the point about to be hovered.
      handle.engine.panBy(point.x - centre.x, point.y - centre.y);
      return handle.engine.pick(point)?.id ?? null;
    },
    {
      key: HARNESS_HANDLE_KEY,
      nodeId: LONG_PATH_ID,
      target,
      centre: { x: canvas.width / 2, y: canvas.height / 2 },
    },
  );

  return {
    pickedAtTarget: picked,
    // The mouse is driven in client coordinates; the canvas' own offset is
    // added back here.
    cursor: { x: canvas.left + target.x, y: canvas.top + target.y },
  };
}

/** Read the tooltip's rendered rectangle and the box the component measured. */
async function readTooltip(page: Page): Promise<TooltipBox> {
  return page.locator(".tooltip").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const html = element as HTMLElement;
    return {
      hidden: html.hidden,
      text: element.textContent ?? "",
      offsetWidth: html.offsetWidth,
      offsetHeight: html.offsetHeight,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

/** Every edge of the tooltip inside the window, as four named booleans. */
function insideViewport(tooltip: TooltipBox): Record<string, boolean> {
  return {
    left: tooltip.rect.left >= 0,
    right: tooltip.rect.right <= tooltip.viewport.width,
    top: tooltip.rect.top >= 0,
    bottom: tooltip.rect.bottom <= tooltip.viewport.height,
  };
}

const ALL_EDGES_INSIDE = { left: true, right: true, top: true, bottom: true };

test.describe("the tooltip flips against a measured box (AC-4)", () => {
  test("the box it flips on is real, not the 0x0 one jsdom reports", async ({
    page,
  }) => {
    // The premise every other assertion in this file rests on. If this fails,
    // the rest is measuring the same vacuum `tooltip.test.ts:116-122` does.
    await bootAtFixedSize(page);
    const canvas = await canvasBox(page);

    expect(
      { headerAboveTheCanvas: canvas.top > 0, canvasTop: canvas.top },
      "the canvas starts at the very top of the window, so the header did " +
        "not render. Every coordinate here converts between client and " +
        "canvas space, and with a zero offset that conversion is untested " +
        "even when it is wrong",
    ).toEqual({ headerAboveTheCanvas: true, canvasTop: canvas.top });

    const probe = await placeNodeUnderCursor(page, canvas, {
      x: canvas.width / 2,
      y: canvas.height / 2,
    });
    expect(
      probe.pickedAtTarget,
      "the long-path node is not under the point about to be hovered, so no " +
        "hover event will name it and the tooltip would be measured empty",
    ).toBe(LONG_PATH_ID);

    await page.mouse.move(probe.cursor.x, probe.cursor.y);
    const tooltip = await readTooltip(page);

    expect(
      {
        hidden: tooltip.hidden,
        namesTheNode: tooltip.text.includes(LONG_PATH_ID),
      },
      "hovering the node did not put its own label in the tooltip — the " +
        "hover event reached chrome with the wrong node, or with none",
    ).toEqual({ hidden: false, namesTheNode: true });

    expect(
      {
        widthMeasured: tooltip.offsetWidth > 0,
        heightMeasured: tooltip.offsetHeight > 0,
      },
      `\`tooltip.ts\` measured a ${tooltip.offsetWidth}x` +
        `${tooltip.offsetHeight} box, which is what it measures in jsdom. A ` +
        "flip decided on a zero-width box is not a flip decision at all, and " +
        "this whole file would be re-proving a vacuum",
    ).toEqual({ widthMeasured: true, heightMeasured: true });

    // Rendered wider than the gap it keeps from the cursor — otherwise the box
    // could never cross an edge the cursor has not, and the two edge tests
    // below would pass without a flip ever being needed.
    expect(
      tooltip.rect.width,
      `the rendered label is ${tooltip.rect.width}px wide, no wider than its ` +
        "own cursor offset, so no realistic cursor position can force a " +
        "horizontal flip. The long-path node exists to make the box big " +
        "enough that placing it beside the cursor genuinely overflows",
    ).toBeGreaterThan(OFFSET_PX * 4);
  });

  test("near the right edge it flips to the other side of the cursor", async ({
    page,
  }) => {
    await bootAtFixedSize(page);
    const canvas = await canvasBox(page);
    const probe = await placeNodeUnderCursor(page, canvas, {
      // Close enough to the edge that a box placed to the right of the cursor
      // cannot fit, far enough in that the node is still fully drawn.
      x: canvas.width - 40,
      y: canvas.height / 2,
    });
    expect(
      probe.pickedAtTarget,
      "the long-path node is not under the right-edge point, so the hover " +
        "would name no node and no tooltip would be positioned",
    ).toBe(LONG_PATH_ID);

    await page.mouse.move(probe.cursor.x, probe.cursor.y);
    const tooltip = await readTooltip(page);

    // The flip has to have been *necessary*, or "it stayed inside the window"
    // says nothing. Unflipped, the box would start `OFFSET_PX` right of the
    // cursor; assert that this would have overflowed.
    const unflippedRight = probe.cursor.x + OFFSET_PX + tooltip.rect.width;
    expect(
      { wouldOverflow: unflippedRight > tooltip.viewport.width },
      "placing the tooltip to the right of the cursor would have ended at " +
        `${unflippedRight}px in a ${tooltip.viewport.width}px window, which ` +
        "does not overflow — so this position does not exercise the flip and " +
        "the assertions below would pass for the wrong reason",
    ).toEqual({ wouldOverflow: true });

    expect(
      insideViewport(tooltip),
      `the tooltip's rendered rectangle ${JSON.stringify(tooltip.rect)} is ` +
        `not inside the ${tooltip.viewport.width}x${tooltip.viewport.height} ` +
        "window. FR-17's tooltip must never overflow the viewport, and this " +
        "is the first check of that made against a box with a real width",
    ).toEqual(ALL_EDGES_INSIDE);

    expect(
      tooltip.rect.right,
      `the tooltip's right edge (${tooltip.rect.right}) is not left of the ` +
        `cursor (${probe.cursor.x}); it stayed on the cursor's own side. ` +
        "That is the failure the tooltip module's header names: a tooltip " +
        "that does not move out from under the pointer hides the very node " +
        "it describes",
    ).toBeLessThanOrEqual(probe.cursor.x);

    // Flipped, not merely clamped: a clamp would leave the box as far right as
    // it fits, at `viewport.width - width`. A flip lands strictly left of
    // that, because the cursor is inside the window by more than the margin.
    // The two are different behaviours and only one keeps the node visible.
    expect(
      tooltip.rect.left,
      `the tooltip sits at ${tooltip.rect.left}px, which is where a clamp ` +
        `against the right edge would put it (${
          tooltip.viewport.width - tooltip.rect.width
        }px) rather than where a flip would`,
    ).toBeLessThan(tooltip.viewport.width - tooltip.rect.width);
  });

  test("near the bottom edge the rendered rectangle stays inside the window", async ({
    page,
  }) => {
    await bootAtFixedSize(page);
    const canvas = await canvasBox(page);
    const probe = await placeNodeUnderCursor(page, canvas, {
      x: 200,
      // As low as a pointer can go and still be over the canvas.
      y: canvas.height - 6,
    });
    expect(
      probe.pickedAtTarget,
      "the long-path node is not under the bottom-edge point, so the hover " +
        "would name no node and no tooltip would be positioned",
    ).toBe(LONG_PATH_ID);

    await page.mouse.move(probe.cursor.x, probe.cursor.y);
    const tooltip = await readTooltip(page);

    expect(
      insideViewport(tooltip),
      `with the cursor ${
        tooltip.viewport.height - probe.cursor.y
      }px from the bottom of the window, the tooltip's rendered rectangle ` +
        `${JSON.stringify(tooltip.rect)} leaves the ${tooltip.viewport.width}` +
        `x${tooltip.viewport.height} window`,
    ).toEqual(ALL_EDGES_INSIDE);

    // A measured defect, reported and deliberately **not** asserted either
    // way. `.tooltip` is `position: fixed` (`styles.css:315`), so its `left` /
    // `top` are **viewport** coordinates; but the `screen` point the hover
    // event carries is **canvas**-relative (`engine.ts:1789-1791` subtracts
    // the canvas' `rect.top`). The canvas sits below the header, so the
    // tooltip renders that far above the cursor and the vertical flip is
    // decided against the wrong origin. Measured at 1280x800: header 103px,
    // cursor 6px from the bottom of the window, tooltip top 705px against a
    // cursor at 794px — 89px high, and the bottom flip is unreachable by any
    // real pointer. Fixing it means changing `packages/viz/src/`, which AC-5
    // and AC-7 forbid this story, so it is written up with its numbers in
    // `docs/dev/epic-6/6.4-viz-reachability/README.md`.
    //
    // Nothing here asserts the offset, in either direction. A correct
    // implementation flips and stays inside the window, so the assertion above
    // survives the fix and no assertion has to be deleted to land it.
  });
});
