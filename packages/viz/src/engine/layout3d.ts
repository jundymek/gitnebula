/**
 * The 3D force layout — hand-rolled, importing no simulation library.
 *
 * **Why by hand.** `chrome/boundary.test.ts` pins the set of modules that may
 * import `d3-force` to exactly `["layout.ts"]`, and story 5.7 must leave that
 * test unchanged: if it needs editing, the seam is being violated. A
 * `d3-force` import here would turn that array into two entries and fail the
 * build. This is not a workaround — the prototype the story cites is
 * deliberately dependency-free for the same reason, and it is what keeps
 * ADR-0004's bundle budget. See `DECISIONS.md` D1.
 *
 * **What it simulates.** Top-level nodes only — modules and repository root
 * files — exactly like the 2D `ModuleLayout`, with member files waking in
 * local per-module simulations when a module unfolds (ADR-0006). 3D does not
 * get to show every file at once: that would be a *different map*, not the
 * same map from another angle, and `unfoldedModules()` is on the seam. It is
 * also what keeps the O(n²) repulsion at ~100 nodes instead of 2,000. See
 * `DECISIONS.md` D3.
 *
 * **Seeded everywhere.** Initial positions come from the AD-6 stream. There is
 * no unseeded randomness here and no clock — the same document lays out
 * identically on every load (AC-2).
 */

import type { Graph } from "./graph.js";
import type { Rng } from "./prng.js";
import { SETTLE_DISPLACEMENT_PX, SETTLE_FRAMES } from "./settle.js";

/**
 * Layout tuning. Derived from the prototype's values, which are the ones the
 * look was actually judged at; changing these changes the settle-timing test's
 * answer.
 */
export const CHARGE_3D = -260;
export const LINK_DISTANCE_3D = 70;
export const LINK_STRENGTH_3D = 0.09;
export const GRAVITY_3D = 0.012;

/**
 * Extra pull toward the anchor height, flattening the cloud into a disc rather
 * than a ball.
 *
 * Two reasons, neither decorative. The screen is wider than it is tall, and a
 * ball projects to a circle inscribed in the SHORTER axis - so on a 16:10
 * canvas a third of the width is unusable however well fit works, measured at
 * 28 percent of the width against 69 percent of the height. And yaw is the
 * axis idle rotation turns about, so a spheroid flattened about Y keeps its
 * silhouette as it spins rather than breathing between wide and narrow.
 *
 * It is also what the product has always claimed to draw. A nebula is a disc.
 *
 * 2.5 is measured: it takes the frame from 32 to 62 percent of the width and
 * 79 to 95 percent of the height with nothing clipped. Flattening harder fills
 * more but starts pushing nodes past the padding and drives overlap up, since
 * a tighter frame means larger discs.
 */
export const GRAVITY_Y_3D = 2.5;
export const DAMPING_3D = 0.55;
export const ALPHA_DECAY_3D = 0.015;
/** Below this the simulation has stopped doing useful work. */
export const ALPHA_MIN_3D = 0.02;

/** Hard stop so a layout that never converges cannot spin forever. */
export const SETTLE_FRAME_CAP_3D = 1800;

/** Initial scatter radius grows with the node count so density stays sane. */
export const SCATTER_RADIUS_PER_NODE_3D = 26;

/**
 * Minimum clear space between two node surfaces, in world units. Mirrors the
 * 2D layout's `COLLIDE_PADDING` / `MEMBER_COLLIDE_PADDING`.
 *
 * The 2D layout has had `forceCollide` since 2.5 and this had none. Collision
 * earns its place here as a **stabiliser** rather than as a separator: it is
 * what stops a spawn cluster from becoming a pile that repulsion then has to
 * resolve from a near-singularity.
 */
export const COLLIDE_PADDING_3D = 8;
/**
 * Member spacing, far larger than the 2D layout's 1.2, and deliberately so.
 *
 * In 2D the plane IS the screen, so collision separates exactly what the eye
 * sees and 1.2 is enough. In perspective the cloud is projected, and a ball of
 * N members projects onto a disc: readability depends on how much of that disc
 * the members cover, which goes as N * (r / R)^2. At 1.2 a 253-file module
 * settled into a ball 38 units across, whose members own discs summed to more
 * than the ball projected area - overlap was guaranteed by geometry before a
 * single frame was drawn.
 *
 * Chosen by measurement rather than by eye. On this repository packages/ (253
 * files), the share of node discs more than half hidden falls 63.4 -> 51.6 ->
 * 29.9 -> 17.7 percent at paddings 1.2, 6, 12 and 18.
 */
