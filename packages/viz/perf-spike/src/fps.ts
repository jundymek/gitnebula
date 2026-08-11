/**
 * Frame-rate recorder for the spike's measured phases. Feed it rAF timestamps
 * and, per frame, the time the frame's own work took. Aggregation is pure so
 * it can be unit-tested with synthetic streams.
 *
 * fps alone is a ceiling measurement: a vsync-capped 60 fps says the budget
 * was met but not by how much. The per-frame work time is what shows the
 * remaining headroom, so both are reported.
 */

export interface PhaseStats {
  phase: string;
  frames: number;
  durationMs: number;
  avgFps: number;
  /** Lowest fps over any sliding 1-second window — the "sustained" number. */
  worst1sFps: number;
  /** Mean simulation+render time per frame (ms), against a 16.7 ms budget. */
  meanWorkMs: number;
  /** 95th-percentile frame work (ms) — the stutter-relevant number. */
  p95WorkMs: number;
  maxWorkMs: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx]!;
}

export function aggregate(
  phase: string,
  timestamps: readonly number[],
  workMs: readonly number[] = [],
): PhaseStats {
  const sortedWork = [...workMs].sort((a, b) => a - b);
  const workStats = {
    meanWorkMs: workMs.length
      ? workMs.reduce((a, b) => a + b, 0) / workMs.length
      : 0,
    p95WorkMs: percentile(sortedWork, 95),
    maxWorkMs: sortedWork.length ? sortedWork[sortedWork.length - 1]! : 0,
  };

  if (timestamps.length < 2) {
    return {
      phase,
      frames: timestamps.length,
      durationMs: 0,
      avgFps: 0,
      worst1sFps: 0,
      ...workStats,
    };
  }
  const first = timestamps[0]!;
  const last = timestamps[timestamps.length - 1]!;
  const durationMs = last - first;
  const frames = timestamps.length - 1;
  const avgFps = (frames / durationMs) * 1000;

  // Sliding 1 s window: for each frame, count frames within the next 1000 ms.
  let worst = Infinity;
  let hi = 0;
  for (let lo = 0; lo < timestamps.length; lo++) {
    const windowEnd = timestamps[lo]! + 1000;
    if (windowEnd > last) break;
    while (hi < timestamps.length && timestamps[hi]! <= windowEnd) hi++;
    const windowFrames = hi - lo - 1;
    if (windowFrames < worst) worst = windowFrames;
  }
  const worst1sFps = worst === Infinity ? avgFps : worst;
  return { phase, frames, durationMs, avgFps, worst1sFps, ...workStats };
}

/** Collects rAF timestamps and per-frame work times per phase. */
export class FpsRecorder {
  private timestamps: number[] | null = null;
  private works: number[] = [];
  private currentPhase = "";
  readonly results: PhaseStats[] = [];

  start(phase: string): void {
    this.finish();
    this.currentPhase = phase;
    this.timestamps = [];
    this.works = [];
  }

  tick(timestampMs: number, workMs?: number): void {
    this.timestamps?.push(timestampMs);
    if (workMs !== undefined) this.works.push(workMs);
  }

  finish(): void {
    if (this.timestamps && this.timestamps.length > 0) {
      this.results.push(
        aggregate(this.currentPhase, this.timestamps, this.works),
      );
    }
    this.timestamps = null;
    this.works = [];
  }
}
