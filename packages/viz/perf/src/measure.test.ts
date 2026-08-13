import { describe, expect, it } from "vitest";

import {
  aggregate,
  checkValidity,
  EXPECTED_MODULE_COUNT,
  EXPECTED_NODE_COUNT,
  FPS_FLOOR,
} from "./measure.js";

/** `count` frames at a steady `intervalMs`, starting at `startMs`. */
function steady(count: number, intervalMs: number, startMs = 0): number[] {
  return Array.from({ length: count }, (_, i) => startMs + i * intervalMs);
}

describe("aggregate", () => {
  it("reports 60 fps for a steady 16.67 ms stream", () => {
    const stats = aggregate("b", steady(600, 1000 / 60));
    expect(stats.avgFps).toBeCloseTo(60, 5);
    // 59, not 60: a 1 s window over a 60 Hz stream contains 61 timestamps and
    // therefore 60 intervals, of which the window counts the 59 that both
    // endpoints fall inside. This is story 1.4's definition unchanged — its
    // three recorded runs all read "59 sustained" for a vsync-capped 60 Hz
    // display — and keeping it identical is what makes the two stories' numbers
    // comparable. The floor is 55, so the off-by-one never decides a verdict.
    expect(stats.worst1sFps).toBe(59);
    expect(stats.medianIntervalMs).toBeCloseTo(16.67, 1);
  });

  it("lets a single stall through worst1sFps that the average hides", () => {
    // 5 s at 60 fps with one 300 ms freeze in the middle. The mean barely
    // moves; the sustained number is what a person would have noticed.
    const before = steady(180, 1000 / 60);
    const after = steady(120, 1000 / 60, before[before.length - 1]! + 300);
    const stats = aggregate("stall", [...before, ...after]);
    expect(stats.avgFps).toBeGreaterThan(55);
    expect(stats.worst1sFps).toBeLessThan(FPS_FLOOR);
    expect(stats.maxIntervalMs).toBeCloseTo(300, 0);
  });

  it("reports the 95th-percentile interval, not just the worst", () => {
    const timestamps = steady(100, 16);
    // One long frame: p95 stays near the median, max does not.
    timestamps.push(timestamps[timestamps.length - 1]! + 100);
    const stats = aggregate("p95", timestamps);
    expect(stats.p95IntervalMs).toBeLessThan(20);
    expect(stats.maxIntervalMs).toBeCloseTo(100, 5);
  });

  it("degrades to zeroes rather than NaN on a stream too short to measure", () => {
    expect(aggregate("empty", [])).toMatchObject({ frames: 0, avgFps: 0 });
    expect(aggregate("one", [12])).toMatchObject({ frames: 0, avgFps: 0 });
  });

  it("falls back to the average when the run is shorter than the window", () => {
    const stats = aggregate("short", steady(20, 16));
    expect(stats.worst1sFps).toBeCloseTo(stats.avgFps, 5);
  });
});

describe("checkValidity — the ways a run looks normal and means nothing", () => {
  const good = {
    documentEverHidden: false,
    nodeCount: EXPECTED_NODE_COUNT,
    moduleCount: EXPECTED_MODULE_COUNT,
    settledDurationMs: 2400,
  };

  it("passes the yardstick run", () => {
    expect(checkValidity(good)).toEqual({ valid: true, problems: [] });
  });

  it("rejects a run measured on a hidden page", () => {
    const verdict = checkValidity({ ...good, documentEverHidden: true });
    expect(verdict.valid).toBe(false);
    expect(verdict.problems[0]).toMatch(/hidden/);
  });

  it("rejects a graph that is not the 2,000-node fixture", () => {
    expect(checkValidity({ ...good, nodeCount: 42 }).valid).toBe(false);
    expect(checkValidity({ ...good, moduleCount: 3 }).valid).toBe(false);
  });

  it("names every problem rather than only the first", () => {
    const verdict = checkValidity({
      documentEverHidden: true,
      nodeCount: 5,
      moduleCount: 1,
      settledDurationMs: 0,
    });
    expect(verdict.problems.length).toBe(3);
  });
});
