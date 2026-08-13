/**
 * The starfield behind the nebula (UX-DR3): ~220 faint stars in two dot
 * sizes.
 *
 * Positions are normalized to [0, 1) of the viewport and drawn in screen
 * space — stars are backdrop, not part of the world, so they do not pan or
 * zoom (mockup behaviour). Normalized coordinates also mean a window resize
 * re-maps the same stars instead of re-rolling them, which is what keeps the
 * backdrop stable under AD-6 when the mockup's `Math.random()` would not.
 */

import {
  STAR_COUNT,
  STAR_LARGE_RADIUS,
  STAR_SMALL_RADIUS,
  STAR_SMALL_SHARE,
} from "./constants.js";
import type { Rng } from "./prng.js";

export interface Star {
  /** Normalized viewport coordinates, in [0, 1). */
  readonly x: number;
  readonly y: number;
  /** Alpha, 0.03–0.15 (mockup). */
  readonly alpha: number;
  /** Dot size in CSS px — one of two values. */
  readonly radius: number;
}

export function seedStars(rng: Rng, count: number = STAR_COUNT): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng(),
      y: rng(),
      alpha: 0.03 + rng() * 0.12,
      radius: rng() < STAR_SMALL_SHARE ? STAR_SMALL_RADIUS : STAR_LARGE_RADIUS,
    });
  }
  return stars;
}