export const MEMBER_COLLIDE_PADDING_3D = 18;

/**
 * Hard ceiling on how far a node may travel in one tick, in world units.
 *
 * A backstop, not a tuning knob: with it, a bad configuration settles badly;
 * without it, a bad configuration leaves the number line. A 253-member module
 * on this repository reached coordinates of 4e13 before this existed, which
 * renders as nothing at all.
 */
export const MAX_STEP_3D = 24;

/** Member-wake tuning — tighter and faster, as the 2D member wake is. */
export const MEMBER_CHARGE_3D = -30;
export const MEMBER_LINK_DISTANCE_3D = 16;
export const MEMBER_LINK_STRENGTH_3D = 0.25;
export const MEMBER_PULL_3D = 0.03;
export const MEMBER_DAMPING_3D = 0.5;
export const MEMBER_ALPHA_DECAY_3D = 0.05;
export const MEMBER_SPAWN_RADIUS_3D = 12;
export const MEMBER_SETTLE_FRAME_CAP_3D = 240;

/** A node in the 3D simulation. */
export interface LayoutNode3D {
  /** Index into `Graph.nodes`. */
  readonly graphIndex: number;
  readonly id: string;
  readonly radius: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Axis-aligned bounds of a laid-out cloud, radii included. */
export interface Bounds3D {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * Settled for a three-axis layout (AD-6).
 *
 * A separate detector rather than `SettleDetector`, which measures
 * `hypot(dx, dy)` and is structurally blind to the third axis: a cloud that had
 * stopped moving in the plane while still expanding in depth would be reported
 * Settled, and the settle animation would freeze mid-motion. The *definition*
 * is not duplicated — both constants are imported from `settle.ts`, so AD-6
 * still has one home and a change there reaches both views.
 */
export class SettleDetector3D {
  private prev: Float64Array | null = null;
  private quietFrames = 0;

  lastMaxDisplacement = 0;
  frames = 0;

