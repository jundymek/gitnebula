/**
 * Settled definition per AD-6: max node displacement < 0.5 px/frame for
 * 30 consecutive frames. These constants are the single tunable referenced by
 * the FR-12 test, the replay control and the reduced-motion path.
 */

export const SETTLE_DISPLACEMENT_PX = 0.5;
export const SETTLE_FRAMES = 30;

export interface PositionedNode {
  x: number;
  y: number;
}

/** Tracks per-frame max displacement over a node set and reports Settled. */
export class SettleDetector {
  private prev: Float64Array | null = null;
  private quietFrames = 0;
  /** Max displacement seen on the most recent frame (px). */
  lastMaxDisplacement = 0;

  /** Feed one frame of positions. Returns true once Settled. */
  frame(nodes: readonly PositionedNode[]): boolean {
    const n = nodes.length;
    // A changed node count means a different node set: re-baseline rather than
    // compare positions of nodes that are not the same nodes.
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
      return false;
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
  }
}
