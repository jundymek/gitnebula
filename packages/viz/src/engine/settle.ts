/**
 * Settled, defined once (AD-6): max node displacement < 0.5 px/frame for 30
 * consecutive frames.
 *
 * One definition, three consumers — the FR-12 settle-timing test, the replay
 * control and the reduced-motion path — which is the whole point of AD-6
 * fixing it as a constant instead of leaving "settled" to each story.
 */

export const SETTLE_DISPLACEMENT_PX = 0.5;
export const SETTLE_FRAMES = 30;

export interface PositionedNode {
  x: number;
  y: number;
}

/** Feeds on frames of positions and reports the moment the layout is Settled. */
export class SettleDetector {
  private prev: Float64Array | null = null;
  private quietFrames = 0;

  /** Max displacement observed on the most recent frame, in px. */
  lastMaxDisplacement = 0;

  /** Frames fed since the last reset. */
  frames = 0;

  /** Feed one frame of positions. Returns true once Settled. */
  frame(nodes: readonly PositionedNode[]): boolean {
    this.frames++;
    const n = nodes.length;
    // A different node count is a different node set: re-baseline instead of
    // comparing positions that do not belong to the same nodes.
    if (this.prev === null || this.prev.length !== n * 2) {
      const prev = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const node = nodes[i]!;
        prev[i * 2] = node.x;
        prev[i * 2 + 1] = node.y;
      }
      this.prev = prev;
      this.quietFrames = 0;
      this.lastMaxDisplacement = Infinity;
      // An empty set has nothing to settle; treat it as already Settled so a
      // fixture with no nodes cannot hang the load path.
      return n === 0;
    }
    const prev = this.prev;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const node = nodes[i]!;
      const dx = node.x - prev[i * 2]!;
      const dy = node.y - prev[i * 2 + 1]!;
      const d = Math.hypot(dx, dy);
      if (d > max) max = d;
      prev[i * 2] = node.x;
      prev[i * 2 + 1] = node.y;
    }
    this.lastMaxDisplacement = max;
    this.quietFrames = max < SETTLE_DISPLACEMENT_PX ? this.quietFrames + 1 : 0;
    return this.quietFrames >= SETTLE_FRAMES;
  }

  reset(): void {
    this.prev = null;
    this.quietFrames = 0;
    this.lastMaxDisplacement = 0;
    this.frames = 0;
  }
}