  /** Feed one frame of positions. Returns true once Settled. */
  frame(nodes: readonly LayoutNode3D[]): boolean {
    this.frames++;
    const n = nodes.length;
    // A different node count is a different node set: re-baseline rather than
    // compare positions that do not belong to the same nodes.
    if (this.prev === null || this.prev.length !== n * 3) {
      const prev = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) {
        const node = nodes[i]!;
        prev[i * 3] = node.x;
        prev[i * 3 + 1] = node.y;
        prev[i * 3 + 2] = node.z;
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
      const dx = node.x - prev[i * 3]!;
      const dy = node.y - prev[i * 3 + 1]!;
      const dz = node.z - prev[i * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > max) max = d;
      prev[i * 3] = node.x;
      prev[i * 3 + 1] = node.y;
      prev[i * 3 + 2] = node.z;
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

/** One link in a 3D simulation, by index into that simulation's node array. */
interface Link3D {
  readonly source: number;
  readonly target: number;
}

interface Forces3D {
  readonly charge: number;
  readonly linkDistance: number;
  readonly linkStrength: number;
  /** Pull toward the anchor point. */
  readonly gravity: number;
  readonly damping: number;
  readonly alphaDecay: number;
  /** Clear space kept between two node surfaces. */
  readonly collidePadding: number;
}

const ORIGIN = { x: 0, y: 0, z: 0 };

/**
 * One tick of the shared integrator.
 *
 * Repulsion is every pair — O(n²), which is affordable precisely because of
 * the D3 decision to simulate top-level nodes only. `anchor` is the point
 * gravity pulls toward: the origin for the module layout, the parent module's
 * position for a member wake.
 */
function tick3D(
  nodes: readonly LayoutNode3D[],
  links: readonly Link3D[],
  forces: Forces3D,
  alpha: number,
  anchor: { x: number; y: number; z: number },
): void {
  const n = nodes.length;

  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      // Softened at close range: two coincident nodes would otherwise divide
      // by ~0 and be thrown to opposite ends of the world in one tick.
      // Floor the **distance**, not the denominator.
      //
      // `Math.max(1, d2)` bounded the divisor but not the force: at d ~ 1 the
      // charge term is at its maximum, and a spawn cluster puts a large share
      // of all pairs there at once, every tick. On a 253-file module that
      // summed into a runaway — measured at 4e13 world units, i.e. a module
      // that renders as nothing. Flooring at the pair's own touching distance
      // makes the closest interesting case "just touching" rather than
      // "coincident", which is the physically meaningful bound.
      const touching = a.radius + b.radius + forces.collidePadding;
      const raw = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const d = Math.max(touching, raw, 1e-6);
      const d2 = d * d;
      // Charge scales with size, so a big module clears more space around it.
      const f = (forces.charge * alpha * (a.radius + b.radius) * 0.12) / d2;
      // Direction from the real separation; magnitude from the floored one.
      const unit = raw > 1e-6 ? raw : 1;
      const fx = (dx / unit) * f;
      const fy = (dy / unit) * f;
      const fz = (dz / unit) * f;
      a.vx += fx;
      a.vy += fy;
      a.vz += fz;
      b.vx -= fx;
      b.vy -= fy;
      b.vz -= fz;
    }
  }

  for (const link of links) {
    const a = nodes[link.source]!;
    const b = nodes[link.target]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const f = ((d - forces.linkDistance) / d) * forces.linkStrength * alpha;
    const fx = dx * f;
    const fy = dy * f;
    const fz = dz * f;
    a.vx += fx;
    a.vy += fy;
    a.vz += fz;
    b.vx -= fx;
    b.vy -= fy;
    b.vz -= fz;
  }

  for (const node of nodes) {
    node.vx -= (node.x - anchor.x) * forces.gravity * alpha;
    node.vy -= (node.y - anchor.y) * forces.gravity * GRAVITY_Y_3D * alpha;
    node.vz -= (node.z - anchor.z) * forces.gravity * alpha;
    node.vx *= forces.damping;
    node.vy *= forces.damping;
    node.vz *= forces.damping;
    // Backstop. A tick that wants to move a node further than this is not a
    // layout, it is a divergence, and clamping keeps it recoverable instead of
    // unbounded. Direction is preserved so a clamped step still points the
    // right way.
    const step = Math.sqrt(
      node.vx * node.vx + node.vy * node.vy + node.vz * node.vz,
    );
    if (step > MAX_STEP_3D) {
      const scale = MAX_STEP_3D / step;
      node.vx *= scale;
      node.vy *= scale;
      node.vz *= scale;
    }
    node.x += node.vx;
    node.y += node.vy;
    node.z += node.vz;
  }

  resolveCollisions(nodes, forces.collidePadding);
}

/**
 * Push overlapping nodes apart, on positions, after integration.
 *
 * Position-based and applied last, which is where d3's `forceCollide` sits and
 * for the same reason: a spring stiff enough to guarantee separation at this
 * density oscillates, and one soft enough to be stable does not separate. It
 * deliberately does **not** touch velocities — feeding the correction back
 * into momentum is what turns a separation pass into an energy source.
 *
 * Two passes damp the ping-pong where a node is pushed out of one neighbour
 * and into the next. It does not decay with alpha: "two solids may not occupy
 * the same space" is an invariant of the settled map, not a phase of reaching
 * it.
 */
function resolveCollisions(
  nodes: readonly LayoutNode3D[],
  padding: number,
): void {
  const n = nodes.length;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const wanted = a.radius + b.radius + padding;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= wanted * wanted) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) {
          // Coincident centres have no axis to separate along. Nudge along x
          // deterministically so the next pass has one (AD-6 untouched).
          a.x -= wanted / 4;
          b.x += wanted / 4;
          continue;
        }
        const push = (wanted - d) / 2 / d;
        a.x -= dx * push;
        a.y -= dy * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.y += dy * push;
        b.z += dz * push;
      }
    }
  }
}

const MODULE_FORCES: Forces3D = {
  charge: CHARGE_3D,
  linkDistance: LINK_DISTANCE_3D,
  linkStrength: LINK_STRENGTH_3D,
  gravity: GRAVITY_3D,
  damping: DAMPING_3D,
  alphaDecay: ALPHA_DECAY_3D,
  collidePadding: COLLIDE_PADDING_3D,
};

