import { describe, expect, it } from "vitest";

import {
  EMPTY_METRIC,
  formatCount,
  formatInteger,
  formatLanguages,
  formatPercent,
  formatRelativeTime,
} from "./format.js";

describe("stats formatting", () => {
  it("writes large counts the way the mockup does", () => {
    expect(formatCount(412)).toBe("412");
    expect(formatCount(41_200)).toBe("41.2k");
    expect(formatCount(396_525)).toBe("396.5k");
    expect(formatCount(1_240_000)).toBe("1.2m");
    expect(formatCount(-1)).toBe("0");
  });

  it("separates thousands for the counts written out in full", () => {
    expect(formatInteger(1847)).toBe("1,847");
  });

  it("orders language shares descending and rounds to whole percents", () => {
    expect(formatLanguages({ python: 0.261, typescript: 0.739 })).toBe(
      "typescript 74% · python 26%",
    );
  });

  it("drops empty shares and caps the list", () => {
    expect(formatLanguages({ a: 0.5, b: 0.3, c: 0.2, d: 0 }, 2)).toBe(
      "a 50% · b 30%",
    );
  });

  it("says nothing when there are no languages", () => {
    expect(formatLanguages({})).toBe("");
  });

  it("rounds churn to a whole percent and clamps the range", () => {
    expect(formatPercent(0.612)).toBe("61%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1.4)).toBe("100%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

describe("relative last-change (AC-1)", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  it("writes the mockup's wording across the whole ladder", () => {
    const cases: readonly [string, string][] = [
      ["2026-08-13T11:59:30.000Z", "just now"],
      ["2026-08-13T11:20:00.000Z", "40 minutes ago"],
      ["2026-08-13T11:00:00.000Z", "1 hour ago"],
      ["2026-08-12T12:00:00.000Z", "1 day ago"],
      ["2026-08-11T12:00:00.000Z", "2 days ago"],
      ["2026-08-04T12:00:00.000Z", "1 week ago"],
      ["2026-07-23T12:00:00.000Z", "3 weeks ago"],
      ["2026-04-13T12:00:00.000Z", "4 months ago"],
      ["2024-08-13T12:00:00.000Z", "2 years ago"],
    ];
    for (const [iso, expected] of cases) {
      expect(formatRelativeTime(iso, now)).toBe(expected);
    }
  });

  it("prints the empty metric for a node with no history in the window", () => {
    // `lastChangedAt: null` is a contract state (the zero-history fixture has
    // it everywhere), not a failure.
    expect(formatRelativeTime(null, now)).toBe(EMPTY_METRIC);
    expect(formatRelativeTime("not-a-date", now)).toBe(EMPTY_METRIC);
  });

  it("reads a future timestamp as clock skew, not as a negative age", () => {
    expect(formatRelativeTime("2026-09-01T00:00:00.000Z", now)).toBe(
      "just now",
    );
  });
});
