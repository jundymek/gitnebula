// @vitest-environment jsdom
/**
 * Story 5.3 — the layer filter, proved where it is implemented.
 *
 * The claim this file exists to hold is the story's whole point: **excluded
 * means not drawn, never dimmed**. Measured on langgraph, pointer hit-areas
 * cover 78% of the viewport at 6× zoom, so a node that is merely dimmed still
 * catches the pointer — which is why every assertion here is about *absence*
 * (from the scene, from `pick`) and never about an alpha.
 *
 * The second claim is that filtering is a **frame** concern: the simulation
 * keeps running on the whole graph, so a toggle costs a redraw and never a
 * re-settle (AC-6).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDocument, Layer } from "@gitnebula/contract";

import { toScreen } from "./camera.js";
import { CanvasGraphEngine } from "./engine.js";
import { ALL_LAYERS } from "./layers.js";
import {
  installFakeCanvas,
  type DrawCall,
  type FakeContext,
} from "../test-support/fake-canvas.js";
import { loadContractFixture } from "../test-support/fixtures.js";

const FRAME_MS = 1000 / 60;
const VIEWPORT = { width: 1200, height: 800 };

let fake: FakeContext;
let canvas: HTMLCanvasElement;
let engine: CanvasGraphEngine;
let clock = 0;

/**
 * The `root-files` fixture with two layers reassigned.
 *
 * It already carries three top-level files and a `backend` module, which is
 * what makes it the one committed fixture whose *drawn* nodes span more than
 * one layer. `version.py` moves to `frontend` so that its incoming edge from
 * `setup.py` (`infra`) becomes a genuine cross-layer edge between two nodes
 * that are both on screen at the default zoom — AC-3 needs exactly that, and
 * no committed fixture has one.
 */
function mixedLayerDocument(): AnalysisDocument {
  const base = loadContractFixture("root-files");
  const reassign: Readonly<Record<string, Layer>> = {
    "version.py": "frontend",
  };
  return {
    ...base,
    nodes: base.nodes.map((node) =>
      reassign[node.id] ? { ...node, layer: reassign[node.id]! } : node,
    ),
  };
}

function run(count: number): void {
  for (let i = 0; i < count; i++) {
    clock += FRAME_MS;
    engine.frame(clock);
  }
}

function scene() {
  const built = engine.buildScene(clock);
  if (!built) throw new Error("engine has no scene");
  return built;
}

function sceneNodeIds(): string[] {
  return scene().nodes.map((item) => item.node.id);
}

function positions(): Map<string, { x: number; y: number }> {
  return new Map(
    scene().nodes.map((item) => [item.node.id, { x: item.x, y: item.y }]),
  );
}

/** Where a node sits on screen right now, filtered or not. */
function screenOf(id: string): { x: number; y: number } {
  const at = positions().get(id);
  if (!at) throw new Error(`${id} is not in the scene`);
  return toScreen(at, engine.getCamera(), VIEWPORT);
}

function settledEngine(
  document: AnalysisDocument = mixedLayerDocument(),
): CanvasGraphEngine {
  canvas = window.document.createElement("canvas");
  window.document.body.append(canvas);
  engine = new CanvasGraphEngine({ canvas });
  engine.load(document);
  run(600);
  return engine;
}

/** Draw calls with their arguments, as a comparable string (as story 3.5). */
function signature(calls: readonly DrawCall[]): string[] {
  return calls
    .filter((call) => call.op !== "setTransform")
    .map((call) => `${call.op}(${JSON.stringify(call.args)})`);
}

function stubToBlob(): void {
  HTMLCanvasElement.prototype.toBlob = function toBlob(
    callback: BlobCallback,
    type?: string,
  ): void {
    callback(new Blob(["fake-png"], { type: type ?? "image/png" }));
  };
}

beforeEach(() => {
  fake = installFakeCanvas(VIEWPORT.width, VIEWPORT.height);
  stubToBlob();
  clock = 0;
});

afterEach(() => {
  engine?.destroy();
  window.document.body.replaceChildren();
});

describe("the default is every layer (FR-28)", () => {
  it("starts with all five layers on, in ALL_LAYERS order", () => {
    settledEngine();
    expect(engine.getLayerFilter()).toEqual([...ALL_LAYERS]);
  });

  it("draws the whole document until something is switched off", () => {
    settledEngine();
    expect(sceneNodeIds()).toContain("test_proxy.py");
    expect(sceneNodeIds()).toContain("setup.py");
    expect(sceneNodeIds()).toContain("fp/");
  });

  it("ignores a value that is not one of the contract's layers", () => {
    settledEngine();
    engine.setLayerFilter(["backend", "nonsense" as Layer]);
    expect(engine.getLayerFilter()).toEqual(["backend"]);
  });
});