const MEMBER_FORCES: Forces3D = {
  charge: MEMBER_CHARGE_3D,
  linkDistance: MEMBER_LINK_DISTANCE_3D,
  linkStrength: MEMBER_LINK_STRENGTH_3D,
  gravity: MEMBER_PULL_3D,
  damping: MEMBER_DAMPING_3D,
  alphaDecay: MEMBER_ALPHA_DECAY_3D,
  collidePadding: MEMBER_COLLIDE_PADDING_3D,
};

/**
 * The top-level 3D layout for one loaded document: modules and root files.
 * Construct it, then tick until `tick()` reports Settled.
 */
export class ModuleLayout3D {
  readonly nodes: readonly LayoutNode3D[];
  private readonly links: readonly Link3D[];
  private readonly detector = new SettleDetector3D();
  private alpha = 1;

  settled = false;
  frames = 0;

  constructor(graph: Graph, rng: Rng) {
    const nodes: LayoutNode3D[] = graph.topLevelIndices.map((graphIndex) => {
      const node = graph.nodes[graphIndex]!;
      return {
        graphIndex,
        id: node.id,
        radius: node.radius,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      };
    });
    scatterSphere(nodes, rng);

    const byId = new Map(nodes.map((node, index) => [node.id, index]));
    const links: Link3D[] = [];
    for (const edge of topLevelLinks3D(graph)) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source === undefined || target === undefined) continue;
      links.push({ source, target });
    }

    this.nodes = nodes;
    this.links = links;
  }

  /** Advance one frame. Returns true once the layout is Settled (AD-6). */
  tick(): boolean {
    if (this.settled) return true;
    tick3D(this.nodes, this.links, MODULE_FORCES, this.alpha, ORIGIN);
    this.alpha *= 1 - MODULE_FORCES.alphaDecay;
    this.frames++;
    if (this.detector.frame(this.nodes)) this.settled = true;
    else if (this.alpha < ALPHA_MIN_3D) this.settled = true;
    else if (this.frames >= SETTLE_FRAME_CAP_3D) this.settled = true;
    return this.settled;
  }

  /** Tick to Settled in one go — the reduced-motion path and the tests. */
  runToSettled(): number {
    while (!this.tick());
    return this.frames;
  }

  get lastMaxDisplacement(): number {
    return this.detector.lastMaxDisplacement;
  }

  /** True when the frame cap stopped the run rather than convergence. */
  get timedOut(): boolean {
    return this.settled && this.frames >= SETTLE_FRAME_CAP_3D;
  }

  bounds(): Bounds3D | null {
    return bounds3D(this.nodes);
  }
}

/**
 * The local wake of one unfolded module's member files (ADR-0006).
 *
 * As in 2D, the guarantee that unfolding cannot disturb the global layout is
 * structural rather than tuned: **the module nodes are not in this simulation
 * at all**, so no force it applies can reach one.
 */
export class MemberLayout3D {
  readonly nodes: readonly LayoutNode3D[];
  private readonly links: readonly Link3D[];
  private readonly detector = new SettleDetector3D();
  private readonly anchor: { x: number; y: number; z: number };
  private alpha = 1;

  settled = false;
  frames = 0;

  constructor(
    anchor: { x: number; y: number; z: number },
    members: readonly { graphIndex: number; id: string; radius: number }[],
    links: readonly { source: string; target: string }[],
    rng: Rng,
  ) {
    this.anchor = anchor;
    // A seeded spherical shell centred on the module: members start spread
    // rather than piled on one point, which keeps the first tick out of the
    // repulsion singularity — the 2D wake's lesson, in one more dimension.
    const nodes: LayoutNode3D[] = members.map((member) => {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const r = MEMBER_SPAWN_RADIUS_3D * Math.cbrt(rng());
      return {
        graphIndex: member.graphIndex,
        id: member.id,
        radius: member.radius,
        x: anchor.x + r * Math.sin(phi) * Math.cos(theta),
        y: anchor.y + r * Math.sin(phi) * Math.sin(theta),
        z: anchor.z + r * Math.cos(phi),
        vx: 0,
        vy: 0,
        vz: 0,
      };
    });

    const byId = new Map(nodes.map((node, index) => [node.id, index]));
    const simulationLinks: Link3D[] = [];
    for (const link of links) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      // A file importing outside this module is a real edge, but not one this
      // wake can resolve — it has no node for the far end.
      if (source === undefined || target === undefined) continue;
      simulationLinks.push({ source, target });
    }

