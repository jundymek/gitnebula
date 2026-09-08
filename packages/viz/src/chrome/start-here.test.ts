// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { buildStartHereModel } from "./start-here-model.js";
import { renderStartHere, START_HERE_ID } from "./start-here.js";
import { START_HERE_METRIC_TESTID } from "./testids.js";
import {
  langgraphShapedDocument,
  langgraphShapedWithoutTests,
} from "../test-support/langgraph-shape.js";

/** Story 6.5 — the per-entry metric by its stable hook. */
const SH_METRIC = `[data-testid="${START_HERE_METRIC_TESTID}"]`;

function panelFor(
  document_ = langgraphShapedDocument(),
  actions: Partial<{
    onSelect: (id: string) => void;
    onClose: () => void;
  }> = {},
) {
  const handle = renderStartHere(buildStartHereModel(document_), {
    onSelect: actions.onSelect ?? (() => {}),
    onClose: actions.onClose ?? (() => {}),
  });
  document.body.replaceChildren(handle.element);
  return handle;
}

describe("start-here panel — the three lists", () => {
  it("renders one section per category, in reading order", () => {
    const { element } = panelFor();
    const titles = [...element.querySelectorAll(".sh-cat h3")].map(
      (heading) => heading.textContent,
    );
    expect(titles).toEqual(["core", "entry points", "tests as documentation"]);
  });

  it("prints each entry's path and the number that earned its place", () => {
    const { element } = panelFor();
    const first = element.querySelector(".sh-entry")!;
    expect(first.querySelector(".sh-path")?.textContent).toBe(
      "langgraph/typing.py",
    );
    // Story 5.11: core ranks on `imports × lines`, so the row prints both
    // numbers. Printing only one would leave the reader unable to see why a
    // file with fewer importers sits above one with more.
    expect(first.querySelector(SH_METRIC)?.textContent).toBe(
      "7 importers · 40 lines",
    );
  });

  it("gives every entry an authored accessible name", () => {
    // Same lesson as the search results: an option built from two spans gets
    // an empty name in the accessibility tree, so the name is authored.
    const { element } = panelFor();
    expect(element.querySelector(".sh-entry")?.getAttribute("aria-label")).toBe(
      "langgraph/typing.py, 7 importers · 40 lines",
    );
  });

  it("is a labelled region with a heading", () => {
    const { element } = panelFor();
    expect(element.id).toBe(START_HERE_ID);
    const labelledBy = element.getAttribute("aria-labelledby");
    expect(element.querySelector(`#${labelledBy}`)?.textContent).toBe(
      "start here",
    );
  });
});

describe("start-here panel — UX-DR14 empty states (AC-5)", () => {
  it("states the cause and the exit instead of a blank block", () => {
    const { element } = panelFor(langgraphShapedWithoutTests());
    const tests = element.querySelector('[data-category="tests"]')!;

    expect(tests.querySelector(".sh-list")).toBeNull();
    const empty = tests.querySelector(".sh-empty")!;
    expect(empty.textContent).toContain("no files with `layer: test`");
    // The exit is the second half of the shape, and it is not optional.
    expect(
      empty.querySelector(".sh-exit")?.textContent?.length,
    ).toBeGreaterThan(0);
  });

  it("still renders the categories that do have members", () => {
    const { element } = panelFor(langgraphShapedWithoutTests());
    expect(
      element.querySelectorAll('[data-category="core"] .sh-entry').length,
    ).toBeGreaterThan(0);
  });
});

describe("start-here panel — selection and dismissal (AC-3, AC-4)", () => {
  it("asks for the node it was told to open, by id", () => {
    const onSelect = vi.fn();
    const { element } = panelFor(langgraphShapedDocument(), { onSelect });

    element.querySelector<HTMLButtonElement>(".sh-entry")!.click();

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("langgraph/typing.py");
  });

  it("opens and closes without rebuilding its content", () => {
    const { element, open, close } = panelFor();
    const before = element.querySelector(".sh-entry");

    open();
    expect(element.hidden).toBe(false);
    close();
    expect(element.hidden).toBe(true);
    open();

    // AC-3: reopening does not reload the document — the very same DOM node is
    // still there, so nothing was recomputed or re-rendered.
    expect(element.querySelector(".sh-entry")).toBe(before);
  });

  it("reports dismissal through its close button", () => {
    const onClose = vi.fn();
    const { element } = panelFor(langgraphShapedDocument(), { onClose });

    element.querySelector<HTMLButtonElement>(".sh-close")!.click();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("binds no global keyboard shortcut", () => {
    // Escape belongs to story 5.4's scope exit. Two handlers for one key in
    // two branches is the collision this cohort exists to avoid.
    const { element, open } = panelFor();
    open();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(element.hidden).toBe(false);
  });
});
