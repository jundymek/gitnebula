// @vitest-environment jsdom
/**
 * Story 5.1's wiring, asserted at the level the acceptance criteria are
 * written at: the panel as the first state (AC-3), reopening it from the
 * header without a reload (AC-3), and a row reusing the existing flight and
 * selection path rather than a second one (AC-4).
 *
 * It lives in its own file rather than in `chrome.test.ts` because four
 * stories are appending to that suite this wave; a separate file is the same
 * assertions with none of the merge cost.
 */
import { describe, expect, it, vi } from "vitest";

import { mountChrome } from "./chrome.js";
import { START_HERE_ID } from "./start-here.js";
import type { GraphEngine } from "../engine/index.js";
import { langgraphShapedDocument } from "../test-support/langgraph-shape.js";

function fakeEngine() {
  const flights: string[] = [];
  const loads: unknown[] = [];
  const engine = {
    flyTo: (id: string) => {
      flights.push(id);
      return Promise.resolve();
    },
    load: (document_: unknown) => loads.push(document_),
    replay: vi.fn(),
    setSelected: vi.fn(),
    setIsolated: vi.fn(),
    on: () => () => {},
    nodes: [],
  } as unknown as GraphEngine;
  return { engine, flights, loads };
}

function mount() {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const fake = fakeEngine();
  const chrome = mountChrome(root, langgraphShapedDocument(), {
    stage: document.createElement("canvas"),
    actions: { onReplay: () => {} },
  });
  chrome.attachEngine(fake.engine);
  const panel = root.querySelector<HTMLElement>(`#${START_HERE_ID}`)!;
  const button = root.querySelector<HTMLButtonElement>("#start-here-button")!;
  return { root, chrome, panel, button, ...fake };
}

/** What the engine's `settled` event does to the store, via `connectEngine`. */
function settle(chrome: ReturnType<typeof mount>["chrome"]): void {
  chrome.setState({ settling: false });
}

describe("start-here wiring — AC-3, the default first state", () => {
  it("stays shut while the layout is still settling", () => {
    const { panel } = mount();
    expect(panel.hidden).toBe(true);
  });

  it("opens once the viewer finishes settling", () => {
    const { chrome, panel } = mount();
    settle(chrome);
    expect(panel.hidden).toBe(false);
  });

  it("does not open over a selection the reader already made", () => {
    // A deep link or a fast click during the settle: the reader has already
    // asked a question, and answering a different one on top of it is worse
    // than not answering.
    const { chrome, panel } = mount();
    chrome.setState({ selectedId: "langgraph/typing.py" });
    settle(chrome);
    expect(panel.hidden).toBe(true);
  });

  it("does not come back on a later settle, such as a replay", () => {
    const { chrome, panel } = mount();
    settle(chrome);
    chrome.setState({ startHereOpen: false });

    chrome.setState({ settling: true });
    settle(chrome);

    expect(panel.hidden).toBe(true);
  });

  it("is dismissible from its own close button", () => {
    const { chrome, panel } = mount();
    settle(chrome);

    panel.querySelector<HTMLButtonElement>(".sh-close")!.click();

    expect(panel.hidden).toBe(true);
    expect(chrome.getState().startHereOpen).toBe(false);
  });
});

describe("start-here wiring — AC-3 under reduced motion", () => {
  /**
   * Under `prefers-reduced-motion`, `engine.load()` runs the layout to Settled
   * and emits `settled` **synchronously inside the call** (`engine.ts`, and
   * `app.ts` says so in as many words). The Viewer connects the chrome to the
   * engine *after* `load`, so that event is emitted before anything is
   * listening: nothing ever clears `settling`, and a panel waiting for it
   * would never appear for a reader who asked for less animation.
   *
   * The chrome therefore resolves the same media query the engine does for its
   * initial value. See the README for why this is a workaround and where the
   * defect it works around actually lives.
   */
  function withReducedMotion<T>(body: () => T): T {
    const original = globalThis.matchMedia;
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: query.includes("reduce") }),
    });
    try {
      return body();
    } finally {
      Object.defineProperty(globalThis, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  }

  it("is the first state without waiting for an event it has already missed", () => {
    const { panel, chrome } = withReducedMotion(mount);
    expect(chrome.getState().settling).toBe(false);
    expect(panel.hidden).toBe(false);
  });

  it("leaves the replay control live rather than disabled forever", () => {
    // Same root cause, and the reason the fix is not scoped to this panel: the
    // 2.5 replay button reads `settling` too.
    const { root } = withReducedMotion(mount);
    expect(root.querySelector<HTMLButtonElement>("#replay")!.disabled).toBe(
      false,
    );
  });

  it("keeps the animated path unchanged when motion is not reduced", () => {
    const { chrome, panel } = mount();
    expect(chrome.getState().settling).toBe(true);
    expect(panel.hidden).toBe(true);
  });
});

describe("start-here wiring — AC-3, reopening from the header", () => {
  it("reopens without reloading the document or re-running the settle", () => {
    const { chrome, panel, button, loads } = mount();
    settle(chrome);
    panel.querySelector<HTMLButtonElement>(".sh-close")!.click();
    const row = panel.querySelector(".sh-entry");

    button.click();

    expect(panel.hidden).toBe(false);
    // Nothing was handed to the engine again, and the settle was not re-run:
    // the panel is the same DOM it was built as.
    expect(loads).toEqual([]);
    expect(chrome.getState().settling).toBe(false);
    expect(panel.querySelector(".sh-entry")).toBe(row);
  });

  it("is a disclosure — pressing it again shuts the panel", () => {
    const { chrome, panel, button } = mount();
    settle(chrome);

    button.click();
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("works before the first settle, too", () => {
    // The control is never dead: pressing it during the settle opens the
    // panel, and the first-load open does not then fight it.
    const { chrome, panel, button } = mount();
    button.click();
    expect(panel.hidden).toBe(false);

    settle(chrome);
    expect(panel.hidden).toBe(false);
  });
});

describe("start-here wiring — AC-4, the existing flight path", () => {
  it("flies to the chosen node through the engine interface", () => {
    const { chrome, panel, flights } = mount();
    settle(chrome);

    panel.querySelector<HTMLButtonElement>(".sh-entry")!.click();

    // `flyTo` is the whole of it: the camera move, the unfold of a collapsed
    // parent and the `select` that opens the detail panel are all its, exactly
    // as they are for the search box (story 3.3).
    expect(flights).toEqual(["langgraph/typing.py"]);
  });

  it("selects nothing by hand — the engine does that on arrival", () => {
    const { chrome, panel, engine } = mount();
    settle(chrome);

    panel.querySelector<HTMLButtonElement>(".sh-entry")!.click();

    expect(engine.setSelected).not.toHaveBeenCalled();
  });

  it("gets out of the way once a row is chosen", () => {
    const { chrome, panel } = mount();
    settle(chrome);

    panel.querySelector<HTMLButtonElement>(".sh-entry")!.click();

    expect(panel.hidden).toBe(true);
  });
});
