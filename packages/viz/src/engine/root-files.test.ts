// @vitest-environment jsdom
/**
 * Story 4.7 — a repository's root files on the map.
 *
 * Story 2.1 gives repository-root files `parent: null` rather than inventing a
 * synthetic `./` module. The Viewer never learned the case, so every such file
 * was in no module, in no simulation, and in no scene: 82% of `free-proxy`'s
 * lines were missing from its own map.
 *
 * The visibility rule chosen here (AC-2) is **always visible**: a root file is
 * a top-level node beside the modules, drawn at every zoom level, never
 * unfolded and never collapsed. `MemberLayout` is anchored on a module and
 * contains that module's members alone — a parent-less file has neither, so
 * unfold has nothing to say about it. The no-shift half of AC-2 then holds
 * structurally: there is no appearance event to shift anything around, which
 * the unfold/collapse cycle below asserts to the same numeric bound
 * `navigation.test.ts` holds the global layout to.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CanvasGraphEngine } from "./engine.js";
import { UNFOLD_ZOOM } from "./constants.js";
import { nodeRadius } from "./graph.js";
import { SETTLE_DISPLACEMENT_PX } from "./settle.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { loadContractFixture } from "../test-support/fixtures.js";
import { toScreen } from "./camera.js";

const FRAME_MS = 1000 / 60;
/** The three `parent: null` files in the `root-files` fixture. */
const ROOT_FILES = ["setup.py", "test_proxy.py", "version.py"] as const;

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

function settledEngine(): CanvasGraphEngine {
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  engine = new CanvasGraphEngine({ canvas });
  engine.load(loadContractFixture("root-files"));
  run(600);
  return engine;
}

/** World positions of every node currently in the scene, by id. */
function positions(): Map<string, { x: number; y: number }> {
  return new Map(
    scene().nodes.map((item) => [item.node.id, { x: item.x, y: item.y }]),
  );
}

beforeEach(() => {
  installFakeCanvas(1200, 800);
  clock = 0;
});

afterEach(() => {
  engine?.destroy();
  document.body.replaceChildren();
});

describe("AC-1 — a root file is drawn like any other file", () => {
  it("puts every parent-less file in the scene at the default zoom", () => {
    settledEngine();
    const drawn = positions();
    for (const id of ROOT_FILES) {
      const at = drawn.get(id);
      expect(at, `${id} is missing from the scene`).toBeDefined();
      expect(Number.isFinite(at!.x) && Number.isFinite(at!.y)).toBe(true);
    }
  });

  it("sizes and colours it by the ordinary file rules", () => {
    settledEngine();
    const item = scene().nodes.find((n) => n.node.id === "test_proxy.py");
    expect(item).toBeDefined();
    const node = item!.node;
    expect(node.kind).toBe("file");
    expect(node.parent).toBeNull();
    // The same formula every other file gets, on its own LOC.
    expect(node.radius).toBeCloseTo(nodeRadius("file", 172), 6);
    expect(node.layer).toBe("test");
  });

  it("is reachable by hover, selection and the detail panel", () => {
    settledEngine();
    const at = positions().get("setup.py")!;
    const screen = toScreen(at, engine.getCamera(), {
      width: 1200,
      height: 800,
    });

    expect(engine.pick(screen)?.id).toBe("setup.py");
    engine.setHovered("setup.py");
    expect(engine.getHovered()?.id).toBe("setup.py");
    engine.setSelected("setup.py");
    expect(engine.getSelected()?.path).toBe("setup.py");
    // What the panel and the hover highlight read.
    expect(engine.getNode("setup.py")).not.toBeNull();
  });

  it("flies the camera to a root file the search found", async () => {
    settledEngine();
    await engine.flyTo("version.py", { durationMs: 0 });
    const at = positions().get("version.py")!;
    expect(engine.getCamera().x).toBeCloseTo(at.x, 6);
    expect(engine.getCamera().y).toBeCloseTo(at.y, 6);
    expect(engine.getSelected()?.id).toBe("version.py");
  });
});

describe("AC-2 — always visible, and the layout does not shift", () => {
  it("never unfolds and never collapses a root file", () => {
    settledEngine();
    engine.setCamera({ k: UNFOLD_ZOOM + 0.5 });
    run(30);
    for (const id of ROOT_FILES) {
      expect(engine.isUnfolded(id)).toBe(false);
      expect(engine.unfoldedModules()).not.toContain(id);
    }
  });

  it("keeps a root file on screen at every zoom level", () => {
    settledEngine();
    for (const k of [0.4, 1, UNFOLD_ZOOM - 0.1, UNFOLD_ZOOM + 0.1, 4]) {
      engine.setCamera({ k });
      run(5);
      const drawn = positions();
      for (const id of ROOT_FILES) {
        expect(drawn.has(id), `${id} vanished at ${k}x`).toBe(true);
      }
    }
  });

  it("holds root files still across an unfold and a collapse", () => {
    settledEngine();
    const before = positions();

    // Unfold `fp/` by zooming past the threshold on top of it, then collapse
    // it again by dropping back below — the full cycle AC-2 names.
    const module = before.get("fp/")!;
    engine.setCamera({ x: module.x, y: module.y, k: UNFOLD_ZOOM + 0.1 });
    run(120);
    expect(engine.isUnfolded("fp/")).toBe(true);

    let maxDisplacement = 0;
    const measure = (): void => {
      for (const [id, at] of positions()) {
        const start = before.get(id);
        if (!start) continue;
        maxDisplacement = Math.max(
          maxDisplacement,
          Math.hypot(at.x - start.x, at.y - start.y),
        );
      }
    };
    measure();

    engine.setCamera({ k: UNFOLD_ZOOM - 0.1 });
    run(20);
    expect(engine.unfoldedModules()).toEqual([]);
    measure();

    // The same bound `navigation.test.ts` holds the global layout to.
    expect(maxDisplacement).toBeLessThan(SETTLE_DISPLACEMENT_PX);
  });
});

describe("AC-3 — edges touching a root file render in both directions", () => {
  /** Edges in the scene, as unordered `a|b` keys. */
  function edgeKeys(): Set<string> {
    return new Set(
      scene()
        .edges.filter((edge) => !edge.member)
        .map((edge) => [edge.sourceId, edge.targetId].sort().join("|")),
    );
  }

  it("draws a root file's edges to other root files without any unfold", () => {
    settledEngine();
    // `setup.py → version.py`: both ends are top-level, so this edge is on the
    // map from the first settled frame.
    expect(edgeKeys()).toContain("setup.py|version.py");
  });

  it("draws both directions once the module at the far end is unfolded", () => {
    settledEngine();
    const module = positions().get("fp/")!;
    engine.setCamera({ x: module.x, y: module.y, k: UNFOLD_ZOOM + 0.1 });
    run(120);

    const keys = edgeKeys();
    // Root file → a module's file.
    expect(keys).toContain("fp/proxy.py|setup.py");
    expect(keys).toContain("fp/proxy.py|test_proxy.py");
    // A module's file → root file.
    expect(keys).toContain("fp/proxy.py|version.py");
  });

  it("lights a root file's chain on hover, in both directions", () => {
    settledEngine();
    const chain = new Set(engine.chainOf("version.py"));
    expect(chain).toContain("version.py");
    // `setup.py → version.py` and `fp/proxy.py → version.py`.
    expect(chain).toContain("setup.py");
    expect(chain).toContain("fp/proxy.py");
  });
});
