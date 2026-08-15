/**
 * Records the README's demo (story 4.3, FR-25; re-cut for Epic 5 by story 5.8).
 *
 * The recorder is Playwright — already a devDependency of `viz` for the
 * performance harness — driving the *real* served map with real pointer,
 * wheel and keyboard events, so what the GIF shows is what the product does.
 * Nothing here ships in the bundle; it is dev tooling, like `perf/`.
 *
 * The tour follows the **onboarding-first** flow the epic rebuilt the product
 * around: the map opens on an answer (the start-here panel), the reader takes
 * a file from it, and then narrows the map — drill-down, connected-only, layer
 * filter — rather than staring at everything at once. The pre-Epic-5 cut
 * opened by hovering a module to dim the other 647 nodes, which is precisely
 * the behaviour story 5.2 removed.
 *
 * Usage (see docs/recording-demo.md for the full recipe):
 *
 *     pnpm build
 *     node packages/cli/dist/bin/gitnebula.js . --no-open    # terminal 1
 *     DEMO_URL=http://127.0.0.1:4137/ node scripts/record-demo.mjs
 *
 * It writes `demo.webm` into `DEMO_OUT` (default: a fresh temp dir) and prints
 * that path; ffmpeg turns it into the committed GIF. A fixed name, deliberately:
 * re-running into the same directory must not leave two recordings behind for a
 * glob to pick up. Node positions are resolved through the
 * engine's public `pick()` rather than hardcoded coordinates, because the
 * layout is seeded per repository and a fixed (x, y) would point at empty
 * space the moment the demo is re-recorded on another checkout.
 */
import { createRequire } from "node:module";
import { mkdtempSync, renameSync } from "node:fs";
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
/** Which module the tour drills into. */
const TOUR_MODULE = process.env.DEMO_MODULE ?? "packages/";
/** Which layer the filter demo switches off and back on. */
const TOUR_LAYER = process.env.DEMO_LAYER ?? "test";

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
 * The file with the widest one-hop chain among those currently on screen,
 * optionally restricted to one module's members. Hovering *that* file is what
 * makes story 5.2's encoding readable on video: a file with two imports shows
 * almost nothing.
 */
