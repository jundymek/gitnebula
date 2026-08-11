// Co-change pair extraction under ADR-0005's bounds.

import type { CochangePair } from "@gitnebula/contract";

/** Pairs below this many shared commits are dropped (ADR-0005). */
export const MIN_COCHANGE_COUNT = 3;

/** At most this many pairs survive per kind (ADR-0005). */
export const MAX_COCHANGE_PAIRS_PER_KIND = 500;

/**
 * A commit touching more files than this is bulk-change noise — a dependency
 * bump, a reformat, a vendored drop — and is skipped for co-change (AC-3). It
 * still counts towards every node's `commits`; only its pairs are discarded.
 */
export const BULK_COMMIT_FILE_LIMIT = 50;

const PAIR_SEP = "\0";

/** Counts unordered same-kind pairs across commits. */
export class CochangeAccumulator {
  readonly #counts = new Map<string, number>();

  /** Records every unordered pair among the ids one commit touched. */
  add(ids: readonly string[]): void {
    if (ids.length < 2) return;
    // Sorting here is what makes the pair unordered: `a` is always the
    // lexicographically smaller id, so (x,y) and (y,x) share one key.
    const sorted = [...new Set(ids)].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = `${sorted[i]}${PAIR_SEP}${sorted[j]}`;
        this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
      }
    }
  }

  /** Pairs meeting the count threshold, stably sorted, capped per kind. */
  bounded(): CochangePair[] {
    const pairs: CochangePair[] = [];
    for (const [key, count] of this.#counts) {
      if (count < MIN_COCHANGE_COUNT) continue;
      const [a = "", b = ""] = key.split(PAIR_SEP);
      pairs.push({ a, b, count });
    }
    // Sorted before slicing: the cap must keep the strongest pairs, and the
    // tie-break on ids makes which-500 deterministic across runs (AD-4).
    return sortCochanges(pairs).slice(0, MAX_COCHANGE_PAIRS_PER_KIND);
  }
}

/** ADR-0005's order: count descending, then `a`, then `b`. */
export function sortCochanges(pairs: readonly CochangePair[]): CochangePair[] {
  return [...pairs].sort(
    (x, y) => y.count - x.count || compare(x.a, y.a) || compare(x.b, y.b),
  );
}

// Explicit code-unit comparison: the default sort comparator stringifies, and
// locale-aware collation would make the order depend on the machine.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
