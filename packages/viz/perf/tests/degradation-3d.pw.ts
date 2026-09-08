import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { aggregate, FPS_FLOOR } from "../src/measure.js";
import { openViewer } from "../../harness/page-helpers.js";
import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";

/**
 * AC-3's second clause: **the node count at which 3D degrades.**
 *
 * `fps-3d.pw.ts` measures the two standard phases and finds that 3D holds the
 * floor while the map is folded and falls below it once modules unfold. That
 * says *that* it degrades but not *where*, and AC-3 asks for the node count.
 *
 * Method: hold the camera still, unfold the map, and sweep the drawn node
 * count with the **layer filter** — a frame concern that removes nodes without
 * re-running the layout (story 5.3), so every sample measures the same settled
 * map at a different density rather than a different map. At each step the
 * frame cadence is recorded for a fixed number of frames.
 *
 * The camera does not move during a sample. Render cost is what is being
 * isolated, and panning would fold camera work and unfold churn into it.
 */

/** Frames discarded at each step before recording — JIT and the first repaint. */
const WARMUP_FRAMES = 20;
/** Frames recorded per step. ~2 s at 60 fps, enough for a 1 s window. */
const SAMPLE_FRAMES = 120;

interface Sample {
  readonly layers: string[];
  readonly drawnNodes: number;
  readonly sustainedFps: number;
  readonly avgFps: number;
  readonly p95IntervalMs: number;
}

