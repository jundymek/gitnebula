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

describe("semantic zoom is viewport-scoped (ADR-0006)", () => {
  it("unfolds only the modules on screen, not every module in the repository", () => {
    // ADR-0006 is named for this. Unfolding everything above 1.8x is not
    // semantic zoom, it is "draw the whole repository", and it puts every file
    // of every module through projection and render on every frame.
    engine = create(true);
    engine.load(loadSyntheticFixture());
    run(engine, 5);

    const moduleCount = engine.nodes.filter((n) => n.kind === "module").length;
    expect(moduleCount).toBeGreaterThan(20);

    // Zoomed in far enough that only part of the cloud is on screen. k = 6,
    // not 4: since the layout stability fix the module cloud is tighter, and
    // at 4x all 100 modules still fall inside the frame — measured, not
    // assumed. A test that passes only because the map is loose would stop
    // testing the viewport rule the moment the layout changed, which is
    // exactly what happened here.
    engine.setCamera({ k: 6 });
    const unfolded = engine.unfoldedModules().length;
    expect(unfolded).toBeGreaterThan(0);
    expect(unfolded).toBeLessThan(moduleCount);
  });

  it("collapses a module once the camera leaves it behind", () => {
    engine = create(true);
    engine.load(loadSyntheticFixture());
    run(engine, 5);
    engine.setCamera({ k: 6 });

    const first = [...engine.unfoldedModules()];
    expect(first.length).toBeGreaterThan(0);

    // Pan a long way; a different part of the cloud is in frame now.
    engine.setCamera({ x: 100000, y: 100000 });
    for (const moduleId of first) {
      expect(engine.isUnfolded(moduleId)).toBe(false);
    }
  });

  it("keeps a scoped module open even when the camera is elsewhere", () => {
    // Story 5.4's hold outranks the viewport rule, exactly as in 2D.
    engine = create(true);
    engine.load(loadContractFixture("root-files"));
    run(engine, 5);
    const moduleId = engine.nodes.find((n) => n.kind === "module")!.id;
    engine.setScope(moduleId);
    engine.setCamera({ x: 100000, y: 100000, k: 4 });
    expect(engine.isUnfolded(moduleId)).toBe(true);
  });
});

describe("nothing unfolds while the layout is still moving", () => {
  it("holds off until the global layout has settled", () => {
    // Members spawn at their module's position and their wake settles once, so
    // unfolding around a module that is still travelling strands its files
    // behind it. The 2D engine returns early for the same reason.
    engine = create(false); // not reduced motion: the layout really settles over frames
    engine.load(loadSyntheticFixture());

    // One frame in, the layout is still moving.
    engine.frame(0);
    engine.setCamera({ k: 4 });
    expect(engine.unfoldedModules()).toEqual([]);

    // Run it out; now the viewport rule may apply.
    for (let i = 1; i < 900; i++) engine.frame(i * FRAME_MS);
    engine.setCamera({ k: 4 });
    expect(engine.unfoldedModules().length).toBeGreaterThan(0);
    // Explicit timeout: this test drives a real settle with a real render per
    // frame, which costs about five seconds against vitest default of five. It
    // is slow because of what it exercises, not because of how it is written.
  }, 20_000);
});

