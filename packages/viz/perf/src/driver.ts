/**
 * The in-page half of the harness.
 *
 * `runCameraPhase` is handed to `page.evaluate`, which serialises it and runs
 * it inside the browser — so it must be **self-contained**: no imports, no
 * module-scope references, everything it needs arrives in its argument. The
 * keyframe interpolation is therefore inlined rather than imported from
 * `camera-script.ts`, and `driver.test.ts` runs this exact function against a
 * stub engine and a fake rAF clock so the duplication stays honest.
 *
 * It drives the camera one step per animation frame and records the frame
 * clock. Frame *cadence* is the measurement: the engine owns its own loop
 * behind the AD-5 seam, so an outside observer can time the frames the browser
 * actually produced, which is also what a person looking at the screen sees.
 */

export interface CameraKeyframeInput {
  readonly atMs: number;
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface CameraPhaseArgs {
  /** Where the page published the engine (`HARNESS_HANDLE_KEY`). */
  readonly handleKey: string;
  readonly script: readonly CameraKeyframeInput[];
  /**
   * Frames to run before recording starts, so JIT warm-up and the first
   * post-settle repaint do not land inside the measured window.
   */
  readonly warmupFrames: number;
}

export interface CameraPhaseResult {
  readonly timestamps: number[];
  /** True if the page was hidden at any point — invalidates the run. */
  readonly everHidden: boolean;
}

export async function runCameraPhase(
  args: CameraPhaseArgs,
): Promise<CameraPhaseResult> {
  const handle = (globalThis as unknown as Record<string, { engine: unknown }>)[
    args.handleKey
  ];
  if (!handle) {
    throw new Error(`perf: no harness handle at globalThis.${args.handleKey}`);
  }
  const engine = handle.engine as {
    setCamera(camera: { x: number; y: number; k: number }): void;
  };

  const script = args.script;
  if (script.length === 0) throw new Error("perf: empty camera script");
  const durationMs = script[script.length - 1]!.atMs;

  const cameraAt = (tMs: number): { x: number; y: number; k: number } => {
    const first = script[0]!;
    if (tMs <= first.atMs) return { x: first.x, y: first.y, k: first.k };
    for (let i = 1; i < script.length; i++) {
      const prev = script[i - 1]!;
      const next = script[i]!;
      if (tMs <= next.atMs) {
        const t = (tMs - prev.atMs) / (next.atMs - prev.atMs);
        return {
          x: prev.x + (next.x - prev.x) * t,
          y: prev.y + (next.y - prev.y) * t,
          k: prev.k + (next.k - prev.k) * t,
        };
      }
    }
    const last = script[script.length - 1]!;
    return { x: last.x, y: last.y, k: last.k };
  };

  const timestamps: number[] = [];
  let everHidden = document.hidden;
  const onVisibility = (): void => {
    // Counting hidden frames is not enough on its own: a background tab can
    // have rAF suspended outright, and then no frame callback ever observes
    // the hidden state — precisely in the worst case.
    if (document.hidden) everHidden = true;
  };
  document.addEventListener("visibilitychange", onVisibility);

  try {
    await new Promise<void>((resolve) => {
      let warmupLeft = args.warmupFrames;
      let startMs: number | null = null;
      const frame = (nowMs: number): void => {
        if (document.hidden) everHidden = true;
        if (warmupLeft > 0) {
          warmupLeft--;
          engine.setCamera(cameraAt(0));
          requestAnimationFrame(frame);
          return;
        }
        if (startMs === null) startMs = nowMs;
        const elapsed = nowMs - startMs;
        engine.setCamera(cameraAt(elapsed));
        timestamps.push(nowMs);
        if (elapsed >= durationMs) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
  }

  return { timestamps, everHidden };
}
