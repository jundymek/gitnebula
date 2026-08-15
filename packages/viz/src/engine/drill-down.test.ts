// @vitest-environment jsdom
/**
 * Story 5.4's engine-side acceptance criteria: the gesture and Escape (AC-2),
 * connected-only (AC-3), settle preservation (AC-4), search out of scope
 * (AC-5) and unpickability (AC-6).
 *
 * The central claim under test is that **scoping is a frame concern**: the
 * simulation keeps running on the whole graph, so a scope/unscope cycle must
 * leave every position untouched and must never restart the settle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import { UNFOLD_ZOOM } from "./constants.js";
import { degreeOf, inScopeIds } from "./scope.js";
import { buildGraph } from "./graph.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { loadContractFixture } from "../test-support/fixtures.js";
import { langgraphShapedDocument } from "../test-support/langgraph-shape.js";
import type { GraphEngineEventMap } from "./types.js";

const FRAME_MS = 1000 / 60;

let canvas: HTMLCanvasElement;
let engine: CanvasGraphEngine;
let clock = 0;

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

/** A settled engine over the langgraph-shaped document (multi-module Python). */
function settledEngine(): CanvasGraphEngine {
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  engine = new CanvasGraphEngine({ canvas, reducedMotion: false });
  engine.load(langgraphShapedDocument());
  run(600);
  return engine;
}

function firstModuleId(): string {
  const module = engine.nodes.find((node) => node.kind === "module");
  if (!module) throw new Error("fixture has no modules");
  return module.id;
}

/** Positions of everything the frame carries, as a comparable map. */
function positions(): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of scene().nodes) {
    map.set(item.node.id, `${item.x},${item.y}`);
  }
  return map;
}

beforeEach(() => {
  installFakeCanvas(1200, 800);
  clock = 0;
});

afterEach(() => {
  engine?.destroy();
  document.body.replaceChildren();
});

describe("AC-1 — the scope narrows the frame", () => {
  it("carries the focus module, its members and its neighbour modules", () => {
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);

    const graph = buildGraph(langgraphShapedDocument());
    const expected = inScopeIds(graph, focus);
    for (const item of scene().nodes) {
      expect(expected.has(item.node.id)).toBe(true);
    }
    expect(scene().nodes.length).toBeGreaterThan(0);
  });

  it("draws fewer nodes scoped than unscoped", () => {
    settledEngine();
    const whole = scene().nodes.length;
    engine.setScope(firstModuleId());
    expect(scene().nodes.length).toBeLessThan(whole);
  });

  it("drops an edge unless BOTH of its ends survive", () => {
    settledEngine();
    engine.setScope(firstModuleId());
    const drawn = new Set(scene().nodes.map((item) => item.node.id));
    for (const edge of scene().edges) {
      expect(drawn.has(edge.sourceId)).toBe(true);
      expect(drawn.has(edge.targetId)).toBe(true);
    }
  });

  it("refuses to scope to a file — only a module is drillable", () => {
    settledEngine();
    const file = engine.nodes.find((node) => node.kind === "file")!;
    engine.setScope(file.id);
    expect(engine.getScope()).toBeNull();
  });

  it("leaves the scope rather than emptying the map for an unknown id", () => {
    settledEngine();
    engine.setScope(firstModuleId());
    engine.setScope("nope/does-not-exist");
    expect(engine.getScope()).toBeNull();
    expect(scene().nodes.length).toBeGreaterThan(0);
  });
});

