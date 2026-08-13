/**
 * The one source of randomness in the Viewer (AD-6).
 *
 * Everything the layout does with chance — initial scatter, starfield, and
 * d3-force's own jiggle — draws from a PRNG seeded by `hash(repo.name)`, so
 * the same `analysis.json` always settles into the same map and a README
 * screenshot diff means something.
 *
 * mulberry32 over FNV-1a: small, fast, and identical on every platform
 * because both are integer-only. Story 1.4's spike used the same pair; this
 * is the shipping copy of it.
 */

export type Rng = () => number;

/** FNV-1a, 32-bit. Stable across engines — no float maths anywhere in it. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The AD-6 seed: `hash(repo.name)`. */
export function seedFor(repoName: string): number {
  return hashString(repoName);
}

/** Convenience: a fresh stream for a repository name. */
export function seededRng(repoName: string): Rng {
  return mulberry32(seedFor(repoName));
}
