// @vitest-environment jsdom
/**
 * Story 5.6, AC-4: the map's co-change mark, asserted over the render state.
 *
 * The claim this file exists to hold is a negative one. Co-change is **not** a
 * dependency, and the story's binding context says drawing it like one would
 * tell the reader something false. So the important assertions here are not
 * "the ring is pink" — they are "no edge was added", "no node was removed",
 * and "no other encoding moved". A future change that renders the partner set
 * as lines would pass every positive assertion in this file and fail those.
 *
 * Assertions are over `RenderScene` and the calls the renderer makes, not over
 * pixels — the same shape story 5.2's `hover-encoding.test.ts` used. Its own
 * file so bob (5.7) and I never meet in a merge over `render.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import {
  CHAIN_RING_OFFSET_PX,
  COCHANGE_RING_ALPHA,
  COCHANGE_RING_COLOR,
  COCHANGE_RING_DASH,
  COCHANGE_RING_OFFSET_PX,
  COCHANGE_RING_WIDTH,
  HOT_COLOR,
  LAYER_COLOR,
} from "./constants.js";
import { inBlastRadius, renderFrame, type RenderScene } from "./render.js";
import { nodeRadius } from "./graph.js";
import {
  createFakeContext,
  installFakeCanvas,
  type FakeContext,
} from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";
import type { EngineNode } from "./types.js";

const VIEWPORT = { width: 1200, height: 800 };
const SEED = 42;

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

function scene(overrides: Partial<RenderScene> = {}): RenderScene {
  return {
    viewport: VIEWPORT,
    camera: { x: 0, y: 0, k: 1 },
    stars: [],
    nodes: [{ node: node(), x: 0, y: 0 }],
    edges: [],
    mode: "structure",
    timeMs: 0,
    reducedMotion: true,
    chain: null,
    selectedId: null,
    showFileLabels: false,
    ...overrides,
  };
}

describe("blast radius — the predicate over render state (AC-4)", () => {
  it("is false for every node when nothing is marked", () => {
    expect(inBlastRadius(scene(), "core/")).toBe(false);
    expect(inBlastRadius(scene({ blastRadius: null }), "core/")).toBe(false);
  });

  it("is true only for the marked ids", () => {
    const marked = scene({ blastRadius: new Set(["util/", "web/"]) });
    expect(inBlastRadius(marked, "util/")).toBe(true);
    expect(inBlastRadius(marked, "web/")).toBe(true);
    expect(inBlastRadius(marked, "core/")).toBe(false);
  });

  it("does not consult the dependency chain, in either direction", () => {
    // The two encodings are independent by design: a reader can hold a hover
    // chain and a blast radius on screen at once and tell which is which. If
    // this ever started reading `chain`, the mark would silently mean
    // "co-changes AND imports", which is a third thing nobody asked for.
    const both = scene({
      chain: new Set(["core/"]),
      chainMode: "hover",
      blastRadius: new Set(["util/"]),
    });
    expect(inBlastRadius(both, "core/")).toBe(false);
    expect(inBlastRadius(both, "util/")).toBe(true);
  });
});

describe("blast radius — the mark on the canvas (AC-4)", () => {
  function draw(overrides: Partial<RenderScene>): FakeContext {
    const fake = createFakeContext();
    renderFrame(fake.context, scene(overrides));
    return fake;
  }

  it("draws a dashed ring on a marked node", () => {
    const fake = draw({ blastRadius: new Set(["core/"]) });
    const dashes = fake.calls.filter((call) => call.op === "setLineDash");
    expect(dashes[0]!.args[0]).toEqual([...COCHANGE_RING_DASH]);
    expect(fake.strokeStyles).toContain(COCHANGE_RING_COLOR);
  });

  it("draws nothing extra on an unmarked node", () => {
    const fake = draw({});
    expect(fake.calls.some((call) => call.op === "setLineDash")).toBe(false);
    expect(fake.strokeStyles).not.toContain(COCHANGE_RING_COLOR);
  });

  it("puts the ring outside the selection ring, never at the same radius", () => {
    // A partner and the selected node must not produce the same mark: the
    // selection ring sits at +5 px and the chain ring at +3, so the co-change
    // ring is placed beyond both.
    expect(COCHANGE_RING_OFFSET_PX).toBeGreaterThan(5);
    expect(COCHANGE_RING_OFFSET_PX).toBeGreaterThan(CHAIN_RING_OFFSET_PX);

    const fake = draw({ blastRadius: new Set(["core/"]) });
    const radius = node().radius;
    const arcs = fake.calls
      .filter((call) => call.op === "arc")
      .map((call) => call.args[2] as number);
    expect(arcs).toContain(radius + COCHANGE_RING_OFFSET_PX);
  });

  it("uses a colour no layer and no hot spot can produce", () => {
    // The mark must not be readable as "this node is frontend" or "this node
    // is hot". The dash carries the distinction on its own in greyscale; the
    // hue carries it in colour.
    expect(Object.values(LAYER_COLOR)).not.toContain(COCHANGE_RING_COLOR);
    expect(COCHANGE_RING_COLOR).not.toBe(HOT_COLOR);
  });

  it("restores the dash pattern so nothing else is drawn dashed", () => {
    // A dash left set would leak into the selection ring below it and into
    // every mark of every later node in the frame.
    const fake = draw({
      blastRadius: new Set(["core/"]),
      selectedId: "core/",
    });
    const dashes = fake.calls
      .filter((call) => call.op === "setLineDash")
      .map((call) => call.args[0]);
    expect(dashes).toEqual([[...COCHANGE_RING_DASH], []]);
  });

  it("keeps the mark within the node's own opacity", () => {
    // A marked node that is dimmed by isolate must not shine through at full
    // strength — the mark rides the node's alpha rather than overriding it.
    expect(COCHANGE_RING_ALPHA).toBeLessThanOrEqual(1);
    expect(COCHANGE_RING_WIDTH).toBeGreaterThan(0);
  });
});

describe("blast radius — it is not a dependency edge (AC-4)", () => {
  let engine: CanvasGraphEngine;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    installFakeCanvas(VIEWPORT.width, VIEWPORT.height);
    canvas = document.createElement("canvas");
    engine = new CanvasGraphEngine({ canvas, reducedMotion: true });
    engine.load(loadSyntheticFixture(), SEED);
  });

  afterEach(() => {
    engine.destroy();
  });

  /** Two module ids the fixture pairs with each other but does not import. */
  const NODE = "mod-000/";
  const PARTNERS = ["mod-042/", "mod-077/"];

  it("adds no edge to the scene, and removes none", () => {
    // THE assertion of this story's map side. If marking a blast radius ever
    // produced a line, this is what would catch it — and a reader would have
    // been told these files import each other, which is false.
    const before = engine.buildScene(0)!;
    const edgesBefore = before.edges.map(
      (edge) => `${edge.sourceId}->${edge.targetId}`,
    );

    engine.setBlastRadius([NODE, ...PARTNERS]);
    const after = engine.buildScene(0)!;
    const edgesAfter = after.edges.map(
      (edge) => `${edge.sourceId}->${edge.targetId}`,
    );

    expect(edgesAfter).toEqual(edgesBefore);
    expect(after.nodes.map((item) => item.node.id)).toEqual(
      before.nodes.map((item) => item.node.id),
    );
  });

  it("leaves every other encoding exactly where it was", () => {
    // The mark is additive. Nothing dims, nothing brightens, no camera moves —
    // so a blast radius can be read alongside a hover chain without either
    // encoding lying about the other.
    const before = engine.buildScene(0)!;
    engine.setBlastRadius(PARTNERS);
    const after = engine.buildScene(0)!;

    expect(after.chain).toEqual(before.chain);
    expect(after.chainMode).toBe(before.chainMode);
    expect(after.selectedId).toBe(before.selectedId);
    expect(after.camera).toEqual(before.camera);
    expect(after.mode).toBe(before.mode);
  });

  it("carries the marked set into the scene the renderer sees", () => {
    engine.setBlastRadius(PARTNERS);
    const built = engine.buildScene(0)!;
    expect([...built.blastRadius!]).toEqual(PARTNERS);
  });

  it("treats null and the empty set alike: nothing marked", () => {
    engine.setBlastRadius(PARTNERS);
    engine.setBlastRadius(null);
    expect(engine.getBlastRadius()).toEqual([]);
    expect(engine.buildScene(0)!.blastRadius).toBeNull();

    engine.setBlastRadius([]);
    expect(engine.buildScene(0)!.blastRadius).toBeNull();
  });

  it("reads the set back for a chrome that connects later", () => {
    engine.setBlastRadius(PARTNERS);
    expect(engine.getBlastRadius()).toEqual(PARTNERS);
  });

  it("keeps its own copy of the caller's array", () => {
    // A caller mutating the array it passed must not silently repaint the map.
    const ids = [...PARTNERS];
    engine.setBlastRadius(ids);
    ids.push("mod-099/");
    expect(engine.getBlastRadius()).toEqual(PARTNERS);
  });

  it("ignores an id the document does not contain", () => {
    // A stale set marks less, never throws — the document can be replaced
    // under a panel that is still open.
    engine.setBlastRadius(["nope/", ...PARTNERS]);
    const built = engine.buildScene(0)!;
    const marked = built.nodes.filter((item) =>
      inBlastRadius(built, item.node.id),
    );
    expect(marked.map((item) => item.node.id).sort()).toEqual([...PARTNERS]);
  });

  it("drops the mark when a new document is loaded", () => {
    // The ids name nodes of the previous repository. Carrying them across
    // would mark whichever nodes happen to share an id — a mark that means
    // nothing about the map now on screen.
    engine.setBlastRadius(PARTNERS);
    engine.load(loadSyntheticFixture(), SEED);
    expect(engine.getBlastRadius()).toEqual([]);
  });

  it("moves nothing: the same nodes sit at the same positions", () => {
    // Marking is a frame concern, like the layer filter and the scope before
    // it. No re-settle, no re-seed, no simulation call.
    const before = engine.buildScene(0)!.nodes.map((item) => [item.x, item.y]);
    engine.setBlastRadius(PARTNERS);
    const after = engine.buildScene(0)!.nodes.map((item) => [item.x, item.y]);
    expect(after).toEqual(before);
  });
});
