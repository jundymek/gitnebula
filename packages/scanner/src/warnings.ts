// Counted, non-fatal drops (AD-7): per-item failures never throw, and no drop
// is silent — each increments a named counter that cli surfaces in its
// summary.

import type { AnalyzerWarning } from "@gitnebula/contract";

interface WarningEntry {
  count: number;
  /** First example seen, kept for the terminal summary. */
  detail: string | undefined;
}

/**
 * Accumulates warnings by code. The first example of each code is kept as the
 * detail — the first one, deliberately, because "the last one seen" depends on
 * traversal order in a way a reader cannot predict.
 */
export class WarningCollector {
  readonly #entries = new Map<string, WarningEntry>();

  add(code: string, detail?: string): void {
    const entry = this.#entries.get(code);
    if (entry) {
      entry.count += 1;
      return;
    }
    this.#entries.set(code, { count: 1, detail });
  }

  /** Warnings sorted by code, so two runs serialize identically (AD-4). */
  toArray(): AnalyzerWarning[] {
    return [...this.#entries.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, entry]) =>
        entry.detail === undefined
          ? { code, count: entry.count }
          : { code, count: entry.count, detail: entry.detail },
      );
  }
}
