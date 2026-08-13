/**
 * Fuzzy subsequence matching for the search box (FR-18).
 *
 * Written here rather than pulled from npm. The spec allows adopting a
 * micro-dependency "only if quality demands"; it does not, and the reasons are
 * concrete: the corpus is node ids, which are paths, so the ranking that
 * matters is path-shaped (segment boundaries, basenames, prefixes) rather than
 * the generic camelCase-and-acronym heuristics a general library optimises for.
 * A library would also arrive with its own tie-breaking, which is the part
 * FR-18's "top 7" makes visible. Sixty lines of scoring we own beats a
 * dependency we would have to fight — recorded in DECISIONS.md.
 *
 * Pure and DOM-free: `chrome/search.ts` owns the UI, this owns the ordering.
 */

/** A match: the candidate, its score, and which characters matched. */
export interface FuzzyMatch<T> {
  readonly item: T;
  readonly score: number;
  /** Indices into the haystack that the query matched, for highlighting. */
  readonly positions: readonly number[];
}

/** Scoring weights. Higher is better; the sum is the score. */
const SCORE_BASE = 1;
/** A match immediately after the previous one — the strongest signal. */
const SCORE_CONSECUTIVE = 8;
/** A match at the start of a path segment, a word, or the string. */
const SCORE_BOUNDARY = 6;
/** The whole query appears verbatim. */
const SCORE_SUBSTRING = 12;
/** The haystack starts with the query. */
const SCORE_PREFIX = 10;
/** Every unmatched leading character costs a little. */
const PENALTY_LEADING = 0.4;
/** Longer haystacks lose to shorter ones, all else equal. */
const PENALTY_LENGTH = 0.06;

function isBoundary(haystack: string, index: number): boolean {
  if (index === 0) return true;
  const previous = haystack[index - 1]!;
  return (
    previous === "/" ||
    previous === "." ||
    previous === "-" ||
    previous === "_" ||
    previous === " "
  );
}

/**
 * Score one candidate. Returns `null` when the query is not a subsequence of
 * the haystack at all — the hard filter FR-18's "fuzzy subsequence match" asks
 * for, applied before any of the ranking niceties.
 *
 * The walk is greedy left-to-right, which can miss the theoretically best
 * alignment (`ab` against `a-ab` takes the first `a`). Backtracking to find the
 * optimum costs exponential time for a ranking difference no user perceives at
 * seven results, so the boundary and consecutive bonuses do that work instead.
 */
export function scoreMatch(
  haystack: string,
  query: string,
): { score: number; positions: number[] } | null {
  if (query.length === 0) return { score: 0, positions: [] };

  const lowerHaystack = haystack.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const positions: number[] = [];
  let cursor = 0;
  for (const character of lowerQuery) {
    const found = lowerHaystack.indexOf(character, cursor);
    if (found === -1) return null;
    positions.push(found);
    cursor = found + 1;
  }

  let score = 0;
  let previous = -2;
  for (const position of positions) {
    score += SCORE_BASE;
    if (position === previous + 1) score += SCORE_CONSECUTIVE;
    if (isBoundary(lowerHaystack, position)) score += SCORE_BOUNDARY;
    previous = position;
  }

  if (lowerHaystack.includes(lowerQuery)) score += SCORE_SUBSTRING;
  if (lowerHaystack.startsWith(lowerQuery)) score += SCORE_PREFIX;

  score -= (positions[0] ?? 0) * PENALTY_LEADING;
  score -= haystack.length * PENALTY_LENGTH;

  return { score, positions };
}

/**
 * Rank `items` against `query`, best first, capped at `limit`.
 *
 * Ties break on the key, alphabetically, so the list is a deterministic
 * function of the query — AD-6's determinism promise reaches the search box as
 * much as the layout, and a list that reshuffles between identical keystrokes
 * is a list you cannot arrow through.
 */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  keyOf: (item: T) => string,
  limit: number,
): FuzzyMatch<T>[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const matches: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const scored = scoreMatch(keyOf(item), trimmed);
    if (scored === null) continue;
    matches.push({
      item,
      score: scored.score,
      positions: scored.positions,
    });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return keyOf(a.item).localeCompare(keyOf(b.item));
  });

  return matches.slice(0, limit);
}
