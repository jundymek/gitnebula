/**
 * Records the README's 30-second demo (story 4.3, FR-25).
 *
 * The recorder is Playwright — already a devDependency of `viz` for the
 * performance harness — driving the *real* served map with real pointer,
 * wheel and keyboard events, so what the GIF shows is what the product does.
 * Nothing here ships in the bundle; it is dev tooling, like `perf/`.
 *
 * Usage (see docs/recording-demo.md for the full recipe):
 *
 *     pnpm build
 *     node packages/cli/dist/gitnebula.js . --no-open     # terminal 1
 *     DEMO_URL=http://127.0.0.1:4137/ node scripts/record-demo.mjs
 *
 * It writes a WebM to `--out` (default: a temp dir it prints); ffmpeg turns
 * that into the committed GIF. Node positions are resolved through the
 * engine's public `pick()` rather than hardcoded coordinates, because the
 * layout is seeded per repository and a fixed (x, y) would point at empty
 * space the moment the demo is re-recorded on another checkout.
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(
  new URL("../packages/viz/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");

const URL_UNDER_TEST = process.env.DEMO_URL ?? "http://127.0.0.1:4137/";
const OUT_DIR =
  process.env.DEMO_OUT ?? mkdtempSync(path.join(tmpdir(), "gitnebula-demo-"));
/** The recording frame. 720p keeps the committed GIF small enough to inline. */
const SIZE = { width: 1280, height: 720 };
/** Which module the tour opens and unfolds. */
const TOUR_MODULE = process.env.DEMO_MODULE ?? "packages/";
/** What the search demo types, and which result it takes. */
const SEARCH_QUERY = process.env.DEMO_QUERY ?? "pipeline";

const HANDLE = "__gitnebula";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Page coordinates of a node, found by asking the engine what is under a
 * coarse grid of points. Public interface only (`pick`), no internals.
 *
 * `pick` speaks canvas-relative CSS pixels while Playwright's mouse speaks
 * viewport pixels, and the header pushes the canvas down the page — so the
 * canvas' own offset is added here, once, rather than at every call site.
 */
async function screenPointOf(page, id) {
  return page.evaluate(
    ([handle, target]) => {
      const engine = globalThis[handle]?.engine;
      const canvas = document.getElementById("stage");
      if (!engine || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      for (let y = 0; y < canvas.clientHeight; y += 3) {
        for (let x = 0; x < canvas.clientWidth; x += 3) {
          const node = engine.pick({ x, y });
          if (node?.id === target) return { x: x + rect.x, y: y + rect.y };
        }
      }
      return null;
    },
    [HANDLE, id],
  );
}

/**
 * Click a node and wait for its panel. The point is re-resolved on every
 * attempt: hovering wakes the layout (3.3), so a node can drift a few pixels
 * between the scan that found it and the click that wants it.
 */
async function clickNode(page, id, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const point = await screenPointOf(page, id);
    if (!point) throw new Error(`node not on screen: ${id}`);
    await page.mouse.click(point.x, point.y);
    try {
      await page
        .locator("#panel")
        .waitFor({ state: "visible", timeout: 2_000 });
      return point;
    } catch {
      /* the node moved under the cursor — scan again */
    }
  }
  throw new Error(`clicking ${id} never opened the panel`);
}

/** Wheel in `steps` times at a point, slowly enough to read as a zoom. */
async function zoomIn(page, point, steps) {
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, -120);
    await wait(70);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: SIZE },
    // The map's palette is authored for a dark canvas; the demo should not
    // depend on whatever the recording machine's OS theme happens to be.
    colorScheme: "dark",
    acceptDownloads: true,
  });
  const page = await context.newPage();

  await page.goto(URL_UNDER_TEST, { waitUntil: "load" });
  await page.waitForFunction((key) => key in globalThis, HANDLE, {
    timeout: 60_000,
  });
  // The settle is the first thing the demo shows (FR-12): let it run.
  await page.evaluate((key) => globalThis[key].settled, HANDLE);
  await wait(1_200);

  // 1. Hover a module — the dependency chain lights up, the rest dims.
  const modulePoint = await screenPointOf(page, TOUR_MODULE);
  if (!modulePoint) throw new Error(`module not on screen: ${TOUR_MODULE}`);
  await page.mouse.move(modulePoint.x, modulePoint.y, { steps: 24 });
  await wait(1_600);

  // 2. Click it — the panel carries the git signals.
  const clicked = await clickNode(page, TOUR_MODULE);
  await wait(2_600);
  await page.locator("#panel .p-close").click();
  await wait(500);

  // 3. Zoom past UNFOLD_ZOOM — the module opens into its files.
  await zoomIn(page, clicked, 16);
  await wait(1_400);

  // 4. Hover a file — one file's imports, isolated out of 300 nodes.
  const filePoint = await page.evaluate(
    ([handle, moduleId]) => {
      const engine = globalThis[handle]?.engine;
      const canvas = document.getElementById("stage");
      if (!engine || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      let best = null;
      for (let y = 0; y < canvas.clientHeight; y += 3) {
        for (let x = 0; x < canvas.clientWidth; x += 3) {
          const node = engine.pick({ x, y });
          if (node?.kind === "file" && node.parent === moduleId) {
            const chain = engine.chainOf(node.id).length;
            if (!best || chain > best.chain)
              best = { x: x + rect.x, y: y + rect.y, chain };
          }
        }
      }
      return best;
    },
    [HANDLE, TOUR_MODULE],
  );
  if (filePoint) {
    await page.mouse.move(filePoint.x, filePoint.y, { steps: 24 });
    await wait(2_000);
  }

  // 5. Search and fly to a result.
  const search = page.getByRole("combobox", {
    name: "search files and modules",
  });
  await search.click();
  await search.pressSequentially(SEARCH_QUERY, { delay: 110 });
  await wait(900);
  await page.locator("li.search-result").first().hover();
  await wait(300);
  await page.locator("li.search-result").first().click();
  await wait(2_800);
  await page.locator("#panel .p-close").click();
  await wait(400);

  // 6. Heatmap mode — the same map coloured by churn.
  await page.locator("#mode-heat").click();
  await wait(2_600);

  // 7. PNG export — the button reports its own progress.
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.locator("#export").click();
  await download;
  await wait(1_800);

  await page.locator("#mode-structure").click();
  await wait(1_500);

  await context.close();
  await browser.close();
  console.log(`video written under ${OUT_DIR}`);
}

await main();
