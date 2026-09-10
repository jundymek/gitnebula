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
import { FIT_PADDING_PX } from "../../src/engine/constants.js";
import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";

/**
 * Story 5.7 / AC-3, under NFR-13.
 *
 * The 2D spec asserts the ≥ 55 fps floor. This one **measures and records**,
 * because NFR-13 deliberately gives 3D two ways to pass: hold the same floor,
 * *or* document its own measured floor and the node count at which it
 * degrades. Asserting the 2D floor here would turn a documented, accepted
 * characteristic into a red build; asserting nothing at all would let an
 * unmeasured 3D view ship, which AC-3 forbids in as many words ("an unmeasured
 * 3D view does not satisfy this story").
 *
 * So what is asserted is that the run is **valid and real** — the fixture is
 * the right one, the page did not throw, the renderer actually drew the frames
 * that were counted — and the fps numbers are written to the report for
 * `PERFORMANCE.md` to quote. A number that embarrasses the branch is exactly
 * the number this file exists to produce.
 */

const WARMUP_FRAMES = 30;

test("3D: scripted pan+zoom on the 2,000-node fixture, measured and recorded", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));

  await page.addInitScript(installRenderCounter);
  await openViewer(page, { view: "3d" });

  const facts = await page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: {
            nodes: readonly { kind: string }[];
            getCamera(): { x: number; y: number; k: number };
            getOrientation?(): { yaw: number; pitch: number };
            fit(): Promise<void>;
          };
          settled: Promise<{ frames: number; durationMs: number }>;
        }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    const settled = await handle.settled;
    await handle.engine.fit();
    const stage = document.getElementById("stage");
    const rect = stage!.getBoundingClientRect();
    return {
      settled,
      camera: handle.engine.getCamera(),
      // Present only on the 3D engine — proof the 3D view is what is being
      // measured rather than a silent fallback to the 2D map.
      orientation: handle.engine.getOrientation?.() ?? null,
      viewport: { width: rect.width, height: rect.height },
      nodeCount: handle.engine.nodes.length,
      moduleCount: handle.engine.nodes.filter((n) => n.kind === "module")
        .length,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
    };
  }, HARNESS_HANDLE_KEY);

  // The run must be measuring 3D. Without this the spec would happily report
  // the 2D engine's numbers under a 3D heading the day the fallback triggers.
  expect(
    facts.orientation,
    "the harness handle exposes no orientation — the page fell back to the 2D view",
  ).not.toBeNull();

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
    renders.push({ phase: phase.name, frames: stats.frames, rendered });
  }

  const validity = checkValidity({
    documentEverHidden: everHidden,
    nodeCount: facts.nodeCount,
    moduleCount: facts.moduleCount,
    settledDurationMs: facts.settled.durationMs,
  });

  const { markdown, jsonPath } = writeReport(
    resolve(testInfo.project.testDir, "..", "report-3d"),
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
  console.log(`\n=== 3D ===\n${markdown}\nJSON: ${jsonPath}\n`);
  for (const phase of phases) {
    console.log(
      `3D ${phase.phase}: sustained ${phase.worst1sFps} fps, avg ` +
        `${phase.avgFps.toFixed(1)} fps, p95 interval ${phase.p95IntervalMs.toFixed(2)} ms`,
    );
  }
  await testInfo.attach("perf-report-3d.md", {
    body: markdown,
    contentType: "text/markdown",
  });

  // ---- what this spec asserts -------------------------------------------
  // Validity and reality, not the 2D floor (NFR-13). The fps numbers go to
  // the report and into PERFORMANCE.md.
  expect(failures, "the page threw during the run").toEqual([]);
  expect(validity.problems, "run validity").toEqual([]);
  for (const render of renders) {
    expect(
      render.rendered,
      `${render.phase}: the renderer drew ${render.rendered} frames against ` +
        `${render.frames} measured — the fps number would otherwise describe ` +
        "an empty animation loop",
    ).toBeGreaterThanOrEqual(Math.floor(render.frames * 0.9));
  }
  // A floor of its own, far below the 2D one: this is not the fps budget, it
  // is the line under which the 3D view would be unusable rather than merely
  // slower, and crossing it should fail a build rather than be written down.
  for (const phase of phases) {
    expect(
      phase.worst1sFps,
      `${phase.phase}: 3D fell below the usability floor`,
    ).toBeGreaterThan(20);
  }
});