describe("AC-2 — entering and leaving the scope", () => {
  it("scopes on a double click over a module", () => {
    settledEngine();
    const focus = firstModuleId();
    // Park the camera on the module so a click at the viewport centre hits it.
    void engine.flyTo(focus, { durationMs: 0, zoom: 1.2 });
    canvas.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 600, clientY: 400, bubbles: true }),
    );
    expect(engine.getScope()).toBe(focus);
  });

  it("leaves the scope on a double click over empty space", () => {
    settledEngine();
    engine.setScope(firstModuleId());
    canvas.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 5, clientY: 5, bubbles: true }),
    );
    expect(engine.getScope()).toBeNull();
  });

  it("leaves the scope on Escape", () => {
    settledEngine();
    engine.setScope(firstModuleId());
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(engine.getScope()).toBeNull();
  });

  it("does NOT eat Escape while the keyboard is in a text field", () => {
    // `chrome/search.ts` owns Escape inside its input, where it closes the
    // result list. Two handlers racing for one key is how a search box stops
    // being able to dismiss itself.
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(engine.getScope()).toBe(focus);
  });

  it("publishes the scope on the `scope` event so chrome can state it", () => {
    settledEngine();
    const seen: GraphEngineEventMap["scope"][] = [];
    engine.on("scope", (payload) => seen.push(payload));
    const focus = firstModuleId();
    engine.setScope(focus);
    expect(seen.at(-1)?.scopeId).toBe(focus);
    engine.setScope(null);
    expect(seen.at(-1)?.scopeId).toBeNull();
  });
});

describe("AC-3 — connected-only", () => {
  it("states how many nodes of the document carry no edge at all", () => {
    // The count is a property of the document, not of the current viewport —
    // which is what makes it a stable thing to print. AC-3's own baseline is
    // phrased that way too ("232 of 650 files on langgraph").
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    engine = new CanvasGraphEngine({ canvas, reducedMotion: true });
    engine.load(loadContractFixture("synthetic-100x2000"));
    run(5);

    engine.setConnectedOnly(true);
    expect(engine.hiddenCount().byDegree).toBeGreaterThan(500);
  });

  it("removes edgeless files from the frame once their module is unfolded", () => {
    // At rest the frame carries top-level nodes only, and every module in this
    // fixture has members, so nothing is edgeless up there. The filter has to
    // be observed where the edgeless nodes actually are: inside an unfolded
    // module (ADR-0006).
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    engine = new CanvasGraphEngine({ canvas, reducedMotion: true });
    engine.load(loadContractFixture("synthetic-100x2000"));
    run(5);

    const module = engine.nodes.find((node) => node.kind === "module")!;
    void engine.flyTo(module.id, { durationMs: 0, zoom: UNFOLD_ZOOM + 0.5 });
    run(5);
    expect(engine.unfoldedModules().length).toBeGreaterThan(0);

    const graph = buildGraph(loadContractFixture("synthetic-100x2000"));
    const before = scene().nodes;
    const edgelessDrawn = before.filter(
      (item) => degreeOf(graph, item.node.id) === 0,
    );
    expect(edgelessDrawn.length).toBeGreaterThan(0);

    engine.setConnectedOnly(true);
    const after = new Set(scene().nodes.map((item) => item.node.id));
    for (const item of edgelessDrawn) {
      expect(after.has(item.node.id)).toBe(false);
    }
    expect(after.size).toBe(before.length - edgelessDrawn.length);
  });

  it("keeps the two hidden counts apart by cause, never as one total", () => {
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);
    engine.setConnectedOnly(true);
    const counts = engine.hiddenCount();
    const graph = buildGraph(langgraphShapedDocument());
    const scoped = inScopeIds(graph, focus);
    expect(counts.byScope).toBe(graph.nodes.length - scoped.size);
    expect(counts.byDegree).toBe(
      [...scoped].filter((id) => degreeOf(graph, id) === 0).length,
    );
  });

  it("reports zero hidden when no filter is active", () => {
    settledEngine();
    expect(engine.hiddenCount()).toEqual({ byScope: 0, byDegree: 0 });
  });
});

describe("AC-4 — scoping never re-runs the settle", () => {
  it("leaves every position untouched across a scope/unscope cycle", () => {
    settledEngine();
    const before = positions();
    engine.setScope(firstModuleId());
    engine.setScope(null);
    const after = positions();

    expect(after.size).toBe(before.size);
    for (const [id, position] of before) {
      expect(after.get(id)).toBe(position);
    }
  });

  it("emits no settle-start when a scope is entered or left", () => {
    settledEngine();
    const onSettleStart = vi.fn();
    engine.on("settle-start", onSettleStart);
    engine.setScope(firstModuleId());
    engine.setConnectedOnly(true);
    engine.setConnectedOnly(false);
    engine.setScope(null);
    expect(onSettleStart).not.toHaveBeenCalled();
  });

  it("does not move positions while scoped either", () => {
    settledEngine();
    const focus = firstModuleId();
    const before = positions();
    engine.setScope(focus);
    for (const item of scene().nodes) {
      expect(before.get(item.node.id)).toBe(`${item.x},${item.y}`);
    }
  });
});

