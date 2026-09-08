import { expect, test, type Page } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";

/**
 * Story 6.2, AC-6 — **a click at real screen coordinates, on a canvas that is
 * not at the viewport origin.**
 *
 * The engine converts a pointer event to a canvas point in five places, always
 * as `event.clientX - rect.left, event.clientY - rect.top`
 * (`engine.ts:1139`, `:1791`, `:1812`, `:1841`, and `engine3d.ts:307`), where
 * `rect` comes from `canvas.getBoundingClientRect()`.
 *
 * Under jsdom that rect is a lie. `src/test-support/fake-canvas.ts:113-123`
 * monkeypatches `HTMLElement.prototype.getBoundingClientRect` — the whole
 * prototype, every element — to a fixed 1200x800 box at `x: 0, y: 0`, and
 * `devicePixelRatio` is always 1. So in every jsdom test the canvas sits
 * exactly at the viewport origin and `rect.left`/`rect.top` are both zero.
 *
 * The consequence is precise: **a bug in the rect-offset arithmetic subtracts
 * zero and is therefore invisible.** `engine.test.ts:290-305` scans a grid
 * with `pick()` and is an excellent test of the picking geometry, but it runs
 * against a canvas that cannot have an offset. In the real page the canvas is
 * inside `<main>`, below a `<header>` with `padding: 12px 18px` and a bottom
 * border, so `rect.top` is tens of pixels and the subtraction matters.
 *
 * This file is the one place that arithmetic is exercised for real: a click
 * dispatched at page coordinates by the browser, and a node the reader aimed
 * at that has to be the node that ends up selected.
 */

interface Target {
  /** The node the click is aimed at. */
  readonly id: string;
  /** Where it is, in canvas-local CSS pixels. */
  readonly x: number;
  readonly y: number;
  /**
   * What a rect-ignoring implementation would have picked from the same click
   * — i.e. `pick({ x, y: y + rect.top })`. Null when it would have hit
   * nothing at all.
   */
  readonly idIfOffsetIgnored: string | null;
}

/**
 * Find a node to aim at, and require the header offset to change the answer.
 *
 * The second condition is the whole test. A target for which
 * `pick({x, y})` and `pick({x, y + offset})` agree would be selected
 * correctly by a rect-ignoring implementation too, and the assertion would
 * pass while proving nothing. So the scan looks for a point where the two
 * disagree, and the test fails with a clear message if the map has no such
 * point rather than quietly settling for a weaker target.
 */
async function findDiscriminatingTarget(
  page: Page,
  key: string,
  offsetY: number,
): Promise<Target | null> {
  return page.evaluate(
    async ([handleKey, offset]) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: {
              pick(point: { x: number; y: number }): { id: string } | null;
              fit(): Promise<void>;
            };
            settled: Promise<unknown>;
          }
        >
      )[handleKey as string];
      if (!handle) throw new Error("no harness handle");
      await handle.settled;
      // Frame the whole graph so the scan is over a map that is actually on
      // screen, and await it: `fit` resolves when the movement is finished.
      await handle.engine.fit();

      const canvas = document.querySelector("#stage") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const shift = offset as number;

      // A coarse grid is enough — nodes are drawn as discs several pixels
      // across and `pick` carries a 7 px forgiveness margin of its own.
      for (let y = 4; y < rect.height; y += 4) {
        for (let x = 4; x < rect.width; x += 4) {
          const hit = handle.engine.pick({ x, y });
          if (!hit) continue;
          const ifIgnored = handle.engine.pick({ x, y: y + shift });
          if (ifIgnored?.id === hit.id) continue;
          return {
            id: hit.id,
            x,
            y,
            idIfOffsetIgnored: ifIgnored?.id ?? null,
          };
        }
      }
      return null;
    },
    [key, offsetY] as const,
  );
}

/** What `pick` answers right now at a canvas-local point. */
async function pickAt(
  page: Page,
  key: string,
  point: { x: number; y: number },
): Promise<string | null> {
  return page.evaluate(
    ([handleKey, at]) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: {
              pick(point: { x: number; y: number }): { id: string } | null;
            };
          }
        >
      )[handleKey as string];
      if (!handle) throw new Error("no harness handle");
      return handle.engine.pick(at as { x: number; y: number })?.id ?? null;
    },
    [key, point] as const,
  );
}

/** The engine's current selection, read through the interface. */
async function selectedId(page: Page, key: string): Promise<string | null> {
  return page.evaluate((handleKey) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        { engine: { getSelected(): { id: string } | null } }
      >
    )[handleKey];
    if (!handle) throw new Error("no harness handle");
    return handle.engine.getSelected()?.id ?? null;
  }, key);
}

