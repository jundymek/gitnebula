// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Nebula3DEngine, seedOrientation } from "./engine3d.js";
import { CanvasGraphEngine } from "./engine.js";
import { MAX_ZOOM, MIN_ZOOM, UNFOLD_ZOOM } from "./constants.js";
import { PITCH_LIMIT } from "./project3d.js";
import { placeNodes } from "./render3d.js";
import {
  installFakeCanvas,
  type FakeContext,
} from "../test-support/fake-canvas.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

const FRAME_MS = 1000 / 60;

let fake: FakeContext;
let engine: Nebula3DEngine | null = null;
const spares: { destroy(): void }[] = [];

function create(reducedMotion = false): Nebula3DEngine {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const created = new Nebula3DEngine({ canvas, reducedMotion });
  spares.push(created);
  return created;
}

function run(target: Nebula3DEngine, count: number, startMs = 0): number {
  let t = startMs;
  for (let i = 0; i < count; i++) {
    t = startMs + i * FRAME_MS;
    target.frame(t);
  }
  return t;
}

beforeEach(() => {
  fake = installFakeCanvas(1200, 800);
});

afterEach(() => {
  for (const spare of spares.splice(0)) spare.destroy();
  engine = null;
  document.body.replaceChildren();
});

describe("AC-1 — a second implementation behind the same seam", () => {
  it("carries every member of the GraphEngine interface, as the 2D engine does", () => {
    // The compile-time guarantee is `implements GraphEngine` on both classes —
    // tsc fails the build if either is incomplete, and that is the real guard.
    // This adds the runtime half: both engines answer the same calls, checked
    // against the interface's members rather than against each other's
    // internals, which legitimately differ (a 3D engine has no starfield and
    // no pulse, a 2D one has no orbit).
    engine = create();
    const twoD = new CanvasGraphEngine({
      canvas: document.createElement("canvas"),
    });
    spares.push(twoD);

    const INTERFACE_MEMBERS = [
      "load",
      "replay",
      "resize",
      "destroy",
      "getNode",
      "chainOf",
      "getCamera",
      "setCamera",
      "panBy",
      "zoomAt",
      "fit",
      "flyTo",
      "pick",
      "getHovered",
      "setHovered",
      "getSelected",
      "setSelected",
      "getIsolated",
      "setIsolated",
      "getMode",
      "setMode",
      "unfoldedModules",
      "isUnfolded",
      "getLayerFilter",
      "setLayerFilter",
      "getScope",
      "setScope",
      "getConnectedOnly",
      "setConnectedOnly",
      "getReturnScope",
      "hiddenCount",
      "exportPNG",
      "on",
      "off",
    ] as const;

    const missingIn3D = INTERFACE_MEMBERS.filter(
      (name) =>
        typeof (engine as unknown as Record<string, unknown>)[name] !==
        "function",
    );
    expect(missingIn3D).toEqual([]);

    // The list is checked against the 2D engine too, so it cannot silently
    // drift out of date with the interface and start proving nothing.
    const missingIn2D = INTERFACE_MEMBERS.filter(
      (name) =>
        typeof (twoD as unknown as Record<string, unknown>)[name] !==
        "function",
    );
    expect(missingIn2D).toEqual([]);

    // `nodes` is a property, not a method.
    expect(Array.isArray(engine.nodes)).toBe(true);
  });

  it("emits the same events chrome subscribes to", () => {
    engine = create(true);
    const seen: string[] = [];
    for (const event of [
      "settle-start",
      "settled",
      "select",
      "scope",
    ] as const) {
      engine.on(event, () => seen.push(event));
    }
    engine.load(loadContractFixture("cyclic-imports"));
    expect(seen).toContain("settle-start");
    expect(seen).toContain("settled");
    expect(seen).toContain("scope");
  });

  it("clamps zoom to the interface's range like the 2D engine (FR-15)", () => {
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    engine.setCamera({ k: 999 });
    expect(engine.getCamera().k).toBe(MAX_ZOOM);
    engine.setCamera({ k: 0 });
    expect(engine.getCamera().k).toBe(MIN_ZOOM);
  });

  it("unfolds modules above UNFOLD_ZOOM, as ADR-0006 requires of the map", () => {
    // `unfoldedModules()`/`isUnfolded()` are on the seam, so they have to mean
    // something here — 3D showing every file at once would be a different map.
    engine = create(true);
    engine.load(loadContractFixture("root-files"));
    run(engine, 5);
    // Set the camera explicitly rather than trusting the post-load one: the
    // reduced-motion path fits the graph on load, and on a small fixture that
    // fit legitimately lands above UNFOLD_ZOOM already.
    engine.setCamera({ k: UNFOLD_ZOOM - 0.1 });
    expect(engine.unfoldedModules()).toEqual([]);
    engine.setCamera({ k: UNFOLD_ZOOM });
    expect(engine.unfoldedModules().length).toBeGreaterThan(0);
  });
});

