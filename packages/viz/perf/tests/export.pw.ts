import { expect, test } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../../harness/page-helpers.js";

/**
 * AC-1 and AC-2 in a real browser: the PNG is a ≥ 2× **re-render** of exactly
 * what is on screen, and it downloads under the mockup's filename.
 *
 * jsdom can prove the export issues the same draw calls as the frame
 * (`engine-export.test.ts`); only a real rasteriser can prove the resulting
 * pixels agree. The comparison is deliberately not against a golden image:
 * a golden would have to be regenerated whenever the map legitimately changes
 * — which stories 3.3 and 3.4 are about to do — whereas comparing the export
 * against the live canvas of the same instant stays true across those merges.
 */

/** Per-channel tolerance when comparing a 2× re-render downsampled back to 1×. */
const CHANNEL_TOLERANCE = 16;
/** Share of sampled pixels that must agree within that tolerance. */
const REQUIRED_AGREEMENT = 0.97;

interface ParityResult {
  readonly sampled: number;
  readonly agreeing: number;
  readonly meanAbsDiff: number;
  readonly exportWidth: number;
  readonly exportHeight: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/**
 * Runs inside the page. Reads the live canvas and captures the export in the
 * SAME synchronous turn: the hot-spot pulse is a function of time, so a frame
 * painted between the two reads would legitimately differ and the comparison
 * would be measuring the clock rather than the export.
 */
async function measureParity(args: {
  handleKey: string;
  tolerance: number;
  stride: number;
  /** When set, compare against this data URL instead of a fresh export. */
  reuseExportDataUrl?: string;
}): Promise<ParityResult> {
  const handle = (
    globalThis as unknown as Record<
      string,
      { engine: { exportPNG(): Promise<Blob> } }
    >
  )[args.handleKey];
  if (!handle)
    throw new Error(`no harness handle at globalThis.${args.handleKey}`);

  const stage = document.getElementById("stage") as HTMLCanvasElement;
  const ctx = stage.getContext("2d");
  if (!ctx) throw new Error("stage has no 2D context");
  const cssWidth = stage.clientWidth;
  const cssHeight = stage.clientHeight;

  // Synchronous pair: read the painted frame, then capture the scene.
  const live = ctx.getImageData(0, 0, stage.width, stage.height);
  const exported = args.reuseExportDataUrl
    ? await fetch(args.reuseExportDataUrl).then((r) => r.blob())
    : await handle.engine.exportPNG();

  const bitmap = await createImageBitmap(exported);
  const exportWidth = bitmap.width;
  const exportHeight = bitmap.height;

  // Downsample the export back to CSS resolution so the two images are
  // comparable at all: a 2x render is not a 1x render magnified, it is a
  // sharper drawing of the same thing.
  const down = new OffscreenCanvas(stage.width, stage.height);
  const downCtx = down.getContext("2d");
  if (!downCtx) throw new Error("offscreen has no 2D context");
  downCtx.drawImage(bitmap, 0, 0, stage.width, stage.height);
  const shrunk = downCtx.getImageData(0, 0, stage.width, stage.height);

  let sampled = 0;
  let agreeing = 0;
  let totalDiff = 0;
  for (let y = 0; y < stage.height; y += args.stride) {
    for (let x = 0; x < stage.width; x += args.stride) {
      const i = (y * stage.width + x) * 4;
      const dr = Math.abs(live.data[i]! - shrunk.data[i]!);
      const dg = Math.abs(live.data[i + 1]! - shrunk.data[i + 1]!);
      const db = Math.abs(live.data[i + 2]! - shrunk.data[i + 2]!);
      const worst = Math.max(dr, dg, db);
      sampled++;
      totalDiff += (dr + dg + db) / 3;
      if (worst <= args.tolerance) agreeing++;
    }
  }

  return {
    sampled,
    agreeing,
    meanAbsDiff: totalDiff / Math.max(1, sampled),
    exportWidth,
    exportHeight,
    cssWidth,
    cssHeight,
  };
}

/** Settle, frame the graph, and isolate a module so a highlight is active. */
async function prepare(page: import("@playwright/test").Page): Promise<string> {
  await openViewer(page);
  return page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: {
            nodes: readonly { id: string; kind: string }[];
            fit(): Promise<void>;
            setIsolated(id: string | null): void;
          };
          settled: Promise<unknown>;
        }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    await handle.settled;
    await handle.engine.fit();
    const target = handle.engine.nodes.find((n) => n.kind === "module")!;
    handle.engine.setIsolated(target.id);
    // Let one frame paint with the highlight before anything is compared.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return target.id;
  }, HARNESS_HANDLE_KEY);
}

test("exports a 2x re-render matching the visible canvas, highlight included (AC-1)", async ({
  page,
}) => {
  const isolated = await prepare(page);
  expect(isolated).toBeTruthy();

  const parity = await page.evaluate(measureParity, {
    handleKey: HARNESS_HANDLE_KEY,
    tolerance: CHANNEL_TOLERANCE,
    stride: 8,
  });

  // Resolution first: AD-5's floor is 2x the canvas CSS resolution.
  expect(parity.exportWidth).toBe(parity.cssWidth * 2);
  expect(parity.exportHeight).toBe(parity.cssHeight * 2);

  const agreement = parity.agreeing / parity.sampled;
  expect(
    parity.sampled,
    "the sample set must be large enough to mean something",
  ).toBeGreaterThan(10_000);
  expect(
    agreement,
    `only ${(agreement * 100).toFixed(2)}% of ${parity.sampled} sampled pixels ` +
      `matched (mean abs diff ${parity.meanAbsDiff.toFixed(2)})`,
  ).toBeGreaterThanOrEqual(REQUIRED_AGREEMENT);
  expect(parity.meanAbsDiff).toBeLessThan(4);
});

test("the parity check can fail: a stale export stops matching a changed screen", async ({
  page,
}) => {
  // The assertion above is only worth as much as its ability to fail. Export
  // with the highlight, then clear it, then compare that same PNG against the
  // now-undimmed canvas: a comparison that passed here would be measuring
  // nothing.
  await prepare(page);

  const dataUrl = await page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        { engine: { exportPNG(): Promise<Blob>; setIsolated(id: null): void } }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    const blob = await handle.engine.exportPNG();
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    handle.engine.setIsolated(null);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    return url;
  }, HARNESS_HANDLE_KEY);

  const parity = await page.evaluate(measureParity, {
    handleKey: HARNESS_HANDLE_KEY,
    tolerance: CHANNEL_TOLERANCE,
    stride: 8,
    reuseExportDataUrl: dataUrl,
  });

  const agreement = parity.agreeing / parity.sampled;
  expect(
    agreement,
    "an export taken under a different highlight state must NOT match",
  ).toBeLessThan(REQUIRED_AGREEMENT);
});

test("downloads as gitnebula-<repo-name>.png (AC-2)", async ({ page }) => {
  await prepare(page);

  const repoName = await page.evaluate(
    () => document.querySelector("header .repo")?.textContent ?? "",
  );
  expect(repoName).toBeTruthy();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export"),
  ]);

  expect(download.suggestedFilename()).toBe(`gitnebula-${repoName}.png`);
});