test("3D: where the frame rate degrades, by drawn node count (AC-3, NFR-13)", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));

  await openViewer(page, { view: "3d" });

  const setup = await page.evaluate(async (key) => {
    const handle = (
      globalThis as unknown as Record<
        string,
        {
          engine: {
            nodes: readonly { kind: string; layer: string }[];
            fit(): Promise<void>;
            setCamera(camera: { k: number }): void;
            getOrientation?(): unknown;
            unfoldedModules(): readonly string[];
          };
          settled: Promise<{ frames: number; durationMs: number }>;
        }
      >
    )[key];
    if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
    await handle.settled;
    await handle.engine.fit();
    // Above UNFOLD_ZOOM: modules in view unfold into their files, which is the
    // dense case this sweep is about.
    handle.engine.setCamera({ k: 2.2 });
    return {
      is3D: handle.engine.getOrientation !== undefined,
      nodeCount: handle.engine.nodes.length,
      layers: [...new Set(handle.engine.nodes.map((n) => n.layer))].sort(),
      unfolded: handle.engine.unfoldedModules().length,
    };
  }, HARNESS_HANDLE_KEY);

  expect(setup.is3D, "the page fell back to the 2D view").toBe(true);
  expect(
    setup.unfolded,
    "nothing unfolded — the sweep would be flat",
  ).toBeGreaterThan(0);

  // Progressively narrower layer sets: each removes nodes from the frame
  // without touching the layout.
  const subsets: string[][] = [];
  for (let take = setup.layers.length; take >= 1; take--) {
    subsets.push(setup.layers.slice(0, take));
  }

  const samples: Sample[] = [];
  for (const layers of subsets) {
    const result = await page.evaluate(
      async (args: {
        key: string;
        layers: string[];
        warmup: number;
        frames: number;
      }) => {
        const handle = (
          globalThis as unknown as Record<
            string,
            {
              engine: {
                setLayerFilter(layers: readonly string[]): void;
                buildScene(
                  timeMs: number,
                ): { nodes: readonly unknown[] } | null;
              };
            }
          >
        )[args.key]!;
        handle.engine.setLayerFilter(args.layers);
        // Counted from the scene the renderer is actually handed, not from
        // `hiddenCount().visible`.
        //
        // The interface documents that field as the survivors of every filter
        // including 5.3's layers, but its implementation short-circuits to
        // `graph.nodes.length` whenever no scope and no connected-only filter
        // is active — so with layers alone it reports the whole document and
        // this sweep would have been flat at 2,100 for every sample. The 2D
        // engine behaves the same way; it is a pre-existing inconsistency in
        // another story's code, reported rather than fixed here.
        //
        // `buildScene` is a class member rather than an interface one, which
        // is exactly right for a measurement: it is the frame itself.
        const drawnNodes = handle.engine.buildScene(0)?.nodes.length ?? 0;

        const timestamps: number[] = [];
        await new Promise<void>((done) => {
          let warmupLeft = args.warmup;
          const frame = (nowMs: number): void => {
            if (warmupLeft > 0) {
              warmupLeft--;
              requestAnimationFrame(frame);
              return;
            }
            timestamps.push(nowMs);
            if (timestamps.length >= args.frames) done();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        return { drawnNodes, timestamps };
      },
      {
        key: HARNESS_HANDLE_KEY,
        layers,
        warmup: WARMUP_FRAMES,
        frames: SAMPLE_FRAMES,
      },
    );

    const stats = aggregate(layers.join("+"), result.timestamps);
    samples.push({
      layers,
      drawnNodes: result.drawnNodes,
      sustainedFps: stats.worst1sFps,
      avgFps: stats.avgFps,
      p95IntervalMs: stats.p95IntervalMs,
    });
  }

  const ordered = [...samples].sort((a, b) => a.drawnNodes - b.drawnNodes);
  const rows = ordered
    .map(
      (s) =>
        `| ${s.drawnNodes} | ${Math.round(s.sustainedFps)} | ${s.avgFps.toFixed(1)} | ` +
        `${s.p95IntervalMs.toFixed(2)} ms | ${
          s.sustainedFps >= FPS_FLOOR ? "holds" : "below"
        } |`,
    )
    .join("\n");

  const holds = ordered.filter((s) => s.sustainedFps >= FPS_FLOOR);
  const below = ordered.filter((s) => s.sustainedFps < FPS_FLOOR);
  const knee =
    holds.length > 0 && below.length > 0
      ? `Degrades between **${holds[holds.length - 1]!.drawnNodes}** and ` +
        `**${below[0]!.drawnNodes}** drawn nodes.`
      : holds.length === ordered.length
        ? `Holds the ${FPS_FLOOR} fps floor at every sampled density, up to ` +
          `**${ordered[ordered.length - 1]!.drawnNodes}** drawn nodes.`
        : `Below the ${FPS_FLOOR} fps floor at every sampled density, from ` +
          `**${ordered[0]!.drawnNodes}** drawn nodes up.`;

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const markdown = [
    "# 3D degradation curve (AC-3, NFR-13)",
    "",
    `Fixture: ${setup.nodeCount} nodes, ${setup.unfolded} modules unfolded, camera held still at k = 2.2.`,
    `Density swept with the layer filter; ${SAMPLE_FRAMES} frames per sample after ${WARMUP_FRAMES} warm-up frames.`,
    "",
    `| drawn nodes | sustained fps (worst 1 s) | avg fps | p95 frame | vs ${FPS_FLOOR} fps floor |`,
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
    knee,
    "",
    `User agent: ${userAgent}`,
    "",
  ].join("\n");

  const dir = resolve(testInfo.project.testDir, "..", "report-3d");
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(dir, "degradation.json");
  writeFileSync(
    jsonPath,
    `${JSON.stringify({ fpsFloor: FPS_FLOOR, setup, samples: ordered }, null, 2)}\n`,
  );
  writeFileSync(resolve(dir, "degradation.md"), markdown);
  console.log(`\n${markdown}\nJSON: ${jsonPath}\n`);
  await testInfo.attach("degradation-3d.md", {
    body: markdown,
    contentType: "text/markdown",
  });

  expect(failures, "the page threw during the run").toEqual([]);
  // The sweep has to actually vary density, or the curve says nothing.
  expect(
    ordered[ordered.length - 1]!.drawnNodes,
    "the layer filter did not change the drawn node count",
  ).toBeGreaterThan(ordered[0]!.drawnNodes);
});