async function widestChainFileOnScreen(page, moduleId) {
  return page.evaluate(
    ([handle, parent]) => {
      const engine = globalThis[handle]?.engine;
      const canvas = document.getElementById("stage");
      if (!engine || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      let best = null;
      for (let y = 0; y < canvas.clientHeight; y += 3) {
        for (let x = 0; x < canvas.clientWidth; x += 3) {
          const node = engine.pick({ x, y });
          if (!node || node.kind !== "file") continue;
          if (parent && node.parent !== parent) continue;
          const chain = engine.chainOf(node.id).length;
          if (!best || chain > best.chain)
            best = { x: x + rect.x, y: y + rect.y, chain };
        }
      }
      return best;
    },
    [HANDLE, moduleId ?? null],
  );
}

/**
 * Double-click a module until its scope actually opens.
 *
 * The point is re-resolved on every attempt, and that is not defensive
 * padding: moving the pointer onto a node wakes the layout (story 3.3), so the
 * module can drift several pixels between the scan that found it and the
 * gesture that wants it — landing the double-click on empty space or on a
 * neighbour, and leaving the recorder waiting for a scope bar that never
 * appears. The pre-Epic-5 script carried the same retry in its `clickNode`
 * helper for the same reason; dropping it made the tour a race.
 */
async function drillInto(page, moduleId, attempts = 4) {
  const scopeBar = page.locator("#scope-bar");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const point = await screenPointOf(page, moduleId);
    if (!point)
      throw new Error(
        `module not on screen after search: ${moduleId} — check DEMO_MODULE names a module the search can reach`,
      );
    await page.mouse.move(point.x, point.y, { steps: 20 });
    // Re-resolve after the move: the hover the move itself caused is exactly
    // what can have shifted the target.
    const settledPoint = (await screenPointOf(page, moduleId)) ?? point;
    await page.mouse.dblclick(settledPoint.x, settledPoint.y);
    try {
      await scopeBar.waitFor({ state: "visible", timeout: 2_500 });
      return;
    } catch {
      /* the module moved under the cursor, or the click missed — scan again */
    }
  }
  throw new Error(`double-clicking ${moduleId} never opened a scope`);
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

  // 1. The map opens on an answer: the start-here panel (5.1, UX-DR12).
  const startHere = page.locator("#start-here");
  await startHere.waitFor({ state: "visible", timeout: 10_000 });
  await wait(2_600);

  // 2. Take the first entry of the first category — a reading order, not an
  //    inventory. The camera flies there and the detail panel opens on arrival
  //    through story 3.3's existing flyTo + select path.
  const entry = page.locator("#start-here .sh-entry").first();
  await entry.hover();
  await wait(600);
  await entry.click();
  await page.locator("#panel").waitFor({ state: "visible", timeout: 10_000 });
  // The panel is where the git signals live: churn, authors and last change,
  // each labelled with the window they cover (5.5).
  await wait(2_600);

  // 2b. Blast radius (5.6) — what has historically been committed with this
  //     file. The start-here entry is deliberately the node this beat opens on:
  //     86% of nodes on this repository have no partners at all, so a randomly
  //     chosen node would record the empty state instead of the feature.
  const blastShow = page.locator("#panel .p-blast-show");
  if ((await blastShow.count()) > 0 && (await blastShow.isVisible())) {
    await wait(1_400);
    await blastShow.click();
    await wait(2_000);
    await blastShow.click();
    await wait(500);
  }
  await page.locator("#panel .p-close").click();
  await wait(400);

  // 3. Search for the module the tour drills into, and let the camera take us
  //    there. This is a beat in its own right (⌘K, type, pick), and it is also
  //    what makes the next step reliable: after step 2 the camera sits zoomed
  //    in on a ranked file, and a module that happens to be off-screen there
  //    cannot be found by a viewport scan. Arriving through search centres it.
  const search = page.getByRole("combobox", {
    name: "search files and modules",
  });
  await search.click();
  await search.pressSequentially(TOUR_MODULE, { delay: 100 });
  await wait(700);
  const firstResult = page.locator("li.search-result").first();
  try {
    await firstResult.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    throw new Error(
      `search found nothing for DEMO_MODULE="${TOUR_MODULE}" — it must match a module in the repository being recorded`,
    );
  }
  await firstResult.click();
  await wait(2_000);
  const arrivalPanel = page.locator("#panel .p-close");
  if (await arrivalPanel.isVisible()) {
    await arrivalPanel.click();
    await wait(300);
  }

  // 4. Drill down into that module (5.4). Double-click is the gesture — the
  //    single click already means "select". The scope pins the module open,
  //    so its files appear without touching the wheel.
  await drillInto(page, TOUR_MODULE);
  // A double-click is also a click, so the module's own panel opens over the
  // map. Close it: the point of this beat is what the *canvas* now carries.
  const modulePanel = page.locator("#panel .p-close");
  if (await modulePanel.isVisible()) {
    await modulePanel.click();
    await wait(300);
  }
  await wait(1_600);

  // 5. Hover a file inside the scope. The chain brightens and gains a ring;
  //    the rest of the map settles back rather than going dark (5.2).
  const filePoint = await widestChainFileOnScreen(page, TOUR_MODULE);
  if (filePoint) {
    await page.mouse.move(filePoint.x, filePoint.y, { steps: 24 });
    await wait(2_200);
  }

  // 6. Connected-only: the files carrying no import edge at all leave the
  //    frame, and the chrome states how many went (5.4, UX-DR14).
  const connected = page.locator("#scope-bar .scope-bar-connected");
  await connected.click();
  await wait(1_700);
  await connected.click();
  await wait(600);

  // 7. Escape leaves the scope — the whole map is back where it was, because
  //    scoping never re-ran the layout.
  await page.keyboard.press("Escape");
  await wait(1_400);

  // 8. Layer filter: a layer switched off is not drawn at all, not dimmed
  //    (5.3). Switching it back on restores it in place.
  const layerToggle = page.locator(`#layer-${TOUR_LAYER}`);
  await layerToggle.click();
  await wait(2_000);
  await layerToggle.click();
  await wait(900);

  // 9. The 3D view (5.7) — the same graph, with depth separating clusters that
  //    overlap in the plane. 2D is the default and the tour returns to it: the
  //    demo shows the alternative, it does not re-cast it as the product.
  //    The idle auto-rotation is what makes depth read on video, so this beat
  //    holds without touching the pointer — and does nothing under
  //    prefers-reduced-motion, which is deliberate in the view, not a bug here.
  const threeD = page.locator('#view-switch button[data-view="3d"]');
  if ((await threeD.count()) > 0 && !(await threeD.isDisabled())) {
    await threeD.click();
    await wait(3_600);
    await page.locator('#view-switch button[data-view="2d"]').click();
    await wait(1_200);
  }

  // 10. Heatmap mode — the same map coloured by churn instead of by layer.
  await page.locator("#mode-heat").click();
  await wait(2_200);

  // 11. PNG export — the button reports its own progress.
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.locator("#export").click();
  await download;
  await wait(1_600);

  await page.locator("#mode-structure").click();
  await wait(1_500);

  // Playwright names its recording after the page's GUID and only finalizes
  // it on close. Renaming it to a fixed name means the encode command can
  // point at ONE file: a run-per-random-name directory turns `*.webm` into
  // several inputs on the second run, and ffmpeg reads the extras as output
  // arguments.
  const video = page.video();
  await context.close();
  await browser.close();
  const recorded = video ? await video.path() : null;
  const target = path.join(OUT_DIR, "demo.webm");
  if (recorded && recorded !== target) renameSync(recorded, target);
  console.log(target);
}

await main();