describe("AC-2 — determinism (AD-6)", () => {
  const document_ = loadContractFixture("cyclic-imports");

  it("two engines loading the same document agree on every position", () => {
    const a = create(true);
    const b = create(true);
    a.load(document_);
    b.load(document_);
    run(a, 400);
    run(b, 400);

    const positionsOf = (target: Nebula3DEngine): unknown[] => {
      const scene = target.buildScene(0)!;
      return scene.nodes.map((n) => [n.node.id, n.x, n.y, n.z]);
    };
    expect(positionsOf(a)).toEqual(positionsOf(b));
    // Non-trivially: there is something to compare.
    expect(positionsOf(a).length).toBeGreaterThan(0);
  });

  it("two engines agree on the initial camera orientation", () => {
    // The other half of AC-2, and the half a layout-only check would miss: an
    // orientation taken from a clock would differ between these two.
    const a = create(true);
    const b = create(true);
    a.load(document_);
    b.load(document_);
    expect(a.getInitialOrientation()).toEqual(b.getInitialOrientation());
    expect(a.getOrientation()).toEqual(b.getOrientation());
  });

  it("keeps the seeded initial orientation available once the camera has moved", () => {
    // With auto-rotation running, `getOrientation()` is a function of elapsed
    // frames — two runs read at different instants differ by a fraction of a
    // radian, which is drift and not a broken seed. AC-2 is about the pose the
    // view *starts* from, so that pose stays separately readable.
    const engineA = create(false);
    spares.push(engineA);
    engineA.load(document_);
    const initial = engineA.getInitialOrientation();
    run(engineA, 120);
    expect(engineA.getOrientation()).not.toEqual(initial);
    expect(engineA.getInitialOrientation()).toEqual(initial);
  });

  it("seeds the orientation from the document, not from a constant", () => {
    const a = create(true);
    const b = create(true);
    a.load(document_);
    b.load(loadContractFixture("root-files"));
    expect(a.getOrientation()).not.toEqual(b.getOrientation());
  });

  it("keeps the seeded orientation inside the readable pitch band", () => {
    // A cloud first seen from almost directly overhead reads as a flat
    // scatter, which is the opposite of the point of a 3D view.
    for (let seed = 0; seed < 200; seed++) {
      const { pitch } = seedOrientation(seed);
      expect(Math.abs(pitch)).toBeLessThan(PITCH_LIMIT);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(0.45);
    }
  });

  it("replays to the identical layout rather than continuing the stream", () => {
    engine = create(true);
    engine.load(document_);
    run(engine, 400);
    const before = engine
      .buildScene(0)!
      .nodes.map((n) => [n.node.id, n.x, n.y, n.z]);
    const orientationBefore = engine.getOrientation();

    engine.replay();
    run(engine, 400);
    expect(
      engine.buildScene(0)!.nodes.map((n) => [n.node.id, n.x, n.y, n.z]),
    ).toEqual(before);
    expect(engine.getOrientation()).toEqual(orientationBefore);
  });

  it("uses no unseeded randomness — an explicit seed pins the whole view", () => {
    const a = create(true);
    const b = create(true);
    a.load(document_, 12345);
    b.load(document_, 12345);
    run(a, 200);
    run(b, 200);
    expect(a.buildScene(0)).toEqual(b.buildScene(0));
  });
});

