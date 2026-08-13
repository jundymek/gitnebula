/**
 * The run's report (AC-3: "a readable report").
 *
 * Two artefacts, on purpose: JSON because a number that cannot be diffed
 * between runs is not evidence, and Markdown because a table someone reads is
 * the only reason the JSON gets looked at at all. Both land in
 * `perf/report/`, which is gitignored — the numbers that matter are copied
 * into `docs/dev/epic-3/3.5-viz-export-perf/PERFORMANCE.md` by hand, where
 * they are reviewed rather than regenerated.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { FPS_FLOOR, type PhaseStats } from "./measure.js";

export interface PerfReport {
  readonly runValid: boolean;
  readonly problems: readonly string[];
  readonly fpsFloor: number;
  readonly fixture: {
    readonly nodeCount: number;
    readonly moduleCount: number;
    readonly fileCount: number;
  };
  readonly settle: { readonly frames: number; readonly durationMs: number };
  readonly canvas: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly devicePixelRatio: number;
  };
  readonly userAgent: string;
  readonly phases: readonly PhaseStats[];
  /**
   * Frames the renderer actually drew, per phase, against frames measured. The
   * fps column means nothing without it: rAF keeps firing at full rate for a
   * renderer that has stopped drawing.
   */
  readonly renders: readonly {
    readonly phase: string;
    readonly frames: number;
    readonly rendered: number;
  }[];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatReport(report: PerfReport): string {
  const lines: string[] = [];
  lines.push("# gitnebula perf harness — run report", "");
  lines.push(
    report.runValid
      ? "**Run is valid.**"
      : "**INVALID RUN — the numbers below are not evidence:**",
  );
  for (const problem of report.problems) lines.push(`- ${problem}`);
  lines.push("");
  lines.push(
    `Fixture: ${report.fixture.moduleCount} modules / ${report.fixture.fileCount} files ` +
      `(${report.fixture.nodeCount} nodes). ` +
      `Canvas ${report.canvas.cssWidth} x ${report.canvas.cssHeight} CSS px at DPR ` +
      `${report.canvas.devicePixelRatio}.`,
  );
  lines.push(
    `Settled in ${report.settle.frames} frames (${round(report.settle.durationMs)} ms).`,
    "",
  );
  lines.push(
    "| phase | sustained fps (worst 1 s) | avg fps | median frame | p95 frame | worst frame | verdict |",
    "| ----- | ------------------------- | ------- | ------------ | --------- | ----------- | ------- |",
  );
  for (const phase of report.phases) {
    const pass = phase.worst1sFps >= report.fpsFloor;
    lines.push(
      `| ${phase.phase} | **${round(phase.worst1sFps, 1)}** | ${round(phase.avgFps, 1)} | ` +
        `${round(phase.medianIntervalMs)} ms | ${round(phase.p95IntervalMs)} ms | ` +
        `${round(phase.maxIntervalMs)} ms | ${pass ? "pass" : "FAIL"} |`,
    );
  }
  lines.push("");
  for (const render of report.renders) {
    lines.push(
      `- ${render.phase}: renderer drew ${render.rendered} frames of ${render.frames} measured.`,
    );
  }
  lines.push("", `Floor: ${report.fpsFloor} fps sustained (SM-2, FR-14).`);
  lines.push(`User agent: ${report.userAgent}`, "");
  return lines.join("\n");
}

/** Writes both artefacts and returns the readable one, for the console. */
export function writeReport(
  outDir: string,
  report: PerfReport,
): { readonly markdown: string; readonly jsonPath: string } {
  const jsonPath = resolve(outDir, "perf-report.json");
  const markdownPath = resolve(outDir, "perf-report.md");
  const markdown = formatReport(report);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);
  return { markdown, jsonPath };
}

export { FPS_FLOOR };
