/**
 * Stats-bar formatting, kept apart from the DOM so the numbers are testable
 * without a document. Shapes follow the mockup's header: `41.2k loc`,
 * `1,847 commits`, `py 61% · ts 39%`.
 */

/** `41.2k`, `396.5k`, `1.2m` — the mockup's compact count. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** Thousands-separated, for counts the mockup writes out in full. */
export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** What a metric row prints when the document has nothing to print. */
export const EMPTY_METRIC = "—";

/** Whole percent, the shape the panel's churn row and bar both use. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Math.round(Math.min(1, value) * 100)}%`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** The mockup writes months and years, so the ladder needs both. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const LADDER: readonly { readonly ms: number; readonly unit: string }[] = [
  { ms: YEAR_MS, unit: "year" },
  { ms: MONTH_MS, unit: "month" },
  { ms: 7 * DAY_MS, unit: "week" },
  { ms: DAY_MS, unit: "day" },
  { ms: HOUR_MS, unit: "hour" },
  { ms: MINUTE_MS, unit: "minute" },
];

/**
 * `2 days ago`, `4 months ago` — the mockup's panel wording (AC-1).
 *
 * `now` is a parameter rather than a `Date.now()` call so the output is a
 * function of its inputs and the test does not need a fake clock. `viz` is
 * exempt from the analyzers' clock ban (that ban protects `analysis.json`'s
 * determinism), but a formatter that reads a clock is still untestable.
 *
 * A node with no history in the window has `lastChangedAt: null`; that is a
 * real state in the contract, not an error, and it prints as `—`.
 */
export function formatRelativeTime(
  iso: string | null,
  now: number = Date.now(),
): string {
  if (iso === null) return EMPTY_METRIC;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return EMPTY_METRIC;
  // A timestamp in the future is a clock skew between the machine that ran
  // the pipeline and the one reading the map, not a story about the repo.
  const elapsed = Math.max(0, now - then);
  for (const { ms, unit } of LADDER) {
    const count = Math.floor(elapsed / ms);
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

/**
 * `typescript 74% · python 26%` — shares descending, top `limit`.
 *
 * The mockup abbreviates ("py", "ts"), but those were hardcoded strings in a
 * mockup; the contract carries language names and no abbreviation table, and
 * inventing one in `viz` would be putting analyzer knowledge in the frontend
 * (AD-1). Names are printed as the document gives them.
 */
export function formatLanguages(
  languages: Readonly<Record<string, number>>,
  limit = 3,
): string {
  return Object.entries(languages)
    .filter(([, share]) => Number.isFinite(share) && share > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, share]) => `${name} ${Math.round(share * 100)}%`)
    .join(" · ");
}