describe("AC-2 — an excluded node is absent, not dimmed", () => {
  it("removes it from the rendered scene entirely", () => {
    settledEngine();
    expect(sceneNodeIds()).toContain("test_proxy.py");

    engine.setLayerFilter(["backend"]);

    const drawn = scene().nodes;
    expect(drawn.map((item) => item.node.id)).not.toContain("test_proxy.py");
    // The strong form of the claim: nothing in the frame is off-layer at all,
    // at any opacity. An implementation that dimmed instead of dropping would
    // still list the node here.
    expect(drawn.every((item) => item.node.layer === "backend")).toBe(true);
  });

  it("cannot be picked at the position it used to occupy", () => {
    settledEngine();
    const screen = screenOf("test_proxy.py");
    expect(engine.pick(screen)?.id).toBe("test_proxy.py");

    engine.setLayerFilter(["backend"]);

    expect(engine.pick(screen)).toBeNull();
  });

  it("cannot be hovered, and drops the hover it already had", () => {
    settledEngine();
    engine.setHovered("test_proxy.py");
    expect(engine.getHovered()?.id).toBe("test_proxy.py");

    engine.setLayerFilter(["backend"]);

    expect(engine.getHovered()).toBeNull();
  });

  it("drops a selection that has left the frame, isolate with it", () => {
    settledEngine();
    engine.setSelected("test_proxy.py");
    engine.setIsolated("test_proxy.py");

    engine.setLayerFilter(["backend"]);

    expect(engine.getSelected()).toBeNull();
    expect(engine.getIsolated()).toBeNull();
  });

  it("keeps a selection that survives the filter", () => {
    settledEngine();
    engine.setSelected("fp/");
    engine.setLayerFilter(["backend"]);
    expect(engine.getSelected()?.id).toBe("fp/");
  });

  it("announces the change once, with the count it hid", () => {
    settledEngine();
    const seen: {
      layers: readonly Layer[];
      hidden: number;
      visible: number;
    }[] = [];
    engine.on("filter", (payload) => seen.push(payload));

    engine.setLayerFilter(["backend"]);
    // Setting the same filter again is not a change and must not re-announce.
    engine.setLayerFilter(["backend"]);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.layers).toEqual(["backend"]);
    // `root-files` carries setup.py + version.py (infra/frontend) and
    // test_proxy.py (test); the rest is backend.
    expect(seen[0]!.hidden).toBe(3);
    // The two counts describe the same document and must sum to it.
    expect(seen[0]!.visible + seen[0]!.hidden).toBe(engine.nodes.length);
  });
});

describe("AC-3 — an edge needs both of its endpoints", () => {
  it("drops a cross-layer edge when one end is filtered out", () => {
    settledEngine();
    const crossLayer = (
      edges: readonly { sourceId: string; targetId: string }[],
    ) =>
      edges.some(
        (edge) =>
          edge.sourceId === "setup.py" && edge.targetId === "version.py",
      );
    // Present while both ends are drawn: infra → frontend.
    expect(crossLayer(scene().edges)).toBe(true);

    engine.setLayerFilter(["infra", "backend", "test", "other"]);

    expect(crossLayer(scene().edges)).toBe(false);
    // And the surviving endpoint is still drawn — the edge went, not the node.
    expect(sceneNodeIds()).toContain("setup.py");
  });

  it("keeps only edges whose two ends both survive", () => {
    settledEngine();
    engine.setLayerFilter(["backend", "infra"]);
    const surviving = new Set(sceneNodeIds());
    for (const edge of scene().edges) {
      expect(surviving.has(edge.sourceId)).toBe(true);
      expect(surviving.has(edge.targetId)).toBe(true);
    }
  });
});

