import { describe, expect, it } from "vitest";

import {
  churnOf,
  emptyActivity,
  percentile95,
  recordCommit,
  toIsoUtc,
  toNodeHistory,
} from "./metrics.js";

describe("percentile95", () => {
  it("is 0 for no active nodes", () => {
    expect(percentile95([])).toBe(0);
  });

  it("is the node's own count for a single-node kind (ADR-0003, AC-2)", () => {
    expect(percentile95([7])).toBe(7);
  });

  it("returns an observed value, never an interpolated one", () => {
    // Nearest rank over 10 values: ceil(0.95 * 10) - 1 = 9, the largest.
    expect(percentile95([1, 2, 3, 4, 5, 6, 7, 8, 9, 40])).toBe(40);
    // Over 20 values: ceil(0.95 * 20) - 1 = 18, the second largest.
    const twenty = [...Array.from({ length: 19 }, (_, i) => i + 1), 500];
    expect(percentile95(twenty)).toBe(19);
  });

  it("ignores input order", () => {
    expect(percentile95([9, 1, 5, 3])).toBe(percentile95([1, 3, 5, 9]));
  });

  it("does not mutate its input", () => {
    const values = [5, 1, 3];
    percentile95(values);
    expect(values).toEqual([5, 1, 3]);
  });
});

describe("churnOf", () => {
  it("is 0 for a node with no commits", () => {
    expect(churnOf(0, 4)).toBe(0);
  });

  it("is 1 for the single node of its kind", () => {
    expect(churnOf(7, 7)).toBe(1);
  });

  it("clamps a node above P95 to 1", () => {
    expect(churnOf(500, 4)).toBe(1);
  });

  it("normalizes against P95 at 3 decimals", () => {
    expect(churnOf(3, 4)).toBe(0.75);
    expect(churnOf(2, 3)).toBe(0.667);
  });

  it("never rounds an active node down to 0", () => {
    // churn 0 means "no commits in the window" — an active node must stay
    // distinguishable from an untouched one.
    expect(churnOf(1, 100_000)).toBe(0.001);
  });

  it("is 0 when the kind has no activity at all", () => {
    expect(churnOf(0, 0)).toBe(0);
  });
});

describe("toIsoUtc", () => {
  it("passes null through for an untouched node", () => {
    expect(toIsoUtc(null)).toBeNull();
  });

  it("renders unix seconds as an ISO UTC instant", () => {
    expect(toIsoUtc(1_751_270_400)).toBe("2025-06-30T08:00:00.000Z");
  });
});

describe("activity accumulation", () => {
  it("counts commits, distinct authors and the newest instant", () => {
    const activity = emptyActivity();
    recordCommit(activity, 300, "ada@fixture.invalid");
    recordCommit(activity, 100, "ben@fixture.invalid");
    recordCommit(activity, 200, "ada@fixture.invalid");

    expect(toNodeHistory(activity, 3)).toEqual({
      churn: 1,
      commits: 3,
      authors: 2,
      lastChangedAt: toIsoUtc(300),
    });
  });

  it("reports an untouched node as all zeros", () => {
    expect(toNodeHistory(emptyActivity(), 4)).toEqual({
      churn: 0,
      commits: 0,
      authors: 0,
      lastChangedAt: null,
    });
  });
});
