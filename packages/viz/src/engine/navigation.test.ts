// @vitest-environment jsdom
/**
 * Story 3.3's engine-side acceptance criteria: semantic unfold (AC-1), hover
 * chains (AC-2) and the search fly-to (AC-3).
 *
 * These run against the 100-module / 2,000-file synthetic fixture — the same
 * document FR-12's settle budget is measured on — so "unfold stays local" is
 * asserted at the scale ADR-0006 was written for rather than on a toy graph.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import {
  FILE_LABEL_ZOOM,
  FLY_DURATION_MS,
  FLY_ZOOM_FILE,
  FLY_ZOOM_MODULE,
  UNFOLD_ZOOM,
} from "./constants.js";
import { MEMBER_SPAWN_RADIUS } from "./layout.js";
import { SETTLE_DISPLACEMENT_PX } from "./settle.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";
import type { EngineNode } from "./types.js";

const FRAME_MS = 1000 / 60;

let canvas: HTMLCanvasElement;
let engine: CanvasGraphEngine;

function create(reducedMotion = false): CanvasGraphEngine {
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  return new CanvasGraphEngine({ canvas, reducedMotion });
}

let clock = 0;
function run(count: number): void {
  for (let i = 0; i < count; i++) {
    clock += FRAME_MS;
    engine.frame(clock);
  }
}

/** The scene the engine would draw right now. */
function scene() {
  const built = engine.buildScene(clock);
  if (!built) throw new Error("engine has no scene");
  return built;
}

/** Load and drive the map to Settled, then park the camera on one module. */
function settledEngine(reducedMotion = false): CanvasGraphEngine {
  engine = create(reducedMotion);
  engine.load(loadSyntheticFixture());
  run(600);
  return engine;
}

/** The engine's own view of where a module sits, via a zoomed-in pick. */
function firstModule(): EngineNode {
  const module = engine.nodes.find((node) => node.kind === "module");
  if (!module) throw new Error("fixture has no modules");
  return module;
}

/**
 * Centre the camera on a node at `k`. Uses `flyTo` with a zero-length flight
 * so the engine's own positions are used rather than the test guessing them.
 */
function parkOn(id: string, k: number): void {
  void engine.flyTo(id, { durationMs: 0, zoom: k });
}

beforeEach(() => {
  installFakeCanvas(1200, 800);
  clock = 0;
});

afterEach(() => {
  engine?.destroy();
  document.body.replaceChildren();
});

