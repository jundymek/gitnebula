// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Nebula3DEngine } from "./engine3d.js";
import { UNFOLD_ZOOM } from "./constants.js";
import { placeNodes } from "./render3d.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

/**
 * `fit` must not choose a frame that destroys what it framed.
 *
 * Unfolded members widen the frame; a wider frame zooms out; zooming out below
 * `UNFOLD_ZOOM` collapses the members that widened it. Framing them anyway
 * leaves the map sized for nodes that no longer exist — a small cloud adrift
 * in an empty canvas, which is the symptom this story was reopened for.
 */

let engine: Nebula3DEngine | null = null;

beforeEach(() => {
  installFakeCanvas(1440, 900);
});
afterEach(() => {
  engine?.destroy();
  engine = null;
  document.body.replaceChildren();
});

function build(): Nebula3DEngine {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const created = new Nebula3DEngine({ canvas, reducedMotion: true });
  created.load(loadSyntheticFixture());
  for (let i = 0; i < 5; i++) created.frame(i * 16);
  return created;
}

/** Share of the frame the drawn map actually occupies, per axis. */
function fill(target: Nebula3DEngine): { w: number; h: number } {
  const scene = target.buildScene(0)!;
  const placed = placeNodes(scene);
  const xs = placed.map((p) => p.sx);
  const ys = placed.map((p) => p.sy);
  return {
    w: (Math.max(...xs) - Math.min(...xs)) / scene.viewport.width,
    h: (Math.max(...ys) - Math.min(...ys)) / scene.viewport.height,
  };
}

describe("fit is self-consistent with what its camera keeps", () => {
  it("still fills the frame when fitting from an unfolded camera", () => {
    engine = build();
    engine.setCamera({ k: 4 });
    expect(engine.unfoldedModules().length).toBeGreaterThan(0);

    void engine.fit({ durationMs: 0 });
    const after = fill(engine);
    // The failure this guards is a map shrunk to a corner, so the assertion is
    // about occupying the frame rather than about the exact zoom.
    expect(after.w).toBeGreaterThan(0.5);
    expect(after.h).toBeGreaterThan(0.5);
  });

  it("frames nodes that survive the camera it chose", () => {
    engine = build();
    engine.setCamera({ k: 4 });
    void engine.fit({ durationMs: 0 });

    const k = engine.getCamera().k;
    const unfolded = engine.unfoldedModules().length;
    // Either the chosen camera keeps the wakes, or it collapsed them and was
    // therefore not sized for them. Both are consistent; only framing wakes
    // and then dropping below the threshold is not.
    if (k < UNFOLD_ZOOM) {
      expect(unfolded).toBe(0);
    } else {
      expect(unfolded).toBeGreaterThan(0);
    }
  });

  it("fits the folded map without member wakes inflating it", () => {
    engine = build();
    // Fold it first: the post-load fit already lands above UNFOLD_ZOOM on this
    // fixture, so "folded" has to be asked for rather than assumed.
    engine.setCamera({ k: 1 });
    expect(engine.unfoldedModules()).toEqual([]);
    void engine.fit({ durationMs: 0 });
    const after = fill(engine);
    expect(after.w).toBeGreaterThan(0.4);
    expect(after.h).toBeGreaterThan(0.4);
  });
});
