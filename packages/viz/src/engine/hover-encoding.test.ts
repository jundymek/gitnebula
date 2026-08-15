// @vitest-environment jsdom
/**
 * Story 5.2: hover highlights the chain instead of dimming the map (FR-29).
 *
 * The baseline this replaces was measured on a real langgraph checkout: a
 * hovered node dimmed 647 of 650 nodes to `NODE_ALPHA_DIMMED`, because the
 * median 1-hop chain is 3 nodes, and at 6× zoom pointer hit-areas cover 78% of
 * the viewport — so the map strobed under a moving cursor.
 *
 * The assertions here are over the render state (`nodeAlpha`, `edgeAlpha`, the
 * scene the engine builds) rather than over screenshots, which is what AC-1
 * asks for. They live in their own file so the wave-A cohort never meets in a
 * merge over `render.test.ts` or `navigation.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import {
  CHAIN_GLOW_BOOST,
  CHAIN_RING_OFFSET_PX,
  EDGE_ALPHA_CHAIN,
  EDGE_ALPHA_DIMMED,
  EDGE_ALPHA_HOVER_REST,
  HOVER_CARRY_MS,
  NODE_ALPHA_DIMMED,
  NODE_ALPHA_HOVER_REST,
} from "./constants.js";
import { nodeRadius } from "./graph.js";
import {
  edgeAlpha,
  emphasised,
  nodeAlpha,
  renderFrame,
  type RenderableEdge,
  type RenderScene,
} from "./render.js";
import {
  createFakeContext,
  installFakeCanvas,
} from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";
import type { EngineNode, ScreenPoint } from "./types.js";

const FRAME_MS = 1000 / 60;
const VIEWPORT = { width: 1200, height: 800 };

function node(overrides: Partial<EngineNode> = {}): EngineNode {
  return {
    id: "core/",
    kind: "module",
    parent: null,
    path: "core/",
    layer: "backend",
    loc: 6140,
    churn: 0.2,
    commits: 12,
    authors: 3,
    lastChangedAt: null,
    description: null,
    hot: false,
    radius: nodeRadius("module", 6140),
    ...overrides,
  };
}

function edge(overrides: Partial<RenderableEdge> = {}): RenderableEdge {
  return {
    sourceId: "a",
    targetId: "b",
    sx: -100,
    sy: 0,
    tx: 100,
    ty: 0,
    member: false,
    ...overrides,
  };
}

function scene(overrides: Partial<RenderScene> = {}): RenderScene {
  return {
    viewport: { width: 800, height: 600 },
    camera: { x: 0, y: 0, k: 1 },
    stars: [],
    nodes: [{ node: node(), x: 0, y: 0 }],
    edges: [],
    mode: "structure",
    timeMs: 0,
    reducedMotion: false,
    chain: null,
    selectedId: null,
    showFileLabels: false,
    ...overrides,
  };
}

describe("AC-1 — hover leaves the map legible and marks the chain", () => {
  it("rests out-of-chain nodes at 0.55 and their edges at 0.12", () => {
    const hovered = scene({
      chain: new Set(["core/"]),
      chainMode: "hover",
    });

    expect(NODE_ALPHA_HOVER_REST).toBe(0.55);
    expect(EDGE_ALPHA_HOVER_REST).toBe(0.12);
    expect(nodeAlpha(hovered, "somewhere-else")).toBe(NODE_ALPHA_HOVER_REST);
    expect(edgeAlpha(hovered, edge({ sourceId: "x", targetId: "y" }))).toBe(
      EDGE_ALPHA_HOVER_REST,
    );

    // And the values it replaces are genuinely gone from the hover path: the
    // whole point is that 647 of 650 nodes no longer fall to 0.1.
    expect(nodeAlpha(hovered, "somewhere-else")).not.toBe(NODE_ALPHA_DIMMED);
    expect(edgeAlpha(hovered, edge({ sourceId: "x", targetId: "y" }))).not.toBe(
      EDGE_ALPHA_DIMMED,
    );
  });

  it("keeps the chain itself at full opacity and its edges at EDGE_ALPHA_CHAIN", () => {
    const hovered = scene({
      chain: new Set(["core/", "b"]),
      chainMode: "hover",
    });
    expect(nodeAlpha(hovered, "core/")).toBe(1);
    expect(edgeAlpha(hovered, edge({ sourceId: "core/", targetId: "b" }))).toBe(
      EDGE_ALPHA_CHAIN,
    );
    // One end in the chain is not a chain edge: it would point at something
    // the user is not being shown.
    expect(edgeAlpha(hovered, edge({ sourceId: "core/", targetId: "z" }))).toBe(
      EDGE_ALPHA_HOVER_REST,
    );
  });

  it("marks the chain by emphasis: a brighter glow and a ring", () => {
    const fake = createFakeContext();
    const hovered = scene({ chain: new Set(["core/"]), chainMode: "hover" });
    expect(emphasised(hovered, "core/")).toBe(true);
    renderFrame(fake.context, hovered);

    const screenRadius = nodeRadius("module", 6140);
    const ring = fake.calls.find(
      (call) =>
        call.op === "arc" &&
        Math.abs(
          (call.args[2] as number) - (screenRadius + CHAIN_RING_OFFSET_PX),
        ) < 1e-9,
    );
    expect(ring).toBeDefined();

    // The glow is bigger than the same node draws unfocused — brightness is
    // the chain's mark, not the absence of everything else.
    const plain = createFakeContext();
    renderFrame(plain.context, scene());
    const glowOf = (
      calls: readonly { op: string; args: readonly unknown[] }[],
    ) =>
      calls.find((call) => call.op === "createRadialGradient")!
        .args[5] as number;
    expect(glowOf(fake.calls) / glowOf(plain.calls)).toBeCloseTo(
      CHAIN_GLOW_BOOST,
      10,
    );
  });

  it("leaves an unfocused map untouched", () => {
    const plain = scene();
    expect(nodeAlpha(plain, "anything")).toBe(1);
    expect(emphasised(plain, "core/")).toBe(false);
  });
});

describe("AC-4 — isolate keeps its own encoding", () => {
  it("still extinguishes the map outside the chain", () => {
    const isolated = scene({
      chain: new Set(["core/"]),
      chainMode: "isolate",
    });
    expect(nodeAlpha(isolated, "somewhere-else")).toBe(NODE_ALPHA_DIMMED);
    expect(edgeAlpha(isolated, edge({ sourceId: "x", targetId: "y" }))).toBe(
      EDGE_ALPHA_DIMMED,
    );
    // No new mark on the isolate path: story 3.4's encoding is unchanged.
    expect(emphasised(isolated, "core/")).toBe(false);
  });

  it("treats a scene built before this story as an isolate scene", () => {
    // `chainMode` is optional so nothing built against the old shape changes
    // meaning — including story 3.5's export scenes.
    const legacy = scene({ chain: new Set(["core/"]) });
    expect(nodeAlpha(legacy, "somewhere-else")).toBe(NODE_ALPHA_DIMMED);
  });

  it("keeps the near-invisible module label under isolate only", () => {
    const isolated = createFakeContext();
    renderFrame(
      isolated.context,
      scene({ chain: new Set(["other"]), chainMode: "isolate" }),
    );
    expect(isolated.fillStyles).toContain("rgba(214,222,236,0.16)");

    const hovered = createFakeContext();
    renderFrame(
      hovered.context,
      scene({ chain: new Set(["other"]), chainMode: "hover" }),
    );
    expect(hovered.fillStyles).not.toContain("rgba(214,222,236,0.16)");
  });
});

describe("AC-5 — reduced motion introduces no transition on hover", () => {
  it("draws the same alphas whatever the clock and whatever the motion setting", () => {
    const at = (timeMs: number, reducedMotion: boolean) =>
      scene({
        chain: new Set(["core/"]),
        chainMode: "hover",
        timeMs,
        reducedMotion,
      });

    for (const reducedMotion of [false, true]) {
      const early = at(0, reducedMotion);
      const late = at(5_000, reducedMotion);
      expect(nodeAlpha(early, "outside")).toBe(nodeAlpha(late, "outside"));
      expect(nodeAlpha(early, "core/")).toBe(nodeAlpha(late, "core/"));
    }
    // Reduced motion and normal motion agree: there is nothing to suppress,
    // because no drawn hover value is a function of elapsed time.
    expect(nodeAlpha(at(0, true), "outside")).toBe(
      nodeAlpha(at(0, false), "outside"),
    );
  });
});

describe("engine — the hover path (AC-1, AC-2, AC-3)", () => {
  let canvas: HTMLCanvasElement;
  let engine: CanvasGraphEngine;
  let clock = 0;

  function run(count: number): void {
    for (let i = 0; i < count; i++) {
      clock += FRAME_MS;
      engine.frame(clock);
    }
  }

  function currentScene() {
    const built = engine.buildScene(clock);
    if (!built) throw new Error("engine has no scene");
    return built;
  }

  function move(point: ScreenPoint): void {
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { clientX: point.x, clientY: point.y }),
    );
  }

  /** Screen points that pick each of two distinct modules, and one that picks nothing. */
  function probe(): {
    first: ScreenPoint;
    second: ScreenPoint;
    empty: ScreenPoint;
  } {
    let first: ScreenPoint | null = null;
    let second: ScreenPoint | null = null;
    let empty: ScreenPoint | null = null;
    let firstId: string | null = null;
    for (let x = 20; x < VIEWPORT.width; x += 10) {
      for (let y = 20; y < VIEWPORT.height; y += 10) {
        const point = { x, y };
        const hit = engine.pick(point);
        if (hit === null) {
          empty ??= point;
          continue;
        }
        if (firstId === null) {
          firstId = hit.id;
          first = point;
        } else if (hit.id !== firstId) {
          second ??= point;
        }
      }
    }
    if (!first || !second || !empty) {
      throw new Error("fixture did not offer two nodes and a gap");
    }
    return { first, second, empty };
  }

  beforeEach(() => {
    installFakeCanvas(VIEWPORT.width, VIEWPORT.height);
    clock = 0;
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    engine = new CanvasGraphEngine({ canvas });
    engine.load(loadSyntheticFixture());
    run(600);
  });

  afterEach(() => {
    engine.destroy();
  });

  it("builds a hover-encoded scene for a hover and an isolate-encoded one for isolate", () => {
    const module = engine.nodes.find((item) => item.kind === "module")!;

    engine.setHovered(module.id, { x: 0, y: 0 });
    expect(currentScene().chainMode).toBe("hover");

    engine.setIsolated(module.id);
    expect(currentScene().chainMode).toBe("isolate");
  });

  it("AC-2 — an explicit hover exit restores full opacity on the next frame", () => {
    const module = engine.nodes.find((item) => item.kind === "module")!;
    engine.setHovered(module.id, { x: 0, y: 0 });
    expect(currentScene().chain).not.toBeNull();

    engine.setHovered(null, null);
    // No hold, no wait: the chain is gone in the very same frame.
    expect(currentScene().chain).toBeNull();
    run(1);
    expect(currentScene().chain).toBeNull();
  });

  it("AC-2 — hover stays suppressed during a pan, and a press ends a held chain", () => {
    const { first, empty } = probe();

    move(first);
    expect(engine.getHovered()).not.toBeNull();
    move(empty);

    // Mid-hold, a press begins: the map must not stay lit under a drag.
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: empty.x, clientY: empty.y }),
    );
    expect(currentScene().chain).toBeNull();

    // And a drag across a node does not light it up.
    move(first);
    expect(engine.getHovered()).toBeNull();
    expect(currentScene().chain).toBeNull();
  });

  it("AC-3 — a pointer crossing node → gap → node never drops the chain", () => {
    const { first, second, empty } = probe();

    move(first);
    run(1);
    const before = currentScene().chain;
    expect(before).not.toBeNull();

    // The gap between two nodes: a frame or two of background. Under the old
    // encoding this frame had no chain at all and the whole map jumped back to
    // full opacity — the strobe.
    move(empty);
    run(1);
    expect(currentScene().chain).not.toBeNull();
    expect(currentScene().chainMode).toBe("hover");

    move(second);
    run(1);
    const after = currentScene().chain;
    expect(after).not.toBeNull();
    expect([...after!]).not.toEqual([...before!]);
  });

  it("AC-3 — a sweep across many nodes has no chainless frame", () => {
    const { first, second, empty } = probe();
    const path = [first, empty, second, empty, first, empty, second];

    move(path[0]!);
    run(1);
    const chains: (number | null)[] = [];
    for (const point of path.slice(1)) {
      move(point);
      run(1);
      chains.push(currentScene().chain?.size ?? null);
    }
    expect(chains.every((size) => size !== null)).toBe(true);
  });

  it("AC-3 — the hold is bounded: the map comes back after HOVER_CARRY_MS", () => {
    const { first, empty } = probe();

    move(first);
    run(1);
    move(empty);
    run(1);
    expect(currentScene().chain).not.toBeNull();

    // Frames keep arriving with the pointer over the background; the hold is a
    // debounce, not a stuck highlight.
    run(Math.ceil(HOVER_CARRY_MS / FRAME_MS) + 1);
    expect(currentScene().chain).toBeNull();
  });
});
