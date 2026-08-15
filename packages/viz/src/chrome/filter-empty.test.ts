// @vitest-environment jsdom
/**
 * AC-4: a filter that leaves nothing on screen says so, and offers one click
 * back — a cause and an exit, the epic's UX-DR14 shape.
 */
import { describe, expect, it, vi } from "vitest";

import {
  FILTER_EMPTY_CAUSE,
  FILTER_EMPTY_EXIT,
  renderFilterEmpty,
} from "./filter-empty.js";

describe("AC-4 — the named empty state", () => {
  it("is hidden while anything is drawn", () => {
    const handle = renderFilterEmpty({ onReset: () => {} });
    handle.update({ visible: 12 });
    expect(handle.element.hidden).toBe(true);
  });

  it("appears when the filter leaves nothing", () => {
    const handle = renderFilterEmpty({ onReset: () => {} });
    handle.update({ visible: 0 });
    expect(handle.element.hidden).toBe(false);
  });

  it("names its cause in the words the AC asks for", () => {
    const handle = renderFilterEmpty({ onReset: () => {} });
    handle.update({ visible: 0 });
    expect(handle.element.textContent).toContain(
      "no nodes match the active filters",
    );
    expect(FILTER_EMPTY_CAUSE).toBe("no nodes match the active filters");
  });

  it("states an exit as well as a cause, never a cause alone", () => {
    const handle = renderFilterEmpty({ onReset: () => {} });
    expect(handle.element.textContent).toContain(FILTER_EMPTY_EXIT);
    expect(FILTER_EMPTY_EXIT).toMatch(/turn a layer back on/);
  });

  it("goes back to the unfiltered map in one click", () => {
    const onReset = vi.fn();
    const handle = renderFilterEmpty({ onReset });
    handle.element.querySelector<HTMLButtonElement>("#filter-reset")?.click();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("is a live region, so a keyboard reader is told the map emptied", () => {
    const handle = renderFilterEmpty({ onReset: () => {} });
    expect(handle.element.getAttribute("role")).toBe("status");
  });

  it("also covers a filter that hides everything without excluding every layer", () => {
    // A repository whose nodes are all one layer, with that layer switched
    // off, is the same dead map — the trigger is "nothing survives", not
    // "every toggle is off" (see DECISIONS.md, D4).
    const handle = renderFilterEmpty({ onReset: () => {} });
    handle.update({ visible: 0 });
    expect(handle.element.hidden).toBe(false);
  });
});
