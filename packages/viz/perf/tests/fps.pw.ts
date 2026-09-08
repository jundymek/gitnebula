import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  extentFromFitCamera,
  panZoomScript,
  unfoldPanScript,
} from "../src/camera-script.js";
import { runCameraPhase } from "../src/driver.js";
import { installRenderCounter, takeRenderCount } from "../src/instrument.js";
import {
  aggregate,
  checkValidity,
  FPS_FLOOR,
  type PhaseStats,
} from "../src/measure.js";
import { openViewer } from "../../harness/page-helpers.js";
import { writeReport } from "../src/report.js";
// A deep import into the engine's constants: the AD-5 boundary rule governs
// `src/chrome`, which must not know the engine's internals. The harness is the
// opposite case — it exists to measure them — and reading the padding the
// camera actually used beats hard-coding a second copy of the number.
import { FIT_PADDING_PX } from "../../src/engine/constants.js";
import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";

/**
 * FR-14 / SM-2: pan and zoom sustain ≥ 55 fps on the 100-module / 2,000-file
 * fixture. Story 1.4 proved canvas 2D could; this asserts that the shipped
 * engine still does, on every run.
 */

/** Frames discarded before measurement — JIT warm-up and the first repaint. */
const WARMUP_FRAMES = 30;

test("scripted pan+zoom sustains the 55 fps floor on the 2,000-node fixture", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));

  // Before any page script: counting rAF callbacks alone would report a
  // healthy frame rate for a renderer that had stopped drawing.
  await page.addInitScript(installRenderCounter);
  await openViewer(page);

  // 1. Wait for Settled (AD-6) — the pan phases assume a frozen layout, and a
  //    map still in motion measures the settle, not the interaction.
  const facts = await page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: {
            nodes: readonly { kind: string }[];
            getCamera(): { x: number; y: number; k: number };
            fit(): Promise<void>;
          };
          settled: Promise<{ frames: number; durationMs: number }>;
        }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    const settled = await handle.settled;
    // The engine flies the camera to frame the graph once it settles; the
    // extent is read from where that flight lands, so wait for it.
    await handle.engine.fit();
    const stage = document.getElementById("stage");
    const rect = stage!.getBoundingClientRect();
    return {
      settled,
      camera: handle.engine.getCamera(),
      viewport: { width: rect.width, height: rect.height },
      nodeCount: handle.engine.nodes.length,
      moduleCount: handle.engine.nodes.filter((n) => n.kind === "module")
        .length,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
    };
  }, HARNESS_HANDLE_KEY);

  // 2. Derive the script from the measured extent (1.4's correction).
  const extent = extentFromFitCamera(
    facts.camera,
    facts.viewport,
    FIT_PADDING_PX,
  );

  const phases: PhaseStats[] = [];
  const renders: { phase: string; frames: number; rendered: number }[] = [];
  let everHidden = false;
  for (const phase of [
    { name: "b-frozen-pan-zoom", script: panZoomScript(extent) },
    { name: "c-unfold-pan", script: unfoldPanScript(extent) },
  ]) {
    await page.evaluate(takeRenderCount);
    const run = await page.evaluate(runCameraPhase, {
      handleKey: HARNESS_HANDLE_KEY,
      script: phase.script,
      warmupFrames: WARMUP_FRAMES,
    });
    const rendered = await page.evaluate(takeRenderCount);
    everHidden ||= run.everHidden;
    const stats = aggregate(phase.name, run.timestamps);
    phases.push(stats);
    renders.push({
      phase: phase.name,
      frames: stats.frames,
      rendered,
    });
  }

  // 3. Declare the run valid or invalid before reading a single fps number.
  const validity = checkValidity({
    documentEverHidden: everHidden,
    nodeCount: facts.nodeCount,
    moduleCount: facts.moduleCount,
    settledDurationMs: facts.settled.durationMs,
  });

  const { markdown, jsonPath } = writeReport(
    resolve(testInfo.project.testDir, "..", "report"),
    {
      runValid: validity.valid,
      problems: validity.problems,
      fpsFloor: FPS_FLOOR,
      fixture: {
        nodeCount: facts.nodeCount,
        moduleCount: facts.moduleCount,
        fileCount: facts.nodeCount - facts.moduleCount,
      },
      settle: facts.settled,
      canvas: {
        cssWidth: facts.viewport.width,
        cssHeight: facts.viewport.height,
        devicePixelRatio: facts.devicePixelRatio,
      },
      userAgent: facts.userAgent,
      phases,
      renders,
    },
  );
  console.log(`\n${markdown}\nJSON: ${jsonPath}\n`);
  await testInfo.attach("perf-report.md", {
    body: markdown,
    contentType: "text/markdown",
  });

  expect(failures, "the page threw during the run").toEqual([]);
  expect(validity.problems, "run validity").toEqual([]);
  // The frames were real renders, not an idle loop: an engine that stopped
  // drawing would still tick rAF and still report a healthy frame rate.
  for (const render of renders) {
    expect(
      render.rendered,
      `${render.phase}: the renderer drew ${render.rendered} frames against ` +
        `${render.frames} measured — the fps number would otherwise describe ` +
        "an empty animation loop",
    ).toBeGreaterThanOrEqual(Math.floor(render.frames * 0.9));
  }
  for (const phase of phases) {
    expect(
      phase.worst1sFps,
      `${phase.phase}: sustained fps must clear the ${FPS_FLOOR} floor (FR-14/SM-2)`,
    ).toBeGreaterThanOrEqual(FPS_FLOOR);
  }
});