    this.nodes = nodes;
    this.links = simulationLinks;
  }

  tick(): boolean {
    if (this.settled) return true;
    tick3D(this.nodes, this.links, MEMBER_FORCES, this.alpha, this.anchor);
    this.alpha *= 1 - MEMBER_FORCES.alphaDecay;
    this.frames++;
    if (this.detector.frame(this.nodes)) this.settled = true;
    else if (this.alpha < ALPHA_MIN_3D) this.settled = true;
    else if (this.frames >= MEMBER_SETTLE_FRAME_CAP_3D) this.settled = true;
    return this.settled;
  }

  runToSettled(): number {
    while (!this.tick());
    return this.frames;
  }

  get lastMaxDisplacement(): number {
    return this.detector.lastMaxDisplacement;
  }
}

/** World-space bounds of a laid-out cloud, radii included. */
export function bounds3D(nodes: readonly LayoutNode3D[]): Bounds3D | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    minZ = Math.min(minZ, node.z - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
    maxZ = Math.max(maxZ, node.z + node.radius);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Seeded scatter through a sphere's interior.
 *
 * `cbrt(u)` for the radius rather than `u`: a uniform radius would pile most
 * of the cloud near the centre, because shell volume grows with r². The 2D
 * scatter uses `sqrt(u)` for exactly the same reason, one dimension down.
 * `acos(2u - 1)` for the polar angle, because a uniform phi clusters points at
 * the poles.
 */
function scatterSphere(nodes: LayoutNode3D[], rng: Rng): void {
  const radius = SCATTER_RADIUS_PER_NODE_3D * Math.sqrt(nodes.length || 1);
  for (const node of nodes) {
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const r = radius * Math.cbrt(rng());
    node.x = r * Math.sin(phi) * Math.cos(theta);
    node.y = r * Math.sin(phi) * Math.sin(theta);
    node.z = r * Math.cos(phi);
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
  }
}

/**
 * The links of the top-level layout — the same rule the 2D layout uses: every
 * module→module edge, plus file edges that touch a repository root file,
 * lifted to the top level (story 4.7).
 *
 * Deterministic by construction: contract order, and deduplicated through a
 * **nested map** rather than a joined string key.
 *
 * That last part is deliberate. The 2D `topLevelLinks` joins the two ids with
 * a literal NUL byte, which makes `layout.ts` classify as *binary* to
 * gitnebula's own scanner — the file lands in the map with `loc: 0` and none
 * of its imports (found by the 5.8 agent on a clean clone of
 * `epic/5-onboarding` at 4ffbee0; NUL at byte 8879, line 238). Copying that
 * idiom here would have given the 3D layout the same defect. A nested map
 * needs no separator at all, so there is no byte to choose badly.
 *
 * The defect in `layout.ts` itself is not this story's to fix and is left
 * alone; it is reported in the Dev Agent Record and the PR body.
 */
function topLevelLinks3D(graph: Graph): { source: string; target: string }[] {
  const topLevelIdOf = (index: number): string => {
    const node = graph.nodes[index]!;
    if (node.kind === "module") return node.id;
    return node.parent ?? node.id;
  };

  const links: { source: string; target: string }[] = [];
  const seen = new Map<string, Set<string>>();
  const add = (source: string, target: string): void => {
    if (source === target) return;
    let targets = seen.get(source);
    if (!targets) {
      targets = new Set();
      seen.set(source, targets);
    }
    if (targets.has(target)) return;
    targets.add(target);
    links.push({ source, target });
  };

  for (const edge of graph.moduleEdges) {
    add(graph.nodes[edge.source]!.id, graph.nodes[edge.target]!.id);
  }
  const rootFileIds = new Set(
    graph.rootFileIndices.map((index) => graph.nodes[index]!.id),
  );
  for (const edge of graph.fileEdges) {
    const source = topLevelIdOf(edge.source);
    const target = topLevelIdOf(edge.target);
    // Only edges touching a root file: a file edge between two modules' files
    // is already represented by the module edge it was aggregated into, and
    // lifting it again would double its pull.
    if (!rootFileIds.has(source) && !rootFileIds.has(target)) continue;
    add(source, target);
  }
  return links;
}
