// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCameraPhase } from "./driver.js";

/**
 * `runCameraPhase` is serialised into the browser by `page.evaluate`, so it is
 * the one module the compiler cannot protect: a reference to anything outside
 * the function body throws only at run time, inside the page, as a
 * ReferenceError in a Playwright stack trace. Running it here — against a fake
 * rAF clock and a stub engine — is what keeps that from being discovered in a
 * perf run.
 */

const HANDLE_KEY = "__gitnebula_test";
const FRAME_MS = 1000 / 60;

/** A deterministic rAF clock: each frame advances by exactly one interval. */
function fakeRaf(intervalMs = FRAME_MS): { stop: () => void } {
  let now = 0;
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    now += intervalMs;
    setTimeout(() => callback(now), 0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
  return {
    stop: () => {
      globalThis.requestAnimationFrame = original;
    },
  };
}

interface Recorded {
  cameras: { x: number; y: number; k: number }[];
}

function publishStubEngine(): Recorded {
  const recorded: Recorded = { cameras: [] };
  (globalThis as unknown as Record<string, unknown>)[HANDLE_KEY] = {
    engine: {
      setCamera: (camera: { x: number; y: number; k: number }) =>
        recorded.cameras.push(camera),
    },
  };
  return recorded;
}

const script = [
  { atMs: 0, x: 0, y: 0, k: 1 },
  { atMs: 200, x: 100, y: 100, k: 2 },
];

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[HANDLE_KEY];
  vi.restoreAllMocks();
});

describe("runCameraPhase", () => {
  it("drives the camera along the script and records one timestamp per frame", async () => {
    const recorded = publishStubEngine();
    const raf = fakeRaf();
    const result = await runCameraPhase({
      handleKey: HANDLE_KEY,
      script,
      warmupFrames: 0,
    });
    raf.stop();

    expect(result.timestamps.length).toBe(recorded.cameras.length);
    expect(result.timestamps.length).toBeGreaterThan(10);
    // Monotonic, and the phase stops at the end of the script rather than
    // running until something else notices.
    const deltas = result.timestamps
      .slice(1)
      .map((t, i) => t - result.timestamps[i]!);
    expect(deltas.every((d) => d > 0)).toBe(true);
    expect(result.timestamps[result.timestamps.length - 1]!).toBeLessThan(
      200 + 2 * FRAME_MS,
    );
    // The last camera is the script's end state, not somewhere along the way.
    const last = recorded.cameras[recorded.cameras.length - 1]!;
    expect(last.k).toBeCloseTo(2, 1);
  });

  it("does not record the warm-up frames", async () => {
    const recorded = publishStubEngine();
    const raf = fakeRaf();
    const result = await runCameraPhase({
      handleKey: HANDLE_KEY,
      script,
      warmupFrames: 5,
    });
    raf.stop();

    // Warm-up frames move the camera (so the first measured frame is not also
    // the first frame that touched the engine) but are not measured.
    expect(recorded.cameras.length).toBe(result.timestamps.length + 5);
  });

  it("reports a hidden page instead of quietly measuring a throttled clock", async () => {
    publishStubEngine();
    const raf = fakeRaf();
    const hidden = vi
      .spyOn(document, "hidden", "get")
      .mockReturnValue(true as unknown as boolean);
    const result = await runCameraPhase({
      handleKey: HANDLE_KEY,
      script,
      warmupFrames: 0,
    });
    raf.stop();
    hidden.mockRestore();
    expect(result.everHidden).toBe(true);
  });

  it("fails loudly when the page published no harness handle", async () => {
    await expect(
      runCameraPhase({ handleKey: "__absent", script, warmupFrames: 0 }),
    ).rejects.toThrow(/no harness handle/);
  });

  it("refuses an empty script", async () => {
    publishStubEngine();
    await expect(
      runCameraPhase({ handleKey: HANDLE_KEY, script: [], warmupFrames: 0 }),
    ).rejects.toThrow(/empty camera script/);
  });
});
