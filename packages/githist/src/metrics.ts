// Per-node activity and its normalization into churn (ADR-0003).

import type { NodeHistory } from "@gitnebula/contract";

/** Activity accumulated for one node while walking the window's commits. */
export interface NodeActivity {
  commits: number;
  readonly authors: Set<string>;
  /** Newest committer instant seen, unix seconds, or null when untouched. */
  lastChangedAt: number | null;
}

/** Churn is reported at this precision — see DECISIONS D6. */
const CHURN_DECIMALS = 3;
const CHURN_EPSILON = 10 ** -CHURN_DECIMALS;

export function emptyActivity(): NodeActivity {
  return { commits: 0, authors: new Set(), lastChangedAt: null };
}

/** Attributes one commit to one node. Idempotent per (node, commit) by design
 *  of the caller, which deduplicates a commit's paths first. */
export function recordCommit(
  activity: NodeActivity,
  committedAt: number,
  authorEmail: string,
): void {
  activity.commits += 1;
  activity.authors.add(authorEmail);
  if (activity.lastChangedAt === null || committedAt > activity.lastChangedAt) {
    activity.lastChangedAt = committedAt;
  }
}

/**
 * Nearest-rank 95th percentile: sort ascending, take the value at
 * `ceil(0.95 · n) − 1`. It always returns an observed value, so a single-node
 * kind yields that node's own count — and therefore churn exactly 1.0 (AC-2).
 * Interpolating estimators would put float noise into a value AD-4 requires to
 * be byte-stable.
 *
 * Returns 0 for an empty input; callers only ever pass counts of at least 1,
 * so a 0 here means "no active nodes of this kind" and no churn to normalize.
 */
export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(0.95 * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

/**
 * `min(1, commits / P95)` at 3 decimals. A node with activity never rounds down
 * to 0, which would make it indistinguishable from an untouched node —
 * ADR-0003 reserves churn 0 for "no commits in the window".
 */
export function churnOf(commits: number, p95: number): number {
  if (commits <= 0 || p95 <= 0) return 0;
  const raw = Math.min(1, commits / p95);
  const rounded = Number(raw.toFixed(CHURN_DECIMALS));
  return rounded === 0 ? CHURN_EPSILON : rounded;
}

/** Renders accumulated activity as the contract's per-node history shape. */
export function toNodeHistory(
  activity: NodeActivity,
  p95: number,
): NodeHistory {
  return {
    churn: churnOf(activity.commits, p95),
    commits: activity.commits,
    authors: activity.authors.size,
    lastChangedAt: toIsoUtc(activity.lastChangedAt),
  };
}

/** Unix seconds to an ISO UTC instant — the contract's `date-time` form. */
export function toIsoUtc(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}
