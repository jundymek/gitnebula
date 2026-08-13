import { describe, expect, it, vi } from "vitest";

import { createFakeContext } from "../test-support/fake-canvas.js";
import { VOID_COLOR } from "./constants.js";
import {
  DEFAULT_EXPORT_SCALE,
  MIN_EXPORT_SCALE,
  renderSceneToPng,
  type ExportSurface,
} from "./export.js";
import type { RenderScene } from "./render.js";
import type { EngineNode } from "./types.js";

function node(id: string, overrides: Partial<EngineNode> = {}): EngineNode {
  return {
    id,
    kind: "module",
    parent: null,
    path: id,
    layer: "backend",
    loc: 100,
    churn: 0.2,
    commits: 4,
    authors: 2,
    lastChangedAt: null,
    description: null,
    hot: false,
    radius: 10,
    ...overrides,
  };
}

function scene(overrides: Partial<RenderScene> = {}): RenderScene {
  return {
    viewport: { width: 800, height: 600 },
    camera: { x: 0, y: 0, k: 1 },
    stars: [],
    nodes: [{ node: node("a"), x: 0, y: 0 }],
    edges: [],
    mode: "structure",
    timeMs: 1000,
    reducedMotion: false,
    chain: null,
    selectedId: null,
    showFileLabels: false,
    ...overrides,
  };
}

/** A surface backed by the recording context the renderer tests already use. */
function recordingSurface(): {
  factory: (w: number, h: number) => ExportSurface;
  sizes: { width: number; height: number }[];
  fake: ReturnType<typeof createFakeContext>;
} {
  const fake = createFakeContext();
  const sizes: { width: number; height: number }[] = [];
  return {
    fake,
    sizes,
    factory: (width, height) => {
      sizes.push({ width, height });
      return {
        ctx: fake.context,
        toBlob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
      };
    },
  };
}

describe("renderSceneToPng — AD-5: re-render, never a scaled snapshot", () => {
  it("allocates a surface at scale x the scene's CSS size", async () => {
    const surface = recordingSurface();
    await renderSceneToPng(scene(), {
      scale: 3,
      createSurface: surface.factory,
    });
    expect(surface.sizes).toEqual([{ width: 2400, height: 1800 }]);
  });

  it("defaults to 2x, the AD-5 floor", async () => {
    const surface = recordingSurface();
    await renderSceneToPng(scene(), { createSurface: surface.factory });
    expect(DEFAULT_EXPORT_SCALE).toBe(MIN_EXPORT_SCALE);
    expect(surface.sizes).toEqual([{ width: 1600, height: 1200 }]);
  });

  it("puts the density in the context transform, not in the viewport", async () => {
    // This is the difference between "more pixels for the same view" and "more
    // of the map". A scene scaled by widening the viewport would draw a larger
    // world area at the same density and still produce a bigger file.
    const surface = recordingSurface();
    await renderSceneToPng(scene(), {
      scale: 2,
      createSurface: surface.factory,
    });
    const transform = surface.fake.calls.find((c) => c.op === "setTransform");
    expect(transform?.args).toEqual([2, 0, 0, 2, 0, 0]);
    // The background still covers exactly the CSS-pixel viewport, because the
    // transform is what turns those into device pixels.
    const fillRect = surface.fake.calls.find((c) => c.op === "fillRect");
    expect(fillRect?.args).toEqual([0, 0, 800, 600]);
  });

  it("draws through the same renderFrame path as the screen", async () => {
    const surface = recordingSurface();
    await renderSceneToPng(scene(), { createSurface: surface.factory });
    // The void fill, the node body and its glow gradient are the renderer's
    // own encoding — their presence is what shows this is a re-render and not
    // an image copy.
    expect(surface.fake.fillStyles).toContain(VOID_COLOR);
    expect(surface.fake.gradients.length).toBe(1);
    expect(surface.fake.calls.filter((c) => c.op === "arc").length).toBe(2);
  });

  it("reproduces mode, highlight chain and label visibility from the scene", async () => {
    const surface = recordingSurface();
    await renderSceneToPng(
      scene({
        mode: "heat",
        chain: new Set(["a"]),
        nodes: [
          { node: node("a"), x: 0, y: 0 },
          { node: node("b", { kind: "file", path: "b/x.ts" }), x: 20, y: 0 },
        ],
        showFileLabels: true,
      }),
      { createSurface: surface.factory },
    );
    // Heat mode replaces the layer colour with the churn ramp...
    expect(surface.fake.fillStyles).not.toContain("#3fcfa0");
    // ...the node outside the chain is dimmed rather than dropped...
    const dimmed = surface.fake.calls.filter(
      (c) => c.op === "arc" && (c.args[0] as number) > 0,
    );
    expect(dimmed.length).toBeGreaterThan(0);
    // ...and file labels are drawn because the scene said they are visible.
    expect(surface.fake.calls.some((c) => c.op === "fillText")).toBe(true);
  });

  it("rejects a scale below the AD-5 floor instead of clamping it", async () => {
    const surface = recordingSurface();
    await expect(
      renderSceneToPng(scene(), { scale: 1, createSurface: surface.factory }),
    ).rejects.toThrow(/must be >= 2/);
    // Nothing was allocated and nothing was drawn: a clamped export would have
    // produced a file that looks like a successful FR-22 export and is not.
    expect(surface.sizes).toEqual([]);
  });

  it("rejects a non-finite scale", async () => {
    await expect(
      renderSceneToPng(scene(), { scale: Number.NaN }),
    ).rejects.toThrow(/must be >= 2/);
  });

  it("rejects a zero-sized viewport rather than encoding an empty image", async () => {
    const surface = recordingSurface();
    await expect(
      renderSceneToPng(scene({ viewport: { width: 0, height: 600 } }), {
        createSurface: surface.factory,
      }),
    ).rejects.toThrow(/no size yet/);
  });

  it("returns the surface's PNG blob", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const result = await renderSceneToPng(scene(), {
      createSurface: () => ({
        ctx: createFakeContext().context,
        toBlob: () => Promise.resolve(blob),
      }),
    });
    expect(result).toBe(blob);
  });

  it("propagates an encoder failure instead of resolving with nothing", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("encoder said no")));
    await expect(
      renderSceneToPng(scene(), {
        createSurface: () => ({
          ctx: createFakeContext().context,
          toBlob: failing,
        }),
      }),
    ).rejects.toThrow("encoder said no");
  });
});
