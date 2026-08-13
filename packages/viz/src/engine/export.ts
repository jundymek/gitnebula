/**
 * PNG export (FR-22, AD-5).
 *
 * AD-5 is explicit that export **re-renders through the engine** and never
 * scales a canvas snapshot. That distinction is the whole module: taking the
 * on-screen bitmap and enlarging it would interpolate pixels that were
 * rasterised for a smaller surface, so every glow gradient, curve and label
 * would come out soft. Here the *scene* — the same object the live frame is
 * drawn from — is handed to the same `renderFrame`, against a context whose
 * transform is `scale`× larger. Text and vectors are therefore rasterised at
 * the export's own resolution, and the image is sharp because it was never a
 * smaller image.
 *
 * It also means state parity is structural rather than copied: camera, view
 * mode, hover/isolate chain, selection and label visibility live in the scene,
 * so an export cannot drift from the screen without the screen drifting too.
 */

import { renderFrame, type RenderScene } from "./render.js";

/**
 * AD-5's floor. Not a default that callers may lower — a scale below 2 is the
 * thing the ADR forbids, so it is rejected rather than clamped: a silently
 * clamped 1× would produce a file that claims to satisfy FR-22 and does not.
 */
export const MIN_EXPORT_SCALE = 2;

/** What `exportPNG()` uses when the caller says nothing. */
export const DEFAULT_EXPORT_SCALE = 2;

/**
 * A drawing surface that can hand back a PNG. Abstracted because the browser
 * offers two (`OffscreenCanvas` and a detached `<canvas>`) and jsdom offers
 * neither — the unit tests inject a recording surface and assert on the calls
 * the renderer made, which is how the rest of `viz` tests its rendering.
 */
export interface ExportSurface {
  readonly ctx: CanvasRenderingContext2D;
  toBlob(): Promise<Blob>;
}

export type ExportSurfaceFactory = (
  widthPx: number,
  heightPx: number,
) => ExportSurface;

export interface RenderSceneToPngOptions {
  /** Density multiplier over the scene's CSS pixel size. Must be ≥ 2. */
  readonly scale?: number;
  /** Injection point for tests; the browser path is the default. */
  readonly createSurface?: ExportSurfaceFactory;
}

/**
 * `OffscreenCanvas` where it exists, a detached `<canvas>` otherwise.
 *
 * The offscreen path is preferred because it never enters the document, so a
 * 2× or 4× surface cannot flash on screen or affect layout. The fallback
 * exists for browsers without it; both encode the same PNG.
 */
export function createExportSurface(
  widthPx: number,
  heightPx: number,
): ExportSurface {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(widthPx, heightPx);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      return {
        ctx: ctx as unknown as CanvasRenderingContext2D,
        toBlob: () => canvas.convertToBlob({ type: "image/png" }),
      };
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("viz: export target has no 2D context");
  }
  return {
    ctx,
    toBlob: () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("viz: canvas produced no PNG blob"));
        }, "image/png");
      }),
  };
}

/**
 * Draw `scene` into a fresh surface at `scale`× its CSS size and encode a PNG.
 *
 * The scene's viewport stays in CSS pixels and the density lives entirely in
 * the context transform — exactly as `CanvasGraphEngine.resize()` handles the
 * device pixel ratio on screen. Doing it the other way round (multiplying the
 * viewport) would enlarge the visible world area instead of the resolution,
 * and the export would show more of the map than the screen does.
 */
export async function renderSceneToPng(
  scene: RenderScene,
  options: RenderSceneToPngOptions = {},
): Promise<Blob> {
  const scale = options.scale ?? DEFAULT_EXPORT_SCALE;
  if (!Number.isFinite(scale) || scale < MIN_EXPORT_SCALE) {
    throw new Error(
      `viz: export scale must be >= ${MIN_EXPORT_SCALE} (AD-5), got ${scale}`,
    );
  }

  const { width, height } = scene.viewport;
  if (!(width > 0) || !(height > 0)) {
    throw new Error(
      `viz: cannot export a ${width} x ${height} viewport — the canvas has no size yet`,
    );
  }

  const surface = (options.createSurface ?? createExportSurface)(
    Math.round(width * scale),
    Math.round(height * scale),
  );
  surface.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderFrame(surface.ctx, scene);
  return surface.toBlob();
}
