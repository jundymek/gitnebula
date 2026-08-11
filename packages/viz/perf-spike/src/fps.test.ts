import { describe, expect, it } from "vitest";
import { FpsRecorder, aggregate } from "./fps.js";

function steadyTimestamps(fps: number, seconds: number): number[] {
  const dt = 1000 / fps;
  const n = Math.round(fps * seconds) + 1;
  return Array.from({ length: n }, (_, i) => i * dt);
}

describe("aggregate", () => {
  it("computes avg fps from a steady 60 fps stream", () => {
    const s = aggregate("a", steadyTimestamps(60, 3));
    expect(s.avgFps).toBeCloseTo(60, 0);
    expect(s.worst1sFps).toBeGreaterThanOrEqual(59);
  });

  it("worst 1s window catches a stall the average hides", () => {
    // 2 s at 60 fps, then a 500 ms stall, then 2 s at 60 fps.
    const a = steadyTimestamps(60, 2);
    const last = a[a.length - 1]!;
    const b = steadyTimestamps(60, 2).map((t) => t + last + 500);
    const s = aggregate("stall", [...a, ...b]);
    expect(s.avgFps).toBeGreaterThan(50);
    expect(s.worst1sFps).toBeLessThan(45);
  });

  it("handles empty and single-frame streams", () => {
    expect(aggregate("x", []).avgFps).toBe(0);
    expect(aggregate("x", [16]).avgFps).toBe(0);
  });
});

describe("per-frame work statistics", () => {
  it("summarises work times independently of the fps cadence", () => {
    const ts = steadyTimestamps(60, 1);
    // One expensive frame among cheap ones: the mean hides it, p95/max do not.
    const work = ts.map((_, i) => (i === 0 ? 40 : 2));
    const s = aggregate("work", ts, work);
    expect(s.meanWorkMs).toBeLessThan(3);
    expect(s.maxWorkMs).toBe(40);
    expect(s.avgFps).toBeCloseTo(60, 0);
  });

  it("reports the 95th percentile, not the maximum", () => {
    const ts = steadyTimestamps(60, 2);
    // 10% of frames are slow: p95 must land in the slow group, below the max.
    const work = ts.map((_, i) => (i % 10 === 0 ? 10 + i / 100 : 1));
    const s = aggregate("p95", ts, work);
    expect(s.p95WorkMs).toBeGreaterThan(1);
    expect(s.p95WorkMs).toBeLessThanOrEqual(s.maxWorkMs);
  });

  it("defaults to zeros when no work times are fed", () => {
    const s = aggregate("none", steadyTimestamps(60, 1));
    expect(s.meanWorkMs).toBe(0);
    expect(s.p95WorkMs).toBe(0);
    expect(s.maxWorkMs).toBe(0);
  });
});

describe("FpsRecorder", () => {
  it("splits ticks into named phases", () => {
    const r = new FpsRecorder();
    r.start("a");
    for (const t of steadyTimestamps(60, 1)) r.tick(t);
    r.start("b");
    for (const t of steadyTimestamps(30, 1)) r.tick(t);
    r.finish();
    expect(r.results.map((p) => p.phase)).toEqual(["a", "b"]);
    expect(r.results[0]!.avgFps).toBeCloseTo(60, 0);
    expect(r.results[1]!.avgFps).toBeCloseTo(30, 0);
  });
});