describe("AC-1 — viewport-scoped semantic unfold (ADR-0006)", () => {
  it("unfolds nothing below the 1.8x threshold", () => {
    settledEngine();
    parkOn(firstModule().id, UNFOLD_ZOOM - 0.1);
    run(5);
    expect(engine.unfoldedModules()).toEqual([]);
  });

  it("unfolds the module under the camera once past 1.8x", () => {
    settledEngine();
    const module = firstModule();
    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(5);
    expect(engine.isUnfolded(module.id)).toBe(true);
  });

  it("unfolds only what the viewport can see, not the whole repository", () => {
    settledEngine();
    const module = firstModule();
    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(5);

    const moduleCount = engine.nodes.filter(
      (node) => node.kind === "module",
    ).length;
    expect(moduleCount).toBeGreaterThan(50);
    // The point of ADR-0006: a handful, not all 100. If this ever equals the
    // module count, the viewport rule has stopped working and the 60 fps
    // budget goes with it.
    expect(engine.unfoldedModules().length).toBeLessThan(moduleCount);
  });

  it("collapses everything when zoom drops back below the threshold", () => {
    settledEngine();
    const module = firstModule();
    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(5);
    expect(engine.unfoldedModules().length).toBeGreaterThan(0);

    engine.setCamera({ k: UNFOLD_ZOOM - 0.1 });
    run(2);
    expect(engine.unfoldedModules()).toEqual([]);
  });

  it("unfolds a module panned into view while already zoomed in", () => {
    settledEngine();
    const modules = engine.nodes.filter((node) => node.kind === "module");
    const first = modules[0]!;
    parkOn(first.id, UNFOLD_ZOOM + 0.1);
    run(5);
    const before = new Set(engine.unfoldedModules());

    // Pan far enough that a different part of the map is on screen.
    const target = modules.find((node) => !before.has(node.id));
    expect(target).toBeDefined();
    parkOn(target!.id, UNFOLD_ZOOM + 0.1);
    run(5);

    expect(engine.isUnfolded(target!.id)).toBe(true);
    // And the ones left behind collapsed, rather than accumulating.
    expect(engine.unfoldedModules()).not.toEqual([...before]);
  });

  it("unfolds the other modules a real flight lands among", async () => {
    // Regression: a flight moves the camera without routing through
    // `setCamera` (which would cancel it), so the unfold set has to be
    // recomputed per animated frame. It was not — a fly-to arrived at 3.0×
    // with only its own module unfolded and every neighbour on screen still
    // collapsed. Zero-duration flights hid this, so this test animates.
    settledEngine();
    const module = firstModule();

    const flight = engine.flyTo(module.id, { zoom: FILE_LABEL_ZOOM });
    run(Math.ceil(FLY_DURATION_MS / FRAME_MS) + 2);
    await flight;

    expect(engine.isUnfolded(module.id)).toBe(true);
    // The point: the arrival unfolded more than just the target's module.
    expect(engine.unfoldedModules().length).toBeGreaterThan(1);
  });

  it("emits unfold and collapse events describing the change", () => {
    settledEngine();
    const unfolded: string[][] = [];
    const collapsed: string[][] = [];
    engine.on("unfold", (p) => unfolded.push([...p.moduleIds]));
    engine.on("collapse", (p) => collapsed.push([...p.moduleIds]));

    const module = firstModule();
    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(5);
    expect(unfolded.flat()).toContain(module.id);

    engine.setCamera({ k: UNFOLD_ZOOM - 0.1 });
    run(2);
    expect(collapsed.flat()).toContain(module.id);
  });

  it("spawns member files at their module's position and keeps them there", () => {
    settledEngine();
    const module = firstModule();
    const members = engine.nodes.filter((node) => node.parent === module.id);
    expect(members.length).toBeGreaterThan(0);
    const memberIds = new Set(members.map((node) => node.id));

    // Park the camera on the module — which unfolds it — but do NOT tick yet.
    // The camera centre is therefore the module's world position.
    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    const camera = engine.getCamera();
    const distances = (): number[] =>
      scene()
        .nodes.filter((item) => memberIds.has(item.node.id))
        .map((item) => Math.hypot(item.x - camera.x, item.y - camera.y));

    // At spawn: inside the disc, exactly as ADR-0006 requires.
    const atSpawn = distances();
    expect(atSpawn.length).toBeGreaterThan(0);
    expect(Math.max(...atSpawn)).toBeLessThanOrEqual(MEMBER_SPAWN_RADIUS);

    // After settling: the cloud has expanded, but stayed *local* to its module
    // rather than drifting off across the map. This is the half that would
    // catch a wake escaping its anchor — an earlier sub-pixel spawn put
    // forceManyBody at its distanceMin floor and threw members ~150 px on the
    // very first tick.
    run(120);
    expect(Math.max(...distances())).toBeLessThan(MEMBER_SPAWN_RADIUS * 8);
  });

  it("keeps the global layout undisturbed during an unfold", () => {
    settledEngine();
    const module = firstModule();

    // Baseline: every module's position once the map is Settled.
    const before = new Map(
      scene()
        .nodes.filter((item) => item.node.kind === "module")
        .map((item) => [item.node.id, { x: item.x, y: item.y }]),
    );
    expect(before.size).toBeGreaterThan(50);

    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(60);

    // AC-1's assertion: nothing that is not a member of an unfolding module
    // moved by more than the Settled bound. This is what "the global layout is
    // undisturbed" means operationally — and it holds structurally, because
    // module nodes are not members of any member simulation.
    let maxDisplacement = 0;
    for (const item of scene().nodes) {
      const start = before.get(item.node.id);
      if (!start) continue;
      maxDisplacement = Math.max(
        maxDisplacement,
        Math.hypot(item.x - start.x, item.y - start.y),
      );
    }
    expect(maxDisplacement).toBeLessThan(SETTLE_DISPLACEMENT_PX);
  });

  it("shows file labels only from 3.0x", () => {
    settledEngine();
    const module = firstModule();
    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(5);
    expect(scene().showFileLabels).toBe(false);

    parkOn(module.id, FILE_LABEL_ZOOM);
    run(5);
    expect(scene().showFileLabels).toBe(true);
  });

  it("is deterministic: the same module unfolds into the same cloud", () => {
    const positions = (): string => {
      const module = firstModule();
      parkOn(module.id, UNFOLD_ZOOM + 0.1);
      run(60);
      const memberIds = new Set(
        engine.nodes.filter((n) => n.parent === module.id).map((n) => n.id),
      );
      return JSON.stringify(
        scene()
          .nodes.filter((item) => memberIds.has(item.node.id))
          .map((item) => [item.node.id, item.x.toFixed(4), item.y.toFixed(4)]),
      );
    };

    settledEngine();
    const first = positions();
    engine.destroy();
    clock = 0;

    settledEngine();
    expect(positions()).toEqual(first);
  });
});

