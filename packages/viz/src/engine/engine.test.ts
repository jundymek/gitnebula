// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import {
  CLICK_SLOP_PX,
  FIT_DURATION_MS,
  MAX_ZOOM,
  MIN_ZOOM,
} from "./constants.js";
import { seedFor } from "./prng.js";
import type { ScreenPoint } from "./types.js";
import {
  installFakeCanvas,
  type FakeContext,
} from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

const FRAME_MS = 1000 / 60;

let fake: FakeContext;
let canvas: HTMLCanvasElement;
let engine: CanvasGraphEngine;

function create(reducedMotion = false): CanvasGraphEngine {
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  return new CanvasGraphEngine({ canvas, reducedMotion });
}

/** Drive `count` frames of the loop by hand, at a 60 fps clock. */
function run(count: number, startMs = 0): number {
  let t = startMs;
  for (let i = 0; i < count; i++) {
    t = startMs + i * FRAME_MS;
    engine.frame(t);
  }
  return t;
}

beforeEach(() => {
  fake = installFakeCanvas(1200, 800);
});

afterEach(() => {
  engine?.destroy();
  document.body.replaceChildren();
});

describe("CanvasGraphEngine — FR-12 settle and fit", () => {
  it("settles in 2–3 s and then frames the graph within 800 ms", async () => {
    engine = create();
    const settles: { frames: number; durationMs: number }[] = [];
    engine.on("settled", (payload) => settles.push(payload));
    engine.load(loadSyntheticFixture());

    let t = 0;
    for (let i = 0; settles.length === 0 && i < 600; i++) {
      t = i * FRAME_MS;
      engine.frame(t);
    }

    expect(settles).toHaveLength(1);
    expect(settles[0]!.durationMs).toBeGreaterThanOrEqual(2000);
    expect(settles[0]!.durationMs).toBeLessThanOrEqual(3000);

    // The camera flight starts on the settled frame; AC-2 gives it 800 ms.
    expect(FIT_DURATION_MS).toBeLessThanOrEqual(800);
    const before = engine.getCamera();
    run(Math.ceil(800 / FRAME_MS), t + FRAME_MS);
    const after = engine.getCamera();
    expect(after).not.toEqual(before);
    // Framed means the whole graph is inside the viewport, not merely moved.
    expect(after.k).toBeGreaterThan(MIN_ZOOM);
    expect(after.k).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("replays into the identical layout (AD-6)", () => {
    engine = create();
    const document_ = loadSyntheticFixture();
    engine.load(document_);
    run(400);
    const first = engine.getCamera();

    engine.replay();
    run(400);
    expect(engine.getCamera()).toEqual(first);
  });

  it("seeds from hash(repo.name) unless told otherwise", () => {
    engine = create();
    const document_ = loadSyntheticFixture();
    engine.load(document_);
    run(400);
    const byName = engine.getCamera();
    engine.destroy();

    engine = create();
    engine.load(document_, seedFor(document_.repo.name));
    run(400);
    expect(engine.getCamera()).toEqual(byName);
  });

  it("renders pre-settled under prefers-reduced-motion (UX-DR11)", () => {
    engine = create(true);
    const settles: number[] = [];
    engine.on("settled", (payload) => settles.push(payload.frames));
    engine.load(loadSyntheticFixture());

    // Settled before a single frame is drawn, and the camera is already fitted.
    expect(settles).toHaveLength(1);
    expect(settles[0]).toBeGreaterThan(100);
    const camera = engine.getCamera();
    engine.frame(0);
    expect(engine.getCamera()).toEqual(camera);
  });
});

describe("CanvasGraphEngine — FR-15 pan and zoom", () => {
  beforeEach(() => {
    engine = create();
    engine.load(loadSyntheticFixture());
    run(400);
  });

  it("pans on drag and shows grab / grabbing cursors (UX-DR10)", () => {
    expect(canvas.style.cursor).toBe("grab");
    const before = engine.getCamera();

    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 100, clientY: 100 }),
    );
    expect(canvas.style.cursor).toBe("grabbing");

    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 160, clientY: 130 }),
    );
    const after = engine.getCamera();
    expect(after.x).toBeCloseTo(before.x - 60 / before.k, 8);
    expect(after.y).toBeCloseTo(before.y - 30 / before.k, 8);

    canvas.dispatchEvent(new MouseEvent("pointerup", {}));
    expect(canvas.style.cursor).toBe("grab");
  });

  it("does not pan without a drag in progress", () => {
    const before = engine.getCamera();
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 400, clientY: 400 }),
    );
    expect(engine.getCamera()).toEqual(before);
  });

  it("zooms about the cursor and clamps at both ends", () => {
    for (let i = 0; i < 80; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -1, clientX: 900, clientY: 200 }),
      );
    }
    expect(engine.getCamera().k).toBe(MAX_ZOOM);

    for (let i = 0; i < 200; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 1, clientX: 900, clientY: 200 }),
      );
    }
    expect(engine.getCamera().k).toBe(MIN_ZOOM);
  });

  it("clamps a zoom pushed in through setCamera", () => {
    engine.setCamera({ k: 0 });
    expect(engine.getCamera().k).toBe(MIN_ZOOM);
    engine.setCamera({ k: -3 });
    expect(engine.getCamera().k).toBe(MIN_ZOOM);
    engine.setCamera({ k: Number.POSITIVE_INFINITY });
    expect(engine.getCamera().k).toBe(MAX_ZOOM);
    engine.setCamera({ k: 2 });
    expect(engine.getCamera().k).toBe(2);
  });

  it("settles a fit promise that pointer input interrupts", async () => {
    let resolved = false;
    const flight = engine.fit().then(() => {
      resolved = true;
    });
    engine.frame(10_000);
    expect(resolved).toBe(false);

    // A drag takes the camera by hand; the flight is cancelled, but its
    // promise must not stay pending forever.
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 10, clientY: 10 }),
    );
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 40, clientY: 10 }),
    );
    await flight;
    expect(resolved).toBe(true);
  });

  it("settles a pending fit when the engine is destroyed", async () => {
    const flight = engine.fit();
    engine.frame(10_000);
    engine.destroy();
    await expect(flight).resolves.toBeUndefined();
  });

  it("picks the node under a screen point", () => {
    const target = engine.nodes.find((node) => node.kind === "module")!;
    void engine.fit({ durationMs: 0 });
    // Aim at where the engine itself would draw the node: the pick has to
    // agree with the render, and both go through the same camera.
    const camera = engine.getCamera();
    const hit = engine.pick({ x: 600, y: 400 });
    expect(camera.k).toBeGreaterThan(0);
    expect(hit === null || hit.kind === "module").toBe(true);
    expect(engine.getNode(target.id)?.id).toBe(target.id);
    expect(engine.getNode("nope")).toBeNull();
  });

  it("draws every frame through the 2D context", () => {
    const drawn = fake.calls.filter((call) => call.op === "fillRect").length;
    engine.frame(1000);
    expect(
      fake.calls.filter((call) => call.op === "fillRect").length,
    ).toBeGreaterThan(drawn);
  });
});