describe("AC-5 — search out of the scope leaves it and flies", () => {
  function outOfScopeTarget(focus: string): string {
    const graph = buildGraph(langgraphShapedDocument());
    const scope = inScopeIds(graph, focus);
    const target = graph.nodes.find((node) => !scope.has(node.id));
    if (!target) throw new Error("fixture has nothing outside this scope");
    return target.id;
  }

  it("leaves the scope instead of silently doing nothing", async () => {
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);
    const target = outOfScopeTarget(focus);

    await engine.flyTo(target, { durationMs: 0 });

    expect(engine.getScope()).toBeNull();
    // Flew, and selected on arrival — the existing flyTo path, unchanged.
    expect(engine.getSelected()?.id).toBe(target);
  });

  it("names the scope it left so the chrome can offer a way back", async () => {
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);
    const seen: GraphEngineEventMap["scope"][] = [];
    engine.on("scope", (payload) => seen.push(payload));

    await engine.flyTo(outOfScopeTarget(focus), { durationMs: 0 });

    const left = seen.at(-1);
    expect(left?.leftForId).not.toBeNull();
    expect(left?.previousScopeId).toBe(focus);
    expect(engine.getLastScope()).toBe(focus);
  });

  it("puts the target in the frame after leaving", async () => {
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);
    const target = outOfScopeTarget(focus);
    await engine.flyTo(target, { durationMs: 0 });
    const drawn = new Set(scene().nodes.map((item) => item.node.id));
    expect(drawn.has(target)).toBe(true);
  });

  it("keeps the scope when the target is inside it", async () => {
    settledEngine();
    const focus = firstModuleId();
    engine.setScope(focus);
    await engine.flyTo(focus, { durationMs: 0 });
    expect(engine.getScope()).toBe(focus);
  });
});

describe("AC-6 — excluded nodes are absent, not dimmed", () => {
  /** Screen point of a node, via the engine's own camera maths. */
  function screenOf(id: string): { x: number; y: number } {
    void engine.flyTo(id, { durationMs: 0, zoom: 2 });
    return { x: 600, y: 400 };
  }

  it("cannot pick a node the scope excluded", () => {
    settledEngine();
    const focus = firstModuleId();
    const graph = buildGraph(langgraphShapedDocument());
    const scope = inScopeIds(graph, focus);
    const outside = graph.nodes.find(
      (node) => !scope.has(node.id) && node.kind === "module",
    )!;

    const point = screenOf(outside.id);
    expect(engine.pick(point)?.id).toBe(outside.id);

    engine.setScope(focus);
    expect(engine.pick(point)).toBeNull();
  });

  it("cannot pick a degree-0 node once connected-only is on", () => {
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    engine = new CanvasGraphEngine({ canvas, reducedMotion: true });
    engine.load(loadContractFixture("synthetic-100x2000"));
    run(5);

    const graph = buildGraph(loadContractFixture("synthetic-100x2000"));
    const edgeless = graph.nodes.find(
      (node) => node.kind === "file" && degreeOf(graph, node.id) === 0,
    )!;
    const point = screenOf(edgeless.id);
    expect(engine.pick(point)?.id).toBe(edgeless.id);

    engine.setConnectedOnly(true);
    expect(engine.pick(point)).toBeNull();
  });

  it("stops hover from reaching an excluded node", () => {
    settledEngine();
    const focus = firstModuleId();
    const graph = buildGraph(langgraphShapedDocument());
    const scope = inScopeIds(graph, focus);
    const outside = graph.nodes.find(
      (node) => !scope.has(node.id) && node.kind === "module",
    )!;
    const point = screenOf(outside.id);
    engine.setScope(focus);

    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: point.x,
        clientY: point.y,
        bubbles: true,
      }),
    );
    expect(engine.getHovered()).toBeNull();
  });
});
