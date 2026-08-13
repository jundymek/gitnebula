/**
 * The force layout: d3-force, ticked by hand.
 *
 * Two things are deliberate here.
 *
 * **Manual ticks.** The simulation is created stopped and advanced one tick
 * per rendered frame, so a frame's cost is simulation *plus* render — the way
 * story 1.4's spike measured it, and the only way the settle animation and
 * the frame budget describe the same thing.
 *
 * **Seeded everywhere.** Initial positions come from the AD-6 stream, and so
 * does d3's own `jiggle` (via `randomSource`) — without that second one, two
 * coincident nodes would pull an unseeded `Math.random()` and the same
 * document would settle into a slightly different map on every reload.
 *
 * 2.5 simulates module nodes only. File nodes wake in local, per-module
 * simulations when story 3.3 unfolds them (ADR-0006, and the spike's AC-5
 * findings: no `forceCenter` in a wake, members only, one wake per module).
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import type { Graph } from "./graph.js";
import type { Rng } from "./prng.js";
import { SettleDetector } from "./settle.js";

/** Layout tuning. Changing these changes the settle-timing test's answer. */
export const CHARGE_STRENGTH = -200;
export const LINK_DISTANCE = 90;
export const LINK_STRENGTH = 0.12;
export const COLLIDE_PADDING = 8;
export const GRAVITY = 0.02;
export const ALPHA_DECAY = 0.03;
export const VELOCITY_DECAY = 0.45;
/** Initial scatter radius grows with the node count so density stays sane. */
export const SCATTER_RADIUS_PER_NODE = 26;

/** Hard stop so a layout that never converges cannot spin forever. */
export const SETTLE_FRAME_CAP = 1800;

export interface LayoutNode extends SimulationNodeDatum {
  /** Index into `Graph.nodes`. */
  readonly graphIndex: number;
  readonly id: string;
  readonly radius: number;
  x: number;
  y: number;
}

type LayoutLink = SimulationLinkDatum<LayoutNode>;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The module-level layout for one loaded document. Construct it, then tick it
 * until `tick()` reports Settled.
 */
export class ModuleLayout {
  readonly nodes: readonly LayoutNode[];
  private readonly simulation: Simulation<LayoutNode, LayoutLink>;
  private readonly detector = new SettleDetector();

  settled = false;
  /** Ticks fed so far. */
  frames = 0;

  constructor(graph: Graph, rng: Rng) {
    const nodes: LayoutNode[] = graph.moduleIndices.map((graphIndex) => {
      const node = graph.nodes[graphIndex]!;
      return { graphIndex, id: node.id, radius: node.radius, x: 0, y: 0 };
    });
    const byId = new Map(nodes.map((node, index) => [node.id, index]));
    scatter(nodes, rng);

    const links: LayoutLink[] = [];
    for (const edge of graph.moduleEdges) {
      const source = byId.get(graph.nodes[edge.source]!.id);
      const target = byId.get(graph.nodes[edge.target]!.id);
      if (source === undefined || target === undefined) continue;
      links.push({ source, target });
    }

    this.nodes = nodes;
    this.simulation = forceSimulation<LayoutNode, LayoutLink>(nodes)
      .randomSource(rng)
      .alphaDecay(ALPHA_DECAY)
      .velocityDecay(VELOCITY_DECAY)
      .force("charge", forceManyBody<LayoutNode>().strength(CHARGE_STRENGTH))
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(links)
          .distance(LINK_DISTANCE)
          .strength(LINK_STRENGTH),
      )
      .force(
        "collide",
        forceCollide<LayoutNode>((node) => node.radius + COLLIDE_PADDING),
      )
      // forceX/forceY toward the origin rather than forceCenter: a centring
      // force pulls gently and lets the graph breathe, where forceCenter
      // translates the whole layout every tick and can mask real drift from
      // the Settled detector.
      .force("x", forceX<LayoutNode>(0).strength(GRAVITY))
      .force("y", forceY<LayoutNode>(0).strength(GRAVITY))
      .stop();
  }

  /** Advance one frame. Returns true once the layout is Settled (AD-6). */
  tick(): boolean {
    if (this.settled) return true;
    this.simulation.tick();
    this.frames++;
    if (this.detector.frame(this.nodes)) this.settled = true;
    else if (this.frames >= SETTLE_FRAME_CAP) this.settled = true;
    return this.settled;
  }

  /**
   * Tick synchronously until Settled — the reduced-motion path (which must
   * render an already-settled map) and the settle-timing test.
   * Returns the number of frames it took.
   */
  runToSettled(): number {
    while (!this.tick());
    return this.frames;
  }

  /** Max per-frame displacement seen on the most recent tick, in px. */
  get lastMaxDisplacement(): number {
    return this.detector.lastMaxDisplacement;
  }

  /** True when the frame cap stopped the run rather than convergence. */
  get timedOut(): boolean {
    return this.settled && this.frames >= SETTLE_FRAME_CAP;
  }

  /** World-space bounds of the laid-out nodes, radii included. */
  bounds(): Bounds | null {
    if (this.nodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x - node.radius);
      minY = Math.min(minY, node.y - node.radius);
      maxX = Math.max(maxX, node.x + node.radius);
      maxY = Math.max(maxY, node.y + node.radius);
    }
    return { minX, minY, maxX, maxY };
  }

  stop(): void {
    this.simulation.stop();
  }
}

/**
 * Seeded scatter over a disc. Rejection-free (√u for uniform area) and never
 * places two nodes at the same point, which keeps d3's jiggle out of the
 * common path even though `randomSource` has made it deterministic anyway.
 */
function scatter(nodes: LayoutNode[], rng: Rng): void {
  const radius = SCATTER_RADIUS_PER_NODE * Math.sqrt(nodes.length || 1);
  for (const node of nodes) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * Math.sqrt(rng());
    node.x = Math.cos(angle) * distance;
    node.y = Math.sin(angle) * distance;
    node.vx = 0;
    node.vy = 0;
  }
}
