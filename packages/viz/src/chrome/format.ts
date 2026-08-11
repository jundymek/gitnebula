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
