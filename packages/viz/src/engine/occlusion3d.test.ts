// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { Nebula3DEngine } from "./engine3d.js";
import { CanvasGraphEngine } from "./engine.js";
import { placeNodes } from "./render3d.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

/**
 * AC-8's missing number.
 *
 * AC-8 asked whether depth separates clusters that overlap in the plane, and
 * it was the only criterion in story 5.7 with no measurement behind it. It is
 * also the one that failed: the maintainer ran the 3D view and reported a
 * dense blur where everything blended together. The cause turned out to be a
 * numerical divergence in `MemberLayout3D` rather than a matter of taste —
 * which a number would have caught and an adjective did not.
 *
 * So the number lives here now. **Occlusion**: the share of drawn node discs
 * whose projected area is more than half covered by a nearer disc. Sampled at
 * 96 points per disc, farthest-first, which is the order the renderer paints
 * in and therefore the order in which "nearer" means "on top".
 *
 * Two cautions, both learned by getting them wrong first:
 *
 * - **The scene must be pinned.** Comparing configurations is meaningless if
 *   the layout size changes what `fit` frames and therefore how many modules
 *   unfold — a run measuring 367 nodes is not a run measuring 262. The camera,
 *   the document and the scope are all fixed below.
 * - **The threshold records what the code does, with headroom.** It is not an
 *   aspiration, and it is not the measurement sitting on its own value.
 */

interface Disc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** Fraction of `disc` hidden by discs drawn after it. */
function coveredFraction(disc: Disc, nearer: readonly Disc[]): number {
  const SAMPLES = 96;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  let hidden = 0;
  for (let i = 0; i < SAMPLES; i++) {
    // Sunflower sampling: uniform over the disc and deterministic, so the
    // measurement is reproducible (AD-6 applies to the yardstick too).
    const radius = disc.r * Math.sqrt((i + 0.5) / SAMPLES);
    const angle = i * GOLDEN_ANGLE;
    const px = disc.x + radius * Math.cos(angle);
    const py = disc.y + radius * Math.sin(angle);
    for (const other of nearer) {
      const dx = px - other.x;
      const dy = py - other.y;
      if (dx * dx + dy * dy <= other.r * other.r) {
        hidden++;
        break;
      }
    }
  }
  return hidden / SAMPLES;
}

/** Percentage of discs more than half hidden. `discs` arrives farthest-first. */
export function buriedPercent(discs: readonly Disc[]): number {
  if (discs.length === 0) return 0;
  let buried = 0;
  for (let i = 0; i < discs.length; i++) {
    const subject = discs[i]!;
    const nearer: Disc[] = [];
    for (let j = i + 1; j < discs.length; j++) {
      const other = discs[j]!;
      const gap = Math.hypot(other.x - subject.x, other.y - subject.y);
      if (gap < other.r + subject.r) nearer.push(other);
    }
    if (coveredFraction(subject, nearer) > 0.5) buried++;
  }
  return (buried / discs.length) * 100;
}

describe("occlusion (AC-8's measurement)", () => {
  beforeEach(() => {
    installFakeCanvas(1440, 900);
  });

  it("the sampler agrees with cases whose answer is known", () => {
    // A yardstick nobody checked is not a yardstick.
    expect(buriedPercent([])).toBe(0);
    // One disc alone can hide nothing.
    expect(buriedPercent([{ x: 0, y: 0, r: 10 }])).toBe(0);
    // Two far apart hide nothing.
    expect(
      buriedPercent([
        { x: 0, y: 0, r: 5 },
        { x: 500, y: 0, r: 5 },
      ]),
    ).toBe(0);
    // A small disc directly behind a large one is fully buried; the large one
    // in front is not. One of two is 50%.
    expect(
      buriedPercent([
        { x: 0, y: 0, r: 4 },
        { x: 0, y: 0, r: 40 },
      ]),
    ).toBe(50);
  });

  it("keeps a scoped module's files legible in 3D", () => {
    // The scene is pinned: one document, one scope, `fit` as the camera.
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const engine = new Nebula3DEngine({ canvas, reducedMotion: true });
    const document_ = loadSyntheticFixture();
    engine.load(document_);
    const moduleId = engine.nodes.find((n) => n.kind === "module")!.id;
    engine.setScope(moduleId);
    void engine.fit({ durationMs: 0 });

    const scene = engine.buildScene(0)!;
    const placed = placeNodes(scene);
    // Every node the scene carries reaches the frame. Before the layout was
    // stabilised this was 60 of 254 on the maintainer's repository, because
    // the rest had diverged to ~1e13 world units.
    expect(placed.length).toBe(scene.nodes.length);
    for (const node of scene.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.z)).toBe(true);
    }

    const buried = buriedPercent(
      placed.map((p) => ({ x: p.sx, y: p.sy, r: p.screenR })),
    );
    // Records the behaviour with headroom, not an aspiration. 3D cannot reach
    // the 2D view's 0% — 2D collides in the projection plane, so its
    // separation is exactly what the eye sees, while a projected volume can
    // always stack two nodes that share a line of sight. See
    // docs/dev/epic-5/5.7-viz-3d-view/PERFORMANCE.md for the measured series.
    expect(buried).toBeLessThan(45);
    engine.destroy();
  });

  it("the 2D view stays free of overlap, which is why it is the default", () => {
    // The control. If this ever regresses, the comparison above loses its
    // meaning — and 2D being the readable one is the reason it is the default.
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const engine = new CanvasGraphEngine({ canvas, reducedMotion: true });
    const document_ = loadSyntheticFixture();
    engine.load(document_);
    const moduleId = engine.nodes.find((n) => n.kind === "module")!.id;
    engine.setScope(moduleId);
    void engine.fit({ durationMs: 0 });

    const scene = engine.buildScene(0)!;
    const buried = buriedPercent(
      scene.nodes.map((item) => ({
        x: (item.x - scene.camera.x) * scene.camera.k + 720,
        y: (item.y - scene.camera.y) * scene.camera.k + 450,
        r: item.node.radius * scene.camera.k,
      })),
    );
    expect(buried).toBeLessThan(5);
    engine.destroy();
  });
});