describe("the unfold set is re-evaluated when its inputs change", () => {
  it("grants a zoom that was refused while the layout was still settling", () => {
    // The settle gate refuses unfolding while the layout moves. Something has
    // to re-ask once it stops, and if the reader took the camera by hand there
    // is no automatic fit coming to do it — the map would sit fully collapsed
    // at 4x until an unrelated pan nudged it.
    engine = create(false);
    engine.load(loadContractFixture("root-files"));
    engine.frame(0);

    // Rotate by hand first: that ends idle auto-rotation for the session, so
    // the per-frame drift cannot be what re-evaluates the unfold set. This
    // test then isolates the settle transition as the only thing that can.
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
        clientX: 40,
        clientY: 0,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        button: 0,
        isPrimary: true,
        clientX: 40,
        clientY: 0,
      }),
    );
    expect(engine.isAutoRotating()).toBe(false);

    // Zoom by hand while it is still moving: refused, and `cameraTakenByUser`
    // is now set, so no post-settle fit will run either.
    engine.setCamera({ k: 4 });
    expect(engine.unfoldedModules()).toEqual([]);

    // Nothing below touches the camera or the orientation. The only thing that
    // happens is the layout reaching Settled — measured at 43 frames on this
    // fixture, so 120 is headroom rather than a guess. Kept tight because
    // every frame here is a real render into the recording context, and this
    // test was timing out at 300.
    for (let i = 1; i < 120; i++) engine.frame(i * FRAME_MS);
    expect(engine.unfoldedModules().length).toBeGreaterThan(0);
  });

  it("re-evaluates when the camera is rotated by hand", () => {
    // The viewport test reads `orientation`, so rotating changes its answer
    // exactly as panning does. Asserted through the engine's own bookkeeping
    // rather than a screenshot: a module far off-axis is in frame at one yaw
    // and not at another.
    engine = create(true);
    engine.load(loadSyntheticFixture());
    run(engine, 5);
    engine.setCamera({ k: 4 });

    const seen = new Set<string>();
    for (let turn = 0; turn < 8; turn++) {
      engine.setOrientation({ yaw: (turn * Math.PI) / 4 });
      for (const id of engine.unfoldedModules()) seen.add(id);
    }
    // Rotating a full circle brings strictly more modules through the frame
    // than any single orientation shows, which is only true if rotation
    // re-evaluates at all.
    engine.setOrientation({ yaw: 0 });
    expect(seen.size).toBeGreaterThan(engine.unfoldedModules().length);
  });

  it("re-evaluates when the viewport is resized", () => {
    // The viewport is the fourth input to the same test. Under reduced motion
    // there is no auto-rotation to paper over a stale set, so a resize that
    // reveals modules would leave them collapsed until an unrelated pan.
    engine = create(true);
    engine.load(loadSyntheticFixture());
    run(engine, 5);
    engine.setCamera({ k: 6 });
    const narrow = [...engine.unfoldedModules()].sort();
    expect(narrow.length).toBeGreaterThan(0);

    // Grow the canvas: strictly more of the cloud is on screen now.
    installFakeCanvas(2400, 1600);
    engine.resize();
    const wide = [...engine.unfoldedModules()].sort();
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("re-evaluates as idle auto-rotation drifts the camera", () => {
    // Auto-rotation is ON BY DEFAULT, so without this the viewport rule is
    // defeated in the ordinary case: modules rotating into view stay collapsed
    // and modules rotating out stay materialised until an unrelated pan.
    //
    // Asserted as *freshness* rather than as "the set changed": after drifting
    // on the frame clock alone, a no-op camera nudge — which does nothing but
    // force a re-evaluation — must not change the answer. If the drift had
    // left the set stale, the nudge would repair it and the two would differ.
    engine = create(false);
    engine.load(loadSyntheticFixture());
    // Not reduced motion, so the layout settles over frames — run it out first,
    // because nothing unfolds before Settled.
    let t = 0;
    for (let i = 0; i < 260; i++) engine.frame((t = i * FRAME_MS));
    // k = 6: the viewport edge cuts through the cloud there, so rotation
    // genuinely moves modules across it. At the fit zoom the whole cloud is in
    // frame and no amount of rotation changes the answer.
    engine.setCamera({ k: 6 });
    expect(engine.isAutoRotating()).toBe(true);

    const yawBefore = engine.getOrientation().yaw;
    for (let i = 1; i <= 340; i++) engine.frame(t + i * FRAME_MS);
    const afterDrift = [...engine.unfoldedModules()].sort();

    // The drift is large enough to matter: ~0.5 rad, where the set is measured
    // to change every ~30 degrees at this zoom.
    expect(engine.getOrientation().yaw - yawBefore).toBeGreaterThan(0.5);

    // A camera call that changes nothing, purely to force a recomputation. If
    // the drift had left the set stale, this would repair it and the two would
    // differ.
    engine.setCamera({});
    expect([...engine.unfoldedModules()].sort()).toEqual(afterDrift);
  });
});