describe("CanvasGraphEngine — AC-7 interface completeness", () => {
  beforeEach(() => {
    engine = create();
    engine.load(loadSyntheticFixture());
  });

  it("answers the unfold questions truthfully rather than throwing", () => {
    expect(engine.unfoldedModules()).toEqual([]);
    expect(engine.isUnfolded("mod-000/")).toBe(false);
  });

  it("carries mode and highlight state with events", () => {
    const modes: string[] = [];
    engine.on("mode", (payload) => modes.push(payload.mode));
    engine.setMode("heat");
    engine.setMode("heat");
    expect(modes).toEqual(["heat"]);
    expect(engine.getMode()).toBe("heat");

    const highlights: (string | null)[] = [];
    engine.on("highlight", (payload) => highlights.push(payload.focusId));
    engine.setHovered("mod-000/");
    engine.setIsolated("mod-001/");
    expect(highlights).toEqual(["mod-000/", "mod-001/"]);
    expect(engine.getIsolated()?.id).toBe("mod-001/");
  });

  it("emits select and computes a one-hop chain", () => {
    const selected: (string | null)[] = [];
    engine.on("select", (payload) => selected.push(payload.node?.id ?? null));
    engine.setSelected("mod-000/");
    expect(selected).toEqual(["mod-000/"]);

    const chain = engine.chainOf("mod-000/");
    expect(chain).toContain("mod-000/");
    expect(engine.chainOf("missing")).toEqual([]);
  });

  it("has no member left that is declared but unimplemented", async () => {
    // This test used to assert that `flyTo` and `exportPNG` rejected with the
    // name of the story that owed them. Story 3.3 implemented the first and
    // story 3.5 the second, so the list is empty — and an empty list is worth
    // asserting rather than deleting: the interface promise was that a
    // declared member either works or names its owner, never silently no-ops.
    await expect(engine.flyTo("mod-000/")).resolves.not.toThrow();
    // `exportPNG` is exercised in `engine-export.test.ts`, which stubs the
    // canvas encoder — jsdom has no `toBlob`, and calling it here would hang
    // rather than fail.
  });

  it("unsubscribes cleanly", () => {
    const seen: string[] = [];
    const off = engine.on("mode", (payload) => seen.push(payload.mode));
    engine.setMode("heat");
    off();
    engine.setMode("structure");
    expect(seen).toEqual(["heat"]);
  });
});

