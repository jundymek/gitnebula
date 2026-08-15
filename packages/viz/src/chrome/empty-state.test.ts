import { describe, expect, it } from "vitest";

import {
  EMPTY_STATE_CLASS,
  emptyStateLine,
  mostlyColdState,
  noChangeInWindow,
  noCommitsInWindow,
  outOfWindowState,
  widenWindowHint,
  zeroHistoryState,
} from "./empty-state.js";

/**
 * These are copy conventions, so the tests assert the conventions rather than
 * the sentences: a cause and an exit, the window taken from its argument, and
 * the flag named concretely. Story 5.6 builds on this shape, so a change that
 * breaks the shape should fail here rather than surface as drift later.
 */

describe("empty-state — the window is always an argument (AC-1)", () => {
  it("never emits a hardcoded 90", () => {
    // The bug this story exists to prevent: copy that says "90 days" on a run
    // configured with --window-days 30.
    const produced = [
      noChangeInWindow(30),
      noCommitsInWindow(30),
      widenWindowHint(30),
      emptyStateLine(outOfWindowState(30)),
      emptyStateLine(zeroHistoryState(30)),
      emptyStateLine(mostlyColdState(5, 10, 30)),
    ];
    for (const copy of produced) {
      expect(copy).toContain("30");
      expect(copy).not.toContain("90");
    }
  });

  it("carries whatever window it is given, including unusual ones", () => {
    expect(noChangeInWindow(1)).toBe("no change in last 1 days");
    expect(noChangeInWindow(3650)).toBe("no change in last 3650 days");
  });
});

describe("empty-state — the cause/exit convention (UX-DR14)", () => {
  it("states a cause and an actionable exit for the node case", () => {
    const state = outOfWindowState(365);
    expect(state.cause).toBe("no change in last 365 days");
    // An exit the reader cannot act on without guessing is not an exit, so
    // the flag is named rather than described.
    expect(state.exit).toContain("--window-days");
  });

  it("states a different cause for the repository case", () => {
    const state = zeroHistoryState(365);
    expect(state.cause).toBe("no commits in the last 365 days");
    expect(state.cause).not.toBe(outOfWindowState(365).cause);
    expect(state.exit).toContain("--window-days");
  });

  it("counts rather than hedging in the heatmap case", () => {
    // A number is what makes an empty state read as a measurement instead of
    // as a failure — the distinction the whole story turns on.
    const state = mostlyColdState(386, 650, 90);
    expect(state.cause).toBe("386 of 650 files unchanged in the last 90 days");
    expect(state.cause).not.toMatch(/some|many|most/);
  });

  it("joins cause and exit with the chrome's existing separator", () => {
    expect(emptyStateLine({ cause: "a", exit: "b" })).toBe("a · b");
  });

  it("never falls back to a bare dash or to 'no data'", () => {
    const all = [
      outOfWindowState(90),
      zeroHistoryState(90),
      mostlyColdState(1, 2, 90),
    ];
    for (const state of all) {
      expect(state.cause).not.toBe("—");
      expect(state.cause).not.toMatch(/no data/i);
      expect(state.exit.length).toBeGreaterThan(0);
    }
  });
});

describe("empty-state — the marker class", () => {
  it("is a stable hook the stylesheet and peers can rely on", () => {
    expect(EMPTY_STATE_CLASS).toBe("is-empty");
  });
});
