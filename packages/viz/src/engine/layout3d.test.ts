import { describe, expect, it } from "vitest";

import { buildGraph } from "./graph.js";
import {
  bounds3D,
  MemberLayout3D,
  ModuleLayout3D,
  SETTLE_FRAME_CAP_3D,
  SettleDetector3D,
  type LayoutNode3D,
} from "./layout3d.js";
import { mulberry32, seedFor } from "./prng.js";
import { SETTLE_DISPLACEMENT_PX, SETTLE_FRAMES } from "./settle.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

const rngFor = (name: string) => mulberry32(seedFor(name));

function node(over: Partial<LayoutNode3D> = {}): LayoutNode3D {
  return {
    graphIndex: 0,
    id: "n",
    radius: 5,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ...over,
  };
}

describe("SettleDetector3D", () => {
  it("reports Settled after enough quiet frames", () => {
    const detector = new SettleDetector3D();
    const nodes = [node()];
    detector.frame(nodes); // baseline
    let settled = false;
    for (let i = 0; i < SETTLE_FRAMES; i++) settled = detector.frame(nodes);
    expect(settled).toBe(true);
  });

  it("sees motion in the third axis that the 2D detector cannot", () => {
    // This is the whole reason the class exists: a cloud frozen in the plane
    // but still expanding in depth is NOT settled, and `SettleDetector`
    // measures hypot(dx, dy) only — it would report Settled here.
    const detector = new SettleDetector3D();
    const moving = [node()];
    detector.frame(moving);
    let settled = false;
    for (let i = 0; i < SETTLE_FRAMES * 2; i++) {
      moving[0]!.z += SETTLE_DISPLACEMENT_PX * 4;
      settled = detector.frame(moving);
    }
    expect(settled).toBe(false);
    expect(detector.lastMaxDisplacement).toBeGreaterThan(
      SETTLE_DISPLACEMENT_PX,
    );
  });

  it("resets its baseline when the node count changes", () => {
    const detector = new SettleDetector3D();
    detector.frame([node()]);
    // A different node set: comparing positions index-by-index would compare
    // two different nodes' coordinates.
    expect(detector.frame([node(), node({ id: "m" })])).toBe(false);
    expect(detector.lastMaxDisplacement).toBe(Infinity);
  });

  it("treats an empty node set as already Settled", () => {
    // Otherwise a fixture with no nodes hangs the load path forever.
    expect(new SettleDetector3D().frame([])).toBe(true);
  });
});

