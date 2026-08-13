/**
 * Frame-rate aggregation for the performance harness (FR-14, SM-2).
 *
 * Productionised from story 1.4's `perf-spike/src/fps.ts`: same sliding-window
 * definition of "sustained", same insistence that a run declares itself valid
 * or invalid rather than leaving the reader to notice. What changed is what is
 * being measured — 1.4 timed its own stand-in simulation and could therefore
 * report per-frame work directly; the harness drives the shipped engine
 * through the AD-5 seam, which owns its own frame loop. Frame *intervals* are
 * what an outside observer can honestly measure, so headroom is reported as
 * interval percentiles instead of as simulation+render time.
 *
 * Pure functions over a timestamp array: unit-testable with synthetic streams,
 * with no browser involved.
 */

export interface PhaseStats {
  readonly phase: string;
  /** Frame intervals counted (timestamps - 1). */
  readonly frames: number;
  readonly durationMs: number;
  readonly avgFps: number;
  /** Lowest frame count in any sliding 1-second window — "sustained" fps. */
  readonly worst1sFps: number;
  readonly medianIntervalMs: number;
  /** 95th-percentile frame interval — the stutter-relevant number. */
  readonly p95IntervalMs: number;
  readonly maxIntervalMs: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index]!;
}

export function aggregate(
  phase: string,
  timestamps: readonly number[],
): PhaseStats {
  if (timestamps.length < 2) {
    return {
      phase,
      frames: Math.max(0, timestamps.length - 1),
      durationMs: 0,
      avgFps: 0,
      worst1sFps: 0,
      medianIntervalMs: 0,
      p95IntervalMs: 0,
      maxIntervalMs: 0,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i]! - timestamps[i - 1]!);
  }
  const sorted = [...intervals].sort((a, b) => a - b);

  const first = timestamps[0]!;
  const last = timestamps[timestamps.length - 1]!;
  const durationMs = last - first;
  const frames = timestamps.length - 1;

  // A sliding 1 s window, because an average hides a stall: 59 fps mean with
  // one 300 ms freeze is not 59 fps to a person looking at the screen.
  let worst = Infinity;
  let hi = 0;
  for (let lo = 0; lo < timestamps.length; lo++) {
    const windowEnd = timestamps[lo]! + 1000;
    if (windowEnd > last) break;
    while (hi < timestamps.length && timestamps[hi]! <= windowEnd) hi++;
    const windowFrames = hi - lo - 1;
    if (windowFrames < worst) worst = windowFrames;
  }

  const avgFps = (frames / durationMs) * 1000;
  return {
    phase,
    frames,
    durationMs,
    avgFps,
    worst1sFps: worst === Infinity ? avgFps : worst,
    medianIntervalMs: percentile(sorted, 50),
    p95IntervalMs: percentile(sorted, 95),
    maxIntervalMs: sorted[sorted.length - 1]!,
  };
}

/**
 * The ways a run can look completely normal and mean nothing.
 *
 * 1.4 learned each of these the hard way: a backgrounded tab throttles or
 * suspends rAF and reports the throttle in the shape of a result; a fixture
 * that failed to load leaves a fallback graph that is not the yardstick; a
 * layout still in motion makes the pan phases measure a settling map. The
 * harness asserts on them rather than trusting them.
 */
export interface RunValidity {
  readonly documentEverHidden: boolean;
  readonly nodeCount: number;
  readonly moduleCount: number;
  readonly settledDurationMs: number;
}

export interface ValidityVerdict {
  readonly valid: boolean;
  readonly problems: readonly string[];
}

/** The 100-module / 2,000-file yardstick (FR-14, SM-2, ADR-0006). */
export const EXPECTED_MODULE_COUNT = 100;
export const EXPECTED_FILE_COUNT = 2000;
export const EXPECTED_NODE_COUNT = EXPECTED_MODULE_COUNT + EXPECTED_FILE_COUNT;

/** SM-2's automated floor. 60 is the target; 55 absorbs runner noise. */
export const FPS_FLOOR = 55;

export function checkValidity(run: RunValidity): ValidityVerdict {
  const problems: string[] = [];
  if (run.documentEverHidden) {
    problems.push(
      "the page was hidden during the run — rAF is throttled or suspended in " +
        "the background, so every fps number describes the throttle",
    );
  }
  if (run.nodeCount !== EXPECTED_NODE_COUNT) {
    problems.push(
      `expected the ${EXPECTED_NODE_COUNT}-node synthetic fixture, got ${run.nodeCount} nodes`,
    );
  }
  if (run.moduleCount !== EXPECTED_MODULE_COUNT) {
    problems.push(
      `expected ${EXPECTED_MODULE_COUNT} modules, got ${run.moduleCount}`,
    );
  }
  if (!(run.settledDurationMs >= 0)) {
    problems.push(
      "the layout never reached Settled — the pan phases would " +
        "have measured a map still in motion",
    );
  }
  return { valid: problems.length === 0, problems };
}