test("a node clicked at real screen coordinates is the node that gets selected (AC-6)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);

  const stage = page.locator("#stage");
  const box = await stage.boundingBox();
  expect(
    box,
    "the stage canvas has no bounding box, so there is nothing to click",
  ).not.toBeNull();
  const canvasBox = box!;

  // Without this the rest of the test is vacuous. A canvas at the viewport
  // origin is exactly the jsdom situation, where `rect.top` is zero and the
  // subtraction under test does nothing. The header is what puts the canvas
  // further down the page, and the header is real here.
  expect(
    canvasBox.y,
    "the stage canvas starts at the top of the viewport, so this test is " +
      "running in the one geometry that cannot detect a rect-offset bug — " +
      "the same blind spot the jsdom fake canvas creates. Check that the " +
      "header rendered above <main>",
  ).toBeGreaterThan(0);

  const target = await findDiscriminatingTarget(
    page,
    HARNESS_HANDLE_KEY,
    canvasBox.y,
  );
  expect(
    target,
    "no point on the map distinguishes a correct click from one that ignored " +
      "the canvas' top offset, so a passing click would prove nothing. The " +
      "map may be too sparse, or fit() may not have framed it",
  ).not.toBeNull();
  const aim = target!;

  // The scan measured positions a moment ago. A settled layout should not be
  // moving, but a test that clicks where it looked earlier ought to say so
  // rather than assume it — and if the map *is* still drifting, that is worth
  // failing on here instead of as a mysterious wrong selection below.
  await page.waitForTimeout(150);
  const stillThere = await pickAt(page, HARNESS_HANDLE_KEY, {
    x: aim.x,
    y: aim.y,
  });
  expect(
    stillThere,
    `the map moved between measuring ${aim.id}'s position and clicking it, ` +
      "so the layout has not settled and this click is aimed at nothing in " +
      "particular",
  ).toBe(aim.id);

  // The click itself: page coordinates, dispatched by the browser, through
  // the real pointerdown/pointerup listeners the engine attached to the
  // canvas in its constructor.
  await page.mouse.click(canvasBox.x + aim.x, canvasBox.y + aim.y);

  expect(
    await selectedId(page, HARNESS_HANDLE_KEY),
    `clicking ${aim.id} at real screen coordinates selected something else. ` +
      "The engine converts clientY to a canvas point by subtracting " +
      `rect.top (${Math.round(canvasBox.y)} px here); had it not, this click ` +
      `would have landed on ${aim.idIfOffsetIgnored ?? "empty space"}`,
  ).toBe(aim.id);

  expect(pageErrors, "the page threw while handling the click").toEqual([]);
});

test("clicking empty space at real screen coordinates clears the selection (AC-6)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await openViewer(page);

  const canvasBox = (await page.locator("#stage").boundingBox())!;
  expect(
    canvasBox.y,
    "the stage canvas starts at the top of the viewport; see the sibling " +
      "test — this geometry cannot detect a rect-offset bug",
  ).toBeGreaterThan(0);

  // Select something first, so that "nothing is selected" at the end is a
  // change rather than the state the page booted in.
  await page.evaluate((handleKey) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        { engine: { setSelected(id: string): void } }
      >
    )[handleKey];
    if (!handle) throw new Error("no harness handle");
    handle.engine.setSelected("fp/proxy.py");
  }, HARNESS_HANDLE_KEY);
  expect(
    await selectedId(page, HARNESS_HANDLE_KEY),
    "the selection this test needs to clear was never established",
  ).toBe("fp/proxy.py");

  // A corner of the canvas, well away from a map that has just been framed.
  // `onPointerUp` is `setSelected(hit?.id ?? null)`: aiming at nothing has to
  // select nothing, which is how the panel closes.
  const emptyX = 6;
  const emptyY = canvasBox.height - 6;
  expect(
    await pickAt(page, HARNESS_HANDLE_KEY, { x: emptyX, y: emptyY }),
    "the corner this test treats as empty space has a node in it, so " +
      "clicking there would not test what it claims to",
  ).toBeNull();

  await page.mouse.click(canvasBox.x + emptyX, canvasBox.y + emptyY);

  expect(
    await selectedId(page, HARNESS_HANDLE_KEY),
    "clicking empty space at real screen coordinates did not clear the " +
      "selection. Aiming at nothing must select nothing — that is how a " +
      "reader closes the panel",
  ).toBeNull();

  expect(pageErrors, "the page threw while handling the click").toEqual([]);
});