describe("AC-2 — hover chains", () => {
  it("computes a one-hop chain containing the node and its neighbours", () => {
    settledEngine();
    const withNeighbours = engine.nodes.find(
      (node) => node.kind === "module" && engine.chainOf(node.id).length > 1,
    );
    expect(withNeighbours).toBeDefined();
    const chain = engine.chainOf(withNeighbours!.id);
    expect(chain).toContain(withNeighbours!.id);
    expect(chain.length).toBeGreaterThan(1);
  });

  it("includes an unfolded module's member files in its chain", () => {
    settledEngine();
    const module = firstModule();
    expect(engine.chainOf(module.id)).not.toContain(
      engine.nodes.find((node) => node.parent === module.id)!.id,
    );

    parkOn(module.id, UNFOLD_ZOOM + 0.1);
    run(5);

    const member = engine.nodes.find((node) => node.parent === module.id)!;
    expect(engine.chainOf(module.id)).toContain(member.id);
  });

  it("emits hover with the node and the pointer position", () => {
    settledEngine();
    const seen: { id: string | null; hasScreen: boolean }[] = [];
    engine.on("hover", (p) =>
      seen.push({ id: p.node?.id ?? null, hasScreen: p.screen !== null }),
    );

    engine.setHovered(firstModule().id, { x: 10, y: 20 });
    expect(seen).toEqual([{ id: firstModule().id, hasScreen: true }]);

    engine.setHovered(null, null);
    expect(seen[1]).toEqual({ id: null, hasScreen: false });
  });

  it("puts the hovered chain into the scene and clears it on exit", () => {
    settledEngine();
    const module = firstModule();

    engine.setHovered(module.id, { x: 0, y: 0 });
    const hovered = scene();
    expect(hovered.chain).not.toBeNull();
    expect(hovered.chain!.has(module.id)).toBe(true);

    engine.setHovered(null, null);
    expect(scene().chain).toBeNull();
  });

  it("emits highlight so chrome can follow the focus", () => {
    settledEngine();
    const focus: (string | null)[] = [];
    engine.on("highlight", (p) => focus.push(p.focusId));
    engine.setHovered(firstModule().id, { x: 0, y: 0 });
    engine.setHovered(null, null);
    expect(focus).toEqual([firstModule().id, null]);
  });
});