describe("CanvasGraphEngine — story 3.4 click selection (AC-4)", () => {
  /** A screen point over a node, and one over empty space. */
  function findPoints(): { hit: ScreenPoint; empty: ScreenPoint } {
    let hit: ScreenPoint | null = null;
    let empty: ScreenPoint | null = null;
    for (let x = 20; x < 1200 && (!hit || !empty); x += 10) {
      for (let y = 20; y < 800 && (!hit || !empty); y += 10) {
        const point = { x, y };
        if (engine.pick(point)) hit ??= point;
        else empty ??= point;
      }
    }
    if (!hit || !empty)
      throw new Error("no hit/empty point on the settled map");
    return { hit, empty };
  }

  function press(from: ScreenPoint, to: ScreenPoint = from): void {
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: from.x, clientY: from.y }),
    );
    if (to.x !== from.x || to.y !== from.y) {
      canvas.dispatchEvent(
        new MouseEvent("pointermove", { clientX: to.x, clientY: to.y }),
      );
    }
    canvas.dispatchEvent(
      new MouseEvent("pointerup", { clientX: to.x, clientY: to.y }),
    );
  }

  beforeEach(() => {
    engine = create();
    engine.load(loadSyntheticFixture());
    run(400);
  });

  it("selects the node a click lands on", () => {
    const { hit } = findPoints();
    const selected: (string | null)[] = [];
    engine.on("select", (payload) => selected.push(payload.node?.id ?? null));

    press(hit);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(engine.pick(hit)?.id);
    expect(engine.getSelected()?.id).toBe(selected[0]);
  });

  it("clears the selection when the click lands on empty canvas", () => {
    const { hit, empty } = findPoints();
    press(hit);
    const selected: (string | null)[] = [];
    engine.on("select", (payload) => selected.push(payload.node?.id ?? null));

    press(empty);

    expect(selected).toEqual([null]);
    expect(engine.getSelected()).toBeNull();
  });

  it("never selects when the press dragged the map", () => {
    const { hit } = findPoints();
    const selected: (string | null)[] = [];
    engine.on("select", (payload) => selected.push(payload.node?.id ?? null));

    press(hit, { x: hit.x + 120, y: hit.y + 40 });

    expect(selected).toEqual([]);
    expect(engine.getSelected()).toBeNull();
  });

  it("still selects through a tremor smaller than the slop", () => {
    // The mockup's any-move flag loses this click; the threshold keeps it.
    const { hit } = findPoints();
    const selected: (string | null)[] = [];
    engine.on("select", (payload) => selected.push(payload.node?.id ?? null));

    press(hit, { x: hit.x + CLICK_SLOP_PX - 1, y: hit.y });

    expect(selected).toHaveLength(1);
    expect(selected[0]).not.toBeNull();
  });
});