describe("ModuleLayout3D", () => {
  const document = loadContractFixture("cyclic-imports");

  it("simulates the top-level nodes, not every file (D3, ADR-0006)", () => {
    const graph = buildGraph(document);
    const layout = new ModuleLayout3D(graph, rngFor(document.repo.name));
    expect(layout.nodes).toHaveLength(graph.topLevelIndices.length);
    expect(layout.nodes.length).toBeLessThan(graph.nodes.length);
  });

  it("settles, and by convergence rather than by hitting the cap", () => {
    const graph = buildGraph(document);
    const layout = new ModuleLayout3D(graph, rngFor(document.repo.name));
    const frames = layout.runToSettled();
    expect(layout.settled).toBe(true);
    expect(frames).toBeLessThan(SETTLE_FRAME_CAP_3D);
    expect(layout.timedOut).toBe(false);
  });

  it("spreads the cloud across all three axes", () => {
    // A layout that settled into a plane would be a 2D map drawn through a
    // perspective transform — the depth would be decorative rather than real.
    const graph = buildGraph(document);
    const layout = new ModuleLayout3D(graph, rngFor(document.repo.name));
    layout.runToSettled();
    const bounds = bounds3D(layout.nodes)!;
    const depth = bounds.maxZ - bounds.minZ;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    expect(depth).toBeGreaterThan(0);
    // Depth is the same order of magnitude as the other two axes, not a
    // rounding error against them.
    expect(depth).toBeGreaterThan(Math.max(width, height) / 10);
  });

  it("actually simulates the third axis — forces move z, the scatter alone does not", () => {
    // Deliberately distinct from the spread assertion above, which the seeded
    // scatter satisfies on its own: an integrator that dropped `node.z +=
    // node.vz` still produces a cloud with depth, because the depth was there
    // before the first tick. What proves the third axis is simulated is that
    // z *changes* while settling.
    const graph = buildGraph(document);
    const layout = new ModuleLayout3D(graph, rngFor(document.repo.name));
    const scattered = layout.nodes.map((n) => n.z);
    layout.runToSettled();
    const settled = layout.nodes.map((n) => n.z);
    const moved = settled.filter(
      (z, i) => Math.abs(z - scattered[i]!) > SETTLE_DISPLACEMENT_PX,
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it("produces no NaN or Infinity anywhere in the settled cloud", () => {
    // A repulsion singularity propagates NaN through the whole simulation in
    // a couple of ticks, and a NaN position renders as nothing at all.
    const graph = buildGraph(document);
    const layout = new ModuleLayout3D(graph, rngFor(document.repo.name));
    layout.runToSettled();
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(Number.isFinite(n.z)).toBe(true);
    }
  });

  it("lays out identically from the same seed (AC-2, AD-6)", () => {
    const a = new ModuleLayout3D(
      buildGraph(document),
      rngFor(document.repo.name),
    );
    const b = new ModuleLayout3D(
      buildGraph(document),
      rngFor(document.repo.name),
    );
    a.runToSettled();
    b.runToSettled();
    expect(a.frames).toBe(b.frames);
    expect(a.nodes.map((n) => [n.id, n.x, n.y, n.z])).toEqual(
      b.nodes.map((n) => [n.id, n.x, n.y, n.z]),
    );
  });

  it("lays out differently from a different seed", () => {
    // Guards the determinism test above against passing because the layout
    // ignores its rng entirely.
    const a = new ModuleLayout3D(buildGraph(document), mulberry32(1));
    const b = new ModuleLayout3D(buildGraph(document), mulberry32(2));
    a.runToSettled();
    b.runToSettled();
    expect(a.nodes.map((n) => n.z)).not.toEqual(b.nodes.map((n) => n.z));
  });

  it("handles a document with a single node", () => {
    const single = loadContractFixture("single-module");
    const layout = new ModuleLayout3D(
      buildGraph(single),
      rngFor(single.repo.name),
    );
    expect(() => layout.runToSettled()).not.toThrow();
    expect(layout.settled).toBe(true);
  });

  it("settles the 2,000-node fixture's top level without hitting the cap", () => {
    // NFR-3's fixture. Only its ~100 top-level nodes enter the simulation
    // (D3), which is what keeps the hand-rolled O(n²) repulsion affordable.
    const synthetic = loadSyntheticFixture();
    const graph = buildGraph(synthetic);
    const layout = new ModuleLayout3D(graph, rngFor(synthetic.repo.name));
    layout.runToSettled();
    expect(layout.timedOut).toBe(false);
    expect(layout.nodes.length).toBeLessThan(graph.nodes.length / 5);
  });
});

describe("MemberLayout3D", () => {
  const anchor = { x: 100, y: -50, z: 25 };
  const members = [
    { graphIndex: 1, id: "a.ts", radius: 2 },
    { graphIndex: 2, id: "b.ts", radius: 2 },
    { graphIndex: 3, id: "c.ts", radius: 2 },
  ];

  it("keeps the wake local, clustered around its module's position", () => {
    const layout = new MemberLayout3D(anchor, members, [], mulberry32(7));
    layout.runToSettled();
    for (const n of layout.nodes) {
      const distance = Math.hypot(
        n.x - anchor.x,
        n.y - anchor.y,
        n.z - anchor.z,
      );
      expect(distance).toBeLessThan(120);
    }
  });

  it("contains only the module's own members — no force can reach a module", () => {
    // The ADR-0006 guarantee is structural: the module nodes are not in this
    // simulation at all, so "unfolding does not disturb the global layout" is
    // a set we never included rather than a balance we tuned.
    const layout = new MemberLayout3D(anchor, members, [], mulberry32(7));
    expect(layout.nodes.map((n) => n.id)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("drops a link whose far end is outside this module", () => {
    // A file importing across modules is a real edge, but this wake has no
    // node for the far end; it is drawn, never simulated here.
    const layout = new MemberLayout3D(
      anchor,
      members,
      [{ source: "a.ts", target: "elsewhere/x.ts" }],
      mulberry32(7),
    );
    expect(() => layout.runToSettled()).not.toThrow();
    expect(layout.settled).toBe(true);
  });

  it("is deterministic for a given seed (AD-6)", () => {
    const a = new MemberLayout3D(anchor, members, [], mulberry32(7));
    const b = new MemberLayout3D(anchor, members, [], mulberry32(7));
    a.runToSettled();
    b.runToSettled();
    expect(a.nodes.map((n) => [n.x, n.y, n.z])).toEqual(
      b.nodes.map((n) => [n.x, n.y, n.z]),
    );
  });

  it("spawns members spread rather than piled on one point", () => {
    // Spawning every member at the anchor puts the first tick at the
    // repulsion singularity and throws the cloud outward — the 2D wake's
    // lesson, one dimension up.
    const layout = new MemberLayout3D(anchor, members, [], mulberry32(7));
    const positions = layout.nodes.map((n) => `${n.x},${n.y},${n.z}`);
    expect(new Set(positions).size).toBe(members.length);
  });
});

describe("bounds3D", () => {
  it("includes each node's radius", () => {
    const b = bounds3D([node({ x: 10, y: 20, z: 30, radius: 5 })])!;
    expect(b).toEqual({
      minX: 5,
      minY: 15,
      minZ: 25,
      maxX: 15,
      maxY: 25,
      maxZ: 35,
    });
  });

  it("is null for an empty cloud rather than an infinite box", () => {
    expect(bounds3D([])).toBeNull();
  });
});