describe("fit frames the whole cloud", () => {
  it("keeps every node inside the viewport, at any orientation", () => {
    // `fit` solves on the sphere that ENCLOSES the layout's bounding box. Half
    // the longest axis is not that sphere: a corner sits hypot(hx, hy, hz)
    // from the centre, 1.73x further for an isotropic cloud — and the scatter
    // is spherical, so isotropic is the ordinary case. Under-fitting drew
    // whichever corner swung widest outside the padded viewport, and since the
    // camera can be at any yaw and pitch, which corner that is varies.
    engine = create(true);
    engine.load(loadSyntheticFixture());
    run(engine, 5);

    for (const orientation of [
      { yaw: 0, pitch: 0 },
      { yaw: 0.9, pitch: -0.3 },
      { yaw: Math.PI / 4, pitch: Math.PI / 5 },
      { yaw: 2.4, pitch: 0.7 },
    ]) {
      engine.setOrientation(orientation);
      void engine.fit({ durationMs: 0 });
      const scene = engine.buildScene(0)!;
      const placed = placeNodes(scene);
      // Nothing culled: every node survived projection and the cull margin.
      expect(placed.length).toBe(scene.nodes.length);
      for (const p of placed) {
        expect(p.sx).toBeGreaterThanOrEqual(0);
        expect(p.sx).toBeLessThanOrEqual(scene.viewport.width);
        expect(p.sy).toBeGreaterThanOrEqual(0);
        expect(p.sy).toBeLessThanOrEqual(scene.viewport.height);
      }

      // ...and it FILLS the frame rather than sitting in the middle of it.
      // Containment alone is satisfied by a camera parked far away, which is
      // exactly the defect the scale constant caused: `fit` used the resting
      // distance where the focal length belongs and the map came out at 243 px
      // across a 1,200 px viewport. A fit that frames nothing is not a fit.
      const shortest = Math.min(scene.viewport.width, scene.viewport.height);
      const span = Math.max(
        Math.max(...placed.map((p) => p.sx)) -
          Math.min(...placed.map((p) => p.sx)),
        Math.max(...placed.map((p) => p.sy)) -
          Math.min(...placed.map((p) => p.sy)),
      );
      // 0.48 is measured, not guessed: on this fixture the correct fit spans
      // 0.491-0.545 of the shorter viewport axis across these four
      // orientations, and scaling by the resting distance instead of the focal
      // length drops it to 0.425-0.472. The bound sits in that gap, so this
      // assertion fails against the defect and passes against the fix.
      expect(span).toBeGreaterThan(shortest * 0.48);
    }
  });

  it("frames the cloud's depth centre, not the z = 0 slice of it", () => {
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    run(engine, 5);
    void engine.fit({ durationMs: 0 });
    const scene = engine.buildScene(0)!;
    // Radii included, because `bounds3D` includes them: the frame has to hold
    // the nodes as drawn, not their centre points.
    const minZ = Math.min(...scene.nodes.map((n) => n.z - n.node.radius));
    const maxZ = Math.max(...scene.nodes.map((n) => n.z + n.node.radius));
    expect(scene.targetZ).toBeCloseTo((minZ + maxZ) / 2, 5);
    // And it is a real depth, not the z = 0 plane the target used to be
    // pinned to.
    expect(Math.abs(maxZ - minZ)).toBeGreaterThan(1);
  });
});

describe("flyTo centres its target", () => {
  it("puts a flown-to node at the middle of the viewport", () => {
    // `flyTo` is how search arrives at a node (FR-18). Landing with the target
    // visibly beside the centre is the difference between "the search worked"
    // and "the search moved the camera somewhere near the answer".
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    run(engine, 5);

    const target = engine.nodes.find((node) => node.kind === "module")!;
    void engine.flyTo(target.id, { durationMs: 0 });

    const scene = engine.buildScene(0)!;
    const placed = placeNodes(scene).find((p) => p.id === target.id);
    expect(placed).toBeDefined();
    expect(placed!.sx).toBeCloseTo(scene.viewport.width / 2, 0);
    expect(placed!.sy).toBeCloseTo(scene.viewport.height / 2, 0);
  });

  it("centres it whatever the camera orientation is", () => {
    // The seeded orientation has a nonzero yaw, which is exactly the case that
    // broke: the node's depth rotated into screen x/y. Checked across several
    // orientations so the assertion cannot pass by a lucky angle.
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    run(engine, 5);
    const target = engine.nodes.find((node) => node.kind === "module")!;

    for (const orientation of [
      { yaw: 0, pitch: 0 },
      { yaw: 0.9, pitch: -0.3 },
      { yaw: 2.4, pitch: 0.7 },
      { yaw: -1.2, pitch: 0.2 },
    ]) {
      engine.setOrientation(orientation);
      void engine.flyTo(target.id, { durationMs: 0 });
      const scene = engine.buildScene(0)!;
      const placed = placeNodes(scene).find((p) => p.id === target.id)!;
      expect(placed.sx).toBeCloseTo(scene.viewport.width / 2, 0);
      expect(placed.sy).toBeCloseTo(scene.viewport.height / 2, 0);
    }
  });
});

