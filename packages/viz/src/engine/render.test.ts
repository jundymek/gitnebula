import { describe, expect, it } from "vitest";

import {
  EDGE_ALPHA_BASE,
  HOT_COLOR,
  HOT_PULSE_MS,
  HOT_THRESHOLD,
  LAYER_COLOR,
  NODE_ALPHA_DIMMED,
  STAR_COUNT,
  STAR_LARGE_RADIUS,
  STAR_SMALL_RADIUS,
  VOID_COLOR,
} from "./constants.js";
import { nodeRadius } from "./graph.js";
import { mulberry32 } from "./prng.js";
import {
  glowRadius,
  nodeColor,
  pulseFactor,
  renderFrame,
  type RenderScene,
} from "./render.js";
import { seedStars } from "./starfield.js";
import type { EngineNode } from "./types.js";
import { createFakeContext } from "../test-support/fake-canvas.js";

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

describe("encoding — UX-DR1 palette", () => {
  it("uses the mockup's hexes, unchanged", () => {
    expect(VOID_COLOR).toBe("#060911");
    expect(LAYER_COLOR.backend).toBe("#3fcfa0");
    expect(LAYER_COLOR.frontend).toBe("#9b8cff");
    expect(LAYER_COLOR.infra).toBe("#7c8598");
    expect(LAYER_COLOR.test).toBe("#a8cf52");
    expect(HOT_COLOR).toBe("#ff7a3d");
  });

  it("paints the void before anything else", () => {
    const fake = createFakeContext();
    renderFrame(fake.context, scene());
    expect(fake.fillStyles[0]).toBe(VOID_COLOR);
    expect(fake.calls[1]).toMatchObject({ op: "fillRect" });
  });
});

describe("encoding — UX-DR2 hot spots replace the layer colour", () => {
  it("colours a cold node by its layer", () => {
    expect(nodeColor(node({ churn: 0.49, hot: false }), "structure")).toBe(
      LAYER_COLOR.backend,
    );
  });

  it("colours a hot node --hot instead of its layer, not as well as", () => {
    const hot = node({ churn: HOT_THRESHOLD, hot: true });
    const color = nodeColor(hot, "structure");
    expect(color).toBe(HOT_COLOR);
    expect(color).not.toBe(LAYER_COLOR.backend);
  });

  it("has a default threshold of 0.5", () => {
    expect(HOT_THRESHOLD).toBe(0.5);
  });

  it("ramps cold→hot in heat mode (story 3.4's toggle reaches this)", () => {
    const cold = nodeColor(node({ churn: 0 }), "heat");
    const warm = nodeColor(node({ churn: 0.7 }), "heat");
    expect(cold).toBe("rgb(58,111,216)");
    expect(warm).toBe("rgb(255,122,61)");
  });
});

describe("encoding — UX-DR4 radius, glow and pulse", () => {
  it("scales radius with √LOC", () => {
    const small = nodeRadius("module", 100);
    const large = nodeRadius("module", 400);
    // Quadrupling LOC doubles the √LOC term, so the difference doubles too.
    expect(large - 7).toBeCloseTo(2 * (small - 7), 10);
    expect(nodeRadius("module", 6140)).toBeCloseTo(
      7 + Math.sqrt(6140) / 11,
      10,
    );
    expect(nodeRadius("file", 73)).toBeCloseTo(1.5 + Math.sqrt(73) / 11, 10);
  });

  it("grows the glow with churn", () => {
    const quiet = glowRadius(node({ churn: 0.05 }), 10, 1);
    const busy = glowRadius(node({ churn: 0.45 }), 10, 1);
    expect(busy).toBeGreaterThan(quiet);
  });

  it("pulses hot nodes on a ~380 ms sine and holds still for reduced motion", () => {
    expect(HOT_PULSE_MS).toBe(380);
    const peak = pulseFactor((Math.PI / 2) * HOT_PULSE_MS, false);
    const trough = pulseFactor((-Math.PI / 2) * HOT_PULSE_MS, false);
    expect(peak).toBeCloseTo(1, 10);
    expect(trough).toBeCloseTo(0.24, 10);
    expect(pulseFactor(1234, true)).toBe(1);
  });

  it("only lets the pulse touch hot nodes", () => {
    const cold = node({ churn: 0.4, hot: false });
    expect(glowRadius(cold, 10, 0.24)).toBe(glowRadius(cold, 10, 1));
    const hot = node({ churn: 0.9, hot: true });
    expect(glowRadius(hot, 10, 0.24)).toBeLessThan(glowRadius(hot, 10, 1));
  });

  it("draws the glow as a radial gradient that fades to nothing", () => {
    const fake = createFakeContext();
    renderFrame(fake.context, scene());
    const stops = fake.gradients[0]!;
    expect(stops[0]).toEqual({ offset: 0, color: LAYER_COLOR.backend });
    expect(stops[stops.length - 1]).toEqual({
      offset: 1,
      color: "rgba(0,0,0,0)",
    });
  });

  it("labels modules above the node", () => {
    const fake = createFakeContext();
    renderFrame(fake.context, scene());
    const label = fake.calls.find((call) => call.op === "fillText");
    expect(label?.args[0]).toBe("core/");
    // y is the node centre minus radius minus the mockup's 8 px offset.
    expect(label?.args[2]).toBeCloseTo(300 - nodeRadius("module", 6140) - 8, 6);
  });
});

describe("encoding — UX-DR3 starfield", () => {
  it("seeds ~220 stars in exactly two dot sizes", () => {
    const stars = seedStars(mulberry32(7));
    expect(stars).toHaveLength(STAR_COUNT);
    expect(STAR_COUNT).toBe(220);
    const sizes = new Set(stars.map((star) => star.radius));
    expect([...sizes].sort()).toEqual([STAR_SMALL_RADIUS, STAR_LARGE_RADIUS]);
    for (const star of stars) {
      expect(star.alpha).toBeGreaterThanOrEqual(0.03);
      expect(star.alpha).toBeLessThanOrEqual(0.15);
    }
  });

  it("gives the same seed the same sky", () => {
    expect(seedStars(mulberry32(11))).toEqual(seedStars(mulberry32(11)));
    expect(seedStars(mulberry32(11))).not.toEqual(seedStars(mulberry32(12)));
  });
});

describe("encoding — UX-DR5 edges", () => {
  it("draws import edges as translucent quadratic curves", () => {
    const fake = createFakeContext();
    renderFrame(
      fake.context,
      scene({
        edges: [
          {
            sourceId: "a",
            targetId: "b",
            sx: -100,
            sy: 0,
            tx: 100,
            ty: 0,
            member: false,
          },
        ],
      }),
    );
    expect(fake.strokeStyles[0]).toBe(`rgba(150,170,215,${EDGE_ALPHA_BASE})`);
    const curve = fake.calls.find((call) => call.op === "quadraticCurveTo");
    expect(curve).toBeDefined();
    // The control point sits off the chord — that is what makes it a curve.
    expect(curve?.args[1]).not.toBe(300);
  });

  it("dims everything outside a focused chain", () => {
    const fake = createFakeContext();
    renderFrame(fake.context, scene({ chain: new Set(["somewhere-else"]) }));
    expect(fake.context.globalAlpha).toBe(1);
    const dimmed = fake.calls.filter((call) => call.op === "set:fillStyle");
    expect(dimmed.length).toBeGreaterThan(0);
    expect(NODE_ALPHA_DIMMED).toBe(0.1);
  });
});
