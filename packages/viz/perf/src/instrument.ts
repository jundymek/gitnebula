/**
 * Proof that the harness measured the map and not an idle animation loop.
 *
 * Story 1.4's hardest-won lesson was that a perf run can look completely
 * normal while measuring nothing: it panned around the origin while the layout
 * had settled a thousand units away and reported a healthy frame rate for an
 * empty screen. This harness has a new version of the same hazard — it counts
 * `requestAnimationFrame` callbacks, which keep arriving whether or not the
 * engine draws anything into them. A frozen or crashed renderer would still
 * report 60+ fps.
 *
 * So the run counts *renders*, not just frames. `installRenderCounter` is
 * injected before any page script runs and wraps `getContext("2d")` so that
 * every full-viewport background fill — the renderer's first call of each
 * frame, once per frame and never otherwise — increments a counter. The spec
 * then asserts there was roughly one render per measured frame.
 *
 * Both functions are serialised into the browser by Playwright, so they must
 * be self-contained: no imports, no module-scope references.
 */

/** Where the counter lives on `window`. */
export const RENDER_COUNT_KEY = "__gitnebulaRenderCount";

/**
 * Anything wider than this in a `fillRect` is the void background, not a star
 * (stars are ~0.6-1.1 px). Deliberately far from both.
 */
const BACKGROUND_MIN_WIDTH = 100;

export function installRenderCounter(): void {
  const key = "__gitnebulaRenderCount";
  const minWidth = 100;
  const target = globalThis as unknown as Record<string, number>;
  target[key] = 0;

  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    ...args: unknown[]
  ) {
    const context = (
      original as unknown as (
        this: HTMLCanvasElement,
        ...a: unknown[]
      ) => unknown
    ).apply(this, args);
    if (args[0] !== "2d" || context === null || context === undefined) {
      return context;
    }
    const ctx = context as CanvasRenderingContext2D;
    const fillRect = ctx.fillRect.bind(ctx);
    ctx.fillRect = (x: number, y: number, w: number, h: number): void => {
      if (w >= minWidth) target[key] = (target[key] ?? 0) + 1;
      fillRect(x, y, w, h);
    };
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

/** Reads and resets the counter; returns what it held. */
export function takeRenderCount(): number {
  const key = "__gitnebulaRenderCount";
  const target = globalThis as unknown as Record<string, number>;
  const value = target[key] ?? 0;
  target[key] = 0;
  return value;
}

export { BACKGROUND_MIN_WIDTH };