describe("AC-6 — reduced motion (UX-DR15, NFR-7)", () => {
  it("does not auto-rotate", () => {
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    expect(engine.isAutoRotating()).toBe(false);
    const before = engine.getOrientation();
    run(engine, 120);
    expect(engine.getOrientation()).toEqual(before);
  });

  it("plays no entry animation — the map is settled on the first frame", () => {
    engine = create(true);
    const settles: { frames: number; durationMs: number }[] = [];
    engine.on("settled", (payload) => settles.push(payload));
    engine.load(loadContractFixture("cyclic-imports"));
    // Announced synchronously inside `load()`, before any frame is drawn.
    expect(settles).toHaveLength(1);
    expect(settles[0]!.durationMs).toBe(0);
  });

  it("auto-rotates when reduced motion is off, so the assertion above bites", () => {
    engine = create(false);
    engine.load(loadContractFixture("cyclic-imports"));
    expect(engine.isAutoRotating()).toBe(true);
    const before = engine.getOrientation().yaw;
    run(engine, 120);
    expect(engine.getOrientation().yaw).not.toBe(before);
  });

  it("stops auto-rotating for good once the user rotates by hand", () => {
    // A camera that drifts back into motion after being aimed fights its user.
    engine = create(false);
    engine.load(loadContractFixture("cyclic-imports"));
    const canvas = document.querySelector("canvas")!;
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        isPrimary: true,
        clientX: 0,
        clientY: 0,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 60,
        clientY: 0,
      }),
    );
    expect(engine.isAutoRotating()).toBe(false);
  });
});

describe("rendering", () => {
  it("draws the void, then nodes", () => {
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    run(engine, 2);
    expect(fake.calls.some((call) => call.op === "fillRect")).toBe(true);
    expect(fake.calls.some((call) => call.op === "arc")).toBe(true);
  });

  it("draws nothing but the void for a document with no nodes", () => {
    engine = create(true);
    engine.load(loadContractFixture("empty-graph"));
    run(engine, 2);
    expect(fake.calls.some((call) => call.op === "arc")).toBe(false);
  });
});

describe("story 5.6's co-change mark, implemented ahead of the interface", () => {
  it("stores and returns the marked set", () => {
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    const ids = engine.nodes.slice(0, 2).map((n) => n.id);
    engine.setBlastRadius(ids);
    expect(engine.getBlastRadius()).toEqual(ids);
  });

  it("treats null and [] alike, and never returns null", () => {
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    engine.setBlastRadius(["x"]);
    engine.setBlastRadius(null);
    expect(engine.getBlastRadius()).toEqual([]);
    engine.setBlastRadius([]);
    expect(engine.getBlastRadius()).toEqual([]);
  });

  it("carries the mark into the scene so 3D draws it rather than dropping it", () => {
    // The reason for not taking 5.6's offered discount: a mark that vanished
    // on the view switch would make "same map, one interface" false.
    engine = create(true);
    engine.load(loadContractFixture("cyclic-imports"));
    const id = engine.nodes[0]!.id;
    engine.setBlastRadius([id]);
    expect(engine.buildScene(0)!.blastRadius?.has(id)).toBe(true);
    engine.setBlastRadius(null);
    expect(engine.buildScene(0)!.blastRadius).toBeNull();
  });
});

describe("the 2,000-node fixture", () => {
  it("loads, settles and builds a scene", () => {
    engine = create(true);
    engine.load(loadSyntheticFixture());
    const scene = engine.buildScene(0);
    expect(scene).not.toBeNull();
    expect(scene!.nodes.length).toBeGreaterThan(0);
    for (const node of scene!.nodes) {
      expect(Number.isFinite(node.z)).toBe(true);
    }
  });
});