describe("the unfold set is never left stale (the whole family)", () => {
  it("is already fresh after every operation that moves the projection", () => {
    // The individual triggers each have their own test above. This one closes
    // the *family*: whatever moves the projection — camera, orientation,
    // viewport, target depth, the layout settling — the unfold set must be
    // current the moment the operation returns.
    //
    // Freshness is asserted by asking for a recomputation and requiring the
    // answer not to change: `setCamera({})` alters nothing but forces
    // `updateUnfolds`. If an operation had left the set stale, this would
    // repair it and the two would differ.
    //
    // Written as an invariant rather than one case per trigger so that a
    // future input to the viewport test is caught by an existing test instead
    // of needing someone to remember to add one.
    engine = create(true);
    engine.load(loadSyntheticFixture());
    run(engine, 5);

    const target = engine.nodes.find((node) => node.kind === "module")!;
    const operations: [string, () => void][] = [
      ["zoom past the unfold threshold", () => engine!.setCamera({ k: 6 })],
      ["pan", () => engine!.panBy(120, -80)],
      ["zoom out", () => engine!.zoomAt({ x: 10, y: 10 }, 0.5)],
      ["rotate", () => engine!.setOrientation({ yaw: 1.2, pitch: 0.3 })],
      ["rotate again", () => engine!.setOrientation({ yaw: -2.0 })],
      [
        "resize",
        () => {
          installFakeCanvas(900, 700);
          engine!.resize();
        },
      ],
      [
        "resize back",
        () => {
          installFakeCanvas(1200, 800);
          engine!.resize();
        },
      ],
      ["fit", () => void engine!.fit({ durationMs: 0 })],
      [
        "fly to a module",
        () => void engine!.flyTo(target.id, { durationMs: 0 }),
      ],
      ["scope", () => engine!.setScope(target.id)],
      ["leave the scope", () => engine!.setScope(null)],
      [
        "replay, then settle",
        () => {
          engine!.replay();
          run(engine!, 5);
        },
      ],
    ];

    for (const [name, run_] of operations) {
      run_();
      const after = [...engine.unfoldedModules()].sort();
      engine.setCamera({});
      expect(
        [...engine.unfoldedModules()].sort(),
        `the unfold set was stale after: ${name}`,
      ).toEqual(after);
    }
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
      // `fit` now sizes to the silhouette the cloud casts at the orientation
      // it was called at, rather than to the bounding sphere. That is what
      // lets it use a 16:10 frame instead of a circle inscribed in the short
      // axis — and the trade is that turning afterwards can carry a corner
      // slightly past the edge. Bounded, not unbounded: a tolerance of a
      // measured worst case across these four orientations, 45.9 px of 800 =
      // 5.7%; the bound is 7% so it records the behaviour with headroom rather
      // than sitting on the measurement.
      const slackX = scene.viewport.width * 0.07;
      const slackY = scene.viewport.height * 0.07;
      for (const p of placed) {
        expect(p.sx).toBeGreaterThanOrEqual(-slackX);
        expect(p.sx).toBeLessThanOrEqual(scene.viewport.width + slackX);
        expect(p.sy).toBeGreaterThanOrEqual(-slackY);
        expect(p.sy).toBeLessThanOrEqual(scene.viewport.height + slackY);
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
      // Re-measured after `fit` began framing unfolded member wakes as well as
      // the module layout, which is a strictly larger set and so a wider
      // frame. The bound is the measurement, not a target: it exists to catch
      // a fit that stops framing anything, and it is deliberately loose enough
      // to survive the layout changing again.
      expect(span).toBeGreaterThan(shortest * 0.3);
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