describe("AC-3 — search fly-to", () => {
  it("flies to a module at 2.0x and selects it on arrival", async () => {
    settledEngine();
    const module = firstModule();
    const selected: (string | null)[] = [];
    engine.on("select", (p) => selected.push(p.node?.id ?? null));

    const flight = engine.flyTo(module.id);
    // Nothing is selected mid-flight: the panel must not open on a node the
    // user cannot see yet.
    run(2);
    expect(selected).toEqual([]);

    run(Math.ceil(FLY_DURATION_MS / FRAME_MS) + 2);
    await flight;

    expect(selected).toEqual([module.id]);
    expect(engine.getCamera().k).toBeCloseTo(FLY_ZOOM_MODULE, 5);
  });

  it("flies to a file at 3.0x, unfolding its module to get there", async () => {
    settledEngine();
    const file = engine.nodes.find(
      (node) => node.kind === "file" && node.parent !== null,
    )!;
    expect(engine.isUnfolded(file.parent!)).toBe(false);

    const flight = engine.flyTo(file.id);
    run(Math.ceil(FLY_DURATION_MS / FRAME_MS) + 2);
    await flight;

    expect(engine.isUnfolded(file.parent!)).toBe(true);
    expect(engine.getCamera().k).toBeCloseTo(FLY_ZOOM_FILE, 5);
    expect(engine.getSelected()?.id).toBe(file.id);
  });

  it("takes 620ms +/- 50ms to arrive", async () => {
    settledEngine();
    const module = engine.nodes.filter((n) => n.kind === "module")[5]!;
    const start = clock;
    let arrived: number | null = null;
    const flight = engine.flyTo(module.id).then(() => {
      arrived = clock;
    });

    for (let i = 0; i < 200 && arrived === null; i++) {
      run(1);
      await Promise.resolve();
    }
    await flight;

    expect(arrived).not.toBeNull();
    expect(arrived! - start).toBeGreaterThanOrEqual(FLY_DURATION_MS - 50);
    expect(arrived! - start).toBeLessThanOrEqual(FLY_DURATION_MS + 50);
  });

  it("pulses the target after arrival", async () => {
    settledEngine();
    const module = firstModule();
    const flight = engine.flyTo(module.id);
    run(Math.ceil(FLY_DURATION_MS / FRAME_MS) + 2);
    await flight;

    run(1);
    const pulse = scene().pulse;
    expect(pulse?.id).toBe(module.id);
    expect(pulse!.t).toBeGreaterThanOrEqual(0);
    expect(pulse!.t).toBeLessThan(1);
  });

  it("jumps instantly and does not pulse under reduced motion (UX-DR11)", async () => {
    settledEngine(true);
    const module = firstModule();
    const before = engine.getCamera();

    await engine.flyTo(module.id);

    expect(engine.getCamera()).not.toEqual(before);
    expect(engine.getCamera().k).toBeCloseTo(FLY_ZOOM_MODULE, 5);
    expect(engine.getSelected()?.id).toBe(module.id);
    expect(scene().pulse).toBeNull();
  });

  it("keeps a fly-to started before the layout settled (regression)", async () => {
    // The search box is usable from the first frame, but the map takes 2–3 s
    // to settle and the settle-completion `fit()` used to cancel whatever
    // flight was in the air. Searching during the settle therefore did
    // nothing visible: the target module unfolded, and the camera snapped
    // back to the fitted view. Caught in a browser, not by the suite.
    engine = create();
    engine.load(loadSyntheticFixture());
    run(5); // still settling

    const module = firstModule();
    const flight = engine.flyTo(module.id);
    // Drive well past the settle, so the automatic fit would have fired.
    run(700);
    await flight;

    expect(engine.getCamera().k).toBeCloseTo(FLY_ZOOM_MODULE, 5);
    expect(engine.getSelected()?.id).toBe(module.id);
  });

  it("ignores a fly-to for a node that does not exist", async () => {
    settledEngine();
    const before = engine.getCamera();
    await engine.flyTo("no-such-node");
    expect(engine.getCamera()).toEqual(before);
    expect(engine.getSelected()).toBeNull();
  });
});

describe("load() publishes the state it clears", () => {
  it("emits select and highlight when a second load resets them", () => {
    // Found by 3.4's Codex review and taken here because this story added the
    // chrome subscriptions that mirror these events into the store: clearing
    // the fields silently would leave a panel open on a node the new document
    // need not contain.
    settledEngine();
    const module = firstModule();
    engine.setSelected(module.id);
    engine.setIsolated(module.id);

    const selects: (string | null)[] = [];
    const highlights: boolean[] = [];
    engine.on("select", (p) => selects.push(p.node?.id ?? null));
    engine.on("highlight", (p) => highlights.push(p.isolated));

    engine.load(loadSyntheticFixture());

    expect(selects).toEqual([null]);
    expect(highlights).toContain(false);
    expect(engine.getSelected()).toBeNull();
    expect(engine.getIsolated()).toBeNull();
  });

  it("stays quiet on a first load, when there is nothing to clear", () => {
    engine = create();
    const events: string[] = [];
    engine.on("select", () => events.push("select"));
    engine.on("highlight", () => events.push("highlight"));
    engine.load(loadSyntheticFixture());
    expect(events).toEqual([]);
  });
});

describe("AC-4 — everything stays behind the engine seam", () => {
  it("resolves unfolded files through pick(), not just modules", () => {
    settledEngine();
    const module = firstModule();
    parkOn(module.id, FILE_LABEL_ZOOM);
    run(60);

    const memberIds = new Set(
      engine.nodes.filter((n) => n.parent === module.id).map((n) => n.id),
    );
    const drawn = scene().nodes.find((item) => memberIds.has(item.node.id));
    expect(drawn).toBeDefined();

    // Convert the member's world position to a screen point and pick it: a
    // file must be reachable by the pointer, or hover and click cannot see it.
    const camera = engine.getCamera();
    const screen = {
      x: (drawn!.x - camera.x) * camera.k + 1200 / 2,
      y: (drawn!.y - camera.y) * camera.k + 800 / 2,
    };
    expect(engine.pick(screen)?.id).toBe(drawn!.node.id);
  });
});