describe("AC-5 — the PNG export carries the filter", () => {
  it("re-renders the filtered scene, not the whole map", async () => {
    settledEngine();
    engine.setLayerFilter(["backend"]);

    fake.calls.length = 0;
    engine.frame(clock);
    const live = signature(fake.calls);

    fake.calls.length = 0;
    await engine.exportPNG();
    const exported = signature(fake.calls);

    expect(exported).toEqual(live);
  });

  it("draws no filtered-out label into the export", async () => {
    settledEngine();
    // The module label is the one piece of node text the renderer writes, so
    // its absence is a direct read on what the export contained.
    engine.setLayerFilter(["test"]);
    fake.calls.length = 0;
    await engine.exportPNG();
    const texts = fake.calls
      .filter((call) => call.op === "fillText")
      .map((call) => String(call.args[0]));
    expect(texts).not.toContain("fp/");
  });
});

describe("AC-6 — a toggle is a redraw, never a re-settle", () => {
  it("leaves every surviving node exactly where it was", () => {
    settledEngine();
    const before = positions();

    engine.setLayerFilter(["backend"]);
    engine.setLayerFilter([...ALL_LAYERS]);
    run(1);

    const after = positions();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, at] of before) {
      // Identical, not merely close: nothing re-ran, so nothing moved.
      expect(after.get(id)).toEqual(at);
    }
  });

  it("emits no settle-start across the toggle", () => {
    settledEngine();
    let settleStarts = 0;
    engine.on("settle-start", () => settleStarts++);

    engine.setLayerFilter(["backend"]);
    run(10);
    engine.setLayerFilter([...ALL_LAYERS]);
    run(10);

    expect(settleStarts).toBe(0);
  });
});

/**
 * Debt 7b, reported by story 5.7 and never assigned (story 6.5).
 *
 * `hiddenCount().visible` is documented as the survivors of **every** filter,
 * layers included (`types.ts`). But `visibleIds()` returns `null` as an
 * early-out whenever there is no scope and no connected-only filter — nothing
 * needs materialising in that case — and `hiddenCount()` read that `null` as
 * "everything survives", falling back to `graph.nodes.length`. The layer
 * filter was therefore invisible to the count on the one path where the layer
 * filter is the *only* thing removing nodes.
 *
 * 5.7 hit it while building the degradation sweep, which read the full node
 * count for every sample. It handed the defect to "5.3/5.4", both already
 * merged, so no one received it.
 *
 * The fixture matters as much as the assertion. Epic 5 shipped a test that
 * went green with its bug still present because no node in the fixture had
 * the failing shape, so the shape is spelled out here: ≥ 2 layers, no scope,
 * no connected-only, one layer switched off.
 */
describe("debt 7b — the survivor count respects the layer filter", () => {
  it("counts survivors, not the whole graph, with no scope and no connected-only", () => {
    settledEngine();
    const total = engine.nodes.length;
    expect(engine.getScope()).toBeNull();
    expect(engine.getConnectedOnly()).toBe(false);
    expect(engine.hiddenCount().visible).toBe(total);

    engine.setLayerFilter(["backend"]);

    const survivors = engine.nodes.filter(
      (node) => node.layer === "backend",
    ).length;
    // The guard that makes this a real test rather than a tautology: the
    // filter has to be hiding something, or `total` and `survivors` agree and
    // the unfixed implementation passes.
    expect(survivors).toBeGreaterThan(0);
    expect(survivors).toBeLessThan(total);
    expect(engine.hiddenCount().visible).toBe(survivors);
  });

  it("reports the same survivor count on the `scope` event, on leaving a scope", () => {
    settledEngine();
    engine.setLayerFilter(["backend"]);

    const seen: number[] = [];
    engine.on("scope", (payload) => seen.push(payload.visibleCount));

    // Leaving a scope is the reachable path onto the early-out: the event
    // fires, and by the time it computes its count there is no scope and no
    // connected-only left, so `visibleIds()` is `null` again. A layer toggle
    // by itself does NOT emit here — `onLayerFilterChanged` returns early
    // when nothing is scoped, which is deliberate and left alone.
    engine.setScope("fp/");
    engine.setScope(null);

    // `emitScope` carried its own copy of the same expression, so fixing only
    // the accessor would have left the wrong number on the path chrome reads.
    const survivors = engine.nodes.filter(
      (node) => node.layer === "backend",
    ).length;
    expect(seen.at(-1)).toBe(survivors);
  });

  it("returns to the full count when every layer comes back", () => {
    settledEngine();
    const total = engine.nodes.length;

    engine.setLayerFilter(["backend"]);
    engine.setLayerFilter([...ALL_LAYERS]);

    expect(engine.hiddenCount().visible).toBe(total);
  });
});
