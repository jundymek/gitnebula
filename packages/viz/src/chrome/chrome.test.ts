// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { connectEngine, mountChrome } from "./chrome.js";
import { EXPORT_SLOT_ID, FILTER_SLOT_ID, MODE_SLOT_ID } from "./header.js";
import { HINT_LINES } from "./hint.js";
import { LEGEND_ENTRIES } from "./legend.js";
import type { Layer } from "@gitnebula/contract";

import {
  ALL_LAYERS,
  HOT_COLOR,
  LAYER_COLOR,
  UNFOLD_ZOOM,
} from "../engine/index.js";
import type {
  EngineNode,
  GraphEngine,
  GraphEngineEvent,
  ViewMode,
} from "../engine/index.js";
import { engineNodeFrom } from "../test-support/engine-nodes.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

function mount(overrides: Partial<{ onReplay: () => void }> = {}) {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const stage = document.createElement("canvas");
  const store = mountChrome(root, loadSyntheticFixture(), {
    stage,
    actions: { onReplay: overrides.onReplay ?? (() => {}) },
  });
  return { root, store, stage };
}

describe("chrome — UX-DR6 header", () => {
  it("shows the repo name and the six stats the story lists", () => {
    const { root } = mount();
    expect(root.querySelector(".repo")?.textContent).toBe(
      "fixture-synthetic-100x2000",
    );
    const stats = [...root.querySelectorAll(".stats span")].map(
      (span) => span.textContent,
    );
    expect(stats).toEqual([
      "2,000 files",
      "396.5k loc",
      "100 modules",
      "40,649 commits",
      "typescript 74% · python 26%",
    ]);
  });

  it("derives the module count from the nodes, not from repo.stats", () => {
    const document_ = loadSyntheticFixture();
    const root = document.createElement("div");
    document.body.replaceChildren(root);
    const store = mountChrome(
      root,
      // repo.stats has no module count at all — the only source is the node
      // set, so a document with two modules must say two.
      {
        ...document_,
        nodes: document_.nodes
          .filter((node) => node.kind === "module")
          .slice(0, 2),
      },
      {
        stage: document.createElement("canvas"),
        actions: { onReplay: () => {} },
      },
    );
    expect(store.getState().modules).toBe(2);
    expect(root.textContent).toContain("2 modules");
  });

  it("keeps the slots stories 3.4 and 3.5 fill in", () => {
    const { root } = mount();
    expect(root.querySelector(`#${MODE_SLOT_ID}`)).not.toBeNull();
    expect(root.querySelector(`#${EXPORT_SLOT_ID}`)).not.toBeNull();
  });

  it("replays on demand and disables the control while settling", () => {
    const onReplay = vi.fn();
    const { root, store } = mount({ onReplay });
    const replay = root.querySelector<HTMLButtonElement>("#replay")!;

    expect(replay.disabled).toBe(true);
    store.setState({ settling: false });
    expect(replay.disabled).toBe(false);

    replay.click();
    expect(onReplay).toHaveBeenCalledOnce();
  });
});

describe("chrome — UX-DR2/9 legend and hint", () => {
  it("lists the four layers plus the hot spot, in the mockup's colours", () => {
    const { root } = mount();
    const rows = [...root.querySelectorAll(".legend span")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "backend",
      "frontend",
      "infra",
      "test",
      "hot spot",
    ]);
    expect(LEGEND_ENTRIES.map((entry) => entry.color)).toEqual([
      LAYER_COLOR.backend,
      LAYER_COLOR.frontend,
      LAYER_COLOR.infra,
      LAYER_COLOR.test,
      HOT_COLOR,
    ]);
  });

  it("puts a three-line hint bottom-right, naming the real unfold zoom", () => {
    const { root } = mount();
    const hint = root.querySelector(".hint")!;
    expect(HINT_LINES).toHaveLength(3);
    expect(hint.querySelectorAll("br")).toHaveLength(2);
    expect(hint.textContent).toContain(`${UNFOLD_ZOOM}×`);
  });

  it("places the stage inside main, alongside the overlays", () => {
    const { root, stage } = mount();
    expect(root.querySelector("main")?.firstElementChild).toBe(stage);
  });
});

/**
 * A recording double for the parts of the seam chrome uses. Chrome may only
 * reach the map through this surface, so a stub of it is a faithful test of
 * the wiring (AD-5).
 */
function fakeEngine(nodes: readonly EngineNode[] = []) {
  const listeners = new Map<GraphEngineEvent, (payload: never) => void>();
  let offCalls = 0;
  let mode: ViewMode = "structure";
  let layers: readonly Layer[] = ALL_LAYERS;
  const isolated: (string | null)[] = [];
  const selected: (string | null)[] = [];
  const engine = {
    on(event: GraphEngineEvent, listener: (payload: never) => void) {
      listeners.set(event, listener);
      return () => {
        offCalls++;
      };
    },
    getMode: () => mode,
    setMode(next: ViewMode) {
      mode = next;
      emit("mode", { mode: next });
    },
    setIsolated(id: string | null) {
      // The real engine ignores a no-op and publishes every real change on
      // `highlight`; chrome reads its isolate state back from that event.
      if (isolated.at(-1) === id) return;
      isolated.push(id);
      emit("highlight", { focusId: id, isolated: id !== null });
    },
    setSelected: (id: string | null) => selected.push(id),
    // Story 3.3's unfold/collapse handlers read these back.
    unfoldedModules: () => [],
    nodes,
    // Story 5.3's slice of the seam. Same shape as `getMode`/`setMode`: the
    // engine owns the filter and echoes every real change back on an event,
    // which is what moves the control.
    getLayerFilter: () => layers,
    setLayerFilter(next: readonly Layer[]) {
      layers = ALL_LAYERS.filter((layer) => next.includes(layer));
      emit("filter", { layers, hidden: 0, visible: 1 });
    },
    // Story 5.4's slice, added for the same reason as 5.3's above: chrome
    // mirrors this state at connect time, so a double without it makes
    // `connectEngine` throw for every suite in this file.
    getScope: () => null,
    getConnectedOnly: () => false,
    hiddenCount: () => ({ byScope: 0, byDegree: 0 }),
  } as unknown as GraphEngine;

  function emit(event: GraphEngineEvent, payload: unknown): void {
    (listeners.get(event) as ((payload: unknown) => void) | undefined)?.(
      payload,
    );
  }

  return {
    engine,
    emit,
    isolated,
    selected,
    offCalls: () => offCalls,
    listeners,
  };
}

describe("chrome — AD-5 wiring", () => {
  it("follows the engine's settle events and unsubscribes on teardown", () => {
    const fake = fakeEngine();
    const { store } = mount();
    const teardown = connectEngine(store, fake.engine, {
      analysis: loadSyntheticFixture(),
    });

    fake.emit("settled", { frames: 148, durationMs: 2470 });
    expect(store.getState().settling).toBe(false);

    fake.emit("settle-start", { reason: "replay" });
    expect(store.getState().settling).toBe(true);

    teardown();
    // Every subscription is released — asserted as the invariant rather than
    // as a fixed count, so a story that adds a listener does not have to come
    // back and edit this number.
    expect(fake.listeners.size).toBeGreaterThanOrEqual(2);
    expect(fake.offCalls()).toBe(fake.listeners.size);
  });
});

describe("chrome — panel wiring (AC-1, AC-4)", () => {
  const analysis = loadSyntheticFixture();

  function connected() {
    const fake = fakeEngine();
    const mounted = mount();
    const teardown = connectEngine(mounted.store, fake.engine, {
      analysis,
      now: Date.parse("2026-08-13T12:00:00.000Z"),
    });
    const panel = mounted.root.querySelector<HTMLElement>("#panel")!;
    return { ...mounted, ...fake, panel, teardown };
  }

  it("opens the panel on a select event, whatever fired it", () => {
    const { panel, emit, store } = connected();
    expect(panel.hidden).toBe(true);

    // The same event a canvas click and a 3.3 search fly-to both produce.
    emit("select", { node: engineNodeFrom(analysis, "mod-000/") });

    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".p-name")?.textContent).toBe("mod-000/");
    expect(store.getState().selected?.id).toBe("mod-000/");
  });

  it("closes the panel and clears isolate when selection goes to null", () => {
    const { panel, emit, store, isolated } = connected();
    emit("select", { node: engineNodeFrom(analysis, "mod-000/") });
    emit("select", { node: null });

    expect(panel.hidden).toBe(true);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().isolated).toBe(false);
    expect(isolated.at(-1)).toBeNull();
  });

  it("toggles isolate on the open node and back off again", () => {
    const { panel, emit, store, isolated } = connected();
    emit("select", { node: engineNodeFrom(analysis, "mod-000/") });

    const button = panel.querySelector<HTMLButtonElement>("#p-isolate")!;
    button.click();
    expect(isolated.at(-1)).toBe("mod-000/");
    expect(store.getState().isolated).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");

    button.click();
    expect(isolated.at(-1)).toBeNull();
    expect(store.getState().isolated).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("mirrors isolate changed outside the panel", () => {
    // The button only asks; the engine owns the state and publishes it on
    // `highlight`. A change made anywhere else must still reach the button.
    const { panel, emit, store } = connected();
    emit("select", { node: engineNodeFrom(analysis, "mod-000/") });

    emit("highlight", { focusId: "mod-000/", isolated: true });

    expect(store.getState().isolated).toBe(true);
    expect(
      panel.querySelector("#p-isolate")!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("drops isolate when a different node is selected", () => {
    const { panel, emit, isolated, store } = connected();
    emit("select", { node: engineNodeFrom(analysis, "mod-000/") });
    panel.querySelector<HTMLButtonElement>("#p-isolate")!.click();

    emit("select", { node: engineNodeFrom(analysis, "mod-001/") });

    expect(isolated.at(-1)).toBeNull();
    expect(store.getState().isolated).toBe(false);
  });

  it("asks the engine to clear selection and isolate when × is pressed", () => {
    const { panel, emit, selected, isolated } = connected();
    emit("select", { node: engineNodeFrom(analysis, "mod-000/") });

    panel.querySelector<HTMLButtonElement>(".p-close")!.click();

    expect(selected.at(-1)).toBeNull();
    expect(isolated.at(-1)).toBeNull();
    expect(panel.hidden).toBe(true);
  });
});

describe("chrome — mode toggle wiring (AC-5)", () => {
  const analysis = loadSyntheticFixture();

  it("fills the header slot 2.5 left for it", () => {
    const { root } = mount();
    const slot = root.querySelector(`#${MODE_SLOT_ID}`)!;
    expect(slot.querySelector("#mode-structure")).not.toBeNull();
    expect(slot.querySelector("#mode-heat")).not.toBeNull();
  });

  it("drives the engine and repaints from the engine's own event", () => {
    const fake = fakeEngine();
    const { root, store } = mount();
    connectEngine(store, fake.engine, { analysis });

    const heat = root.querySelector<HTMLButtonElement>("#mode-heat")!;
    heat.click();

    expect(fake.engine.getMode()).toBe("heat");
    expect(heat.getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().mode).toBe("heat");
  });

  it("takes its starting mode from the engine, in both halves of the mirror", () => {
    const fake = fakeEngine();
    fake.engine.setMode("heat");
    const { root, store } = mount();

    connectEngine(store, fake.engine, { analysis });

    // The store is the half a subscriber reads; the toggle is the half the
    // user sees. Initialising only one of them is the bug this covers.
    expect(store.getState().mode).toBe("heat");
    expect(root.querySelector("#mode-heat")!.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps the mode across panel interactions", () => {
    const fake = fakeEngine();
    const { root, store } = mount();
    connectEngine(store, fake.engine, { analysis });
    root.querySelector<HTMLButtonElement>("#mode-heat")!.click();

    fake.emit("select", { node: engineNodeFrom(analysis, "mod-000/") });
    root.querySelector<HTMLButtonElement>("#p-isolate")!.click();
    root.querySelector<HTMLButtonElement>(".p-close")!.click();

    expect(store.getState().mode).toBe("heat");
    expect(root.querySelector("#mode-heat")!.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

// ---- story 5.3 (layer filter) — appended, nothing above is reshaped -------

describe("chrome — layer filter wiring (5.3, FR-28)", () => {
  const analysis = loadSyntheticFixture();

  it("puts the control in the header's filter slot", () => {
    const { root } = mount();
    const slot = root.querySelector(`#${FILTER_SLOT_ID}`);
    expect(slot?.querySelector("#layer-filter")).not.toBeNull();
    expect(slot?.querySelectorAll("button")).toHaveLength(ALL_LAYERS.length);
  });

  it("asks the engine rather than deciding for itself", () => {
    const fake = fakeEngine();
    const { root, store } = mount();
    connectEngine(store, fake.engine, { analysis });

    root.querySelector<HTMLButtonElement>("#layer-test")!.click();

    expect(fake.engine.getLayerFilter()).toEqual([
      "backend",
      "frontend",
      "infra",
      "other",
    ]);
  });

  it("mirrors the engine's answer into both the store and the buttons", () => {
    const fake = fakeEngine();
    const { root, store } = mount();
    connectEngine(store, fake.engine, { analysis });

    fake.emit("filter", { layers: ["backend"], hidden: 232, visible: 418 });

    expect(store.getState().visibleLayers).toEqual(["backend"]);
    expect(store.getState().filteredOutCount).toBe(232);
    expect(
      root.querySelector("#layer-backend")!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      root.querySelector("#layer-test")!.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(root.querySelector("#layer-filter-hidden")!.textContent).toBe(
      "232 nodes hidden: layer filter",
    );
  });

  it("shows the empty state only when nothing survives, and resets from it", () => {
    const fake = fakeEngine();
    const { root, store } = mount();
    connectEngine(store, fake.engine, { analysis });
    const empty = root.querySelector<HTMLElement>("#filter-empty")!;

    fake.emit("filter", { layers: ["backend"], hidden: 1, visible: 12 });
    expect(empty.hidden).toBe(true);

    // Every node hidden — the AC-4 case.
    fake.emit("filter", {
      layers: [],
      hidden: analysis.nodes.length,
      visible: 0,
    });
    expect(empty.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>("#filter-reset")!.click();
    expect(fake.engine.getLayerFilter()).toEqual([...ALL_LAYERS]);
    expect(empty.hidden).toBe(true);
  });

  it("takes its starting filter from the engine, in both halves of the mirror", () => {
    const fake = fakeEngine();
    fake.engine.setLayerFilter(["infra"]);
    const { root, store } = mount();

    connectEngine(store, fake.engine, { analysis });

    expect(store.getState().visibleLayers).toEqual(["infra"]);
    expect(
      root.querySelector("#layer-infra")!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("takes the starting COUNTS from the engine too, not from zero", () => {
    // An engine filtered before it was connected emitted its `filter` event
    // with nothing listening. Assuming "nothing hidden" would leave the count
    // blank and the empty state shut over a map with nothing on it.
    const nodes = analysis.nodes.map((node) =>
      engineNodeFrom(analysis, node.id),
    );
    const fake = fakeEngine(nodes);
    fake.engine.setLayerFilter(["infra"]);
    const { root, store } = mount();

    connectEngine(store, fake.engine, { analysis });

    const infra = nodes.filter((node) => node.layer === "infra").length;
    const hidden = nodes.length - infra;
    expect(store.getState().filteredOutCount).toBe(hidden);
    expect(root.querySelector("#layer-filter-hidden")!.textContent).toBe(
      `${hidden} nodes hidden: layer filter`,
    );
  });

  it("opens the empty state at connect time when the filter already hides everything", () => {
    const nodes = analysis.nodes.map((node) =>
      engineNodeFrom(analysis, node.id),
    );
    const fake = fakeEngine(nodes);
    // Every layer off before anything was listening — the AC-4 state, reached
    // by an engine that was already filtered when it was handed over.
    fake.engine.setLayerFilter([]);
    const { root, store } = mount();

    connectEngine(store, fake.engine, { analysis });

    expect(store.getState().filteredOutCount).toBe(nodes.length);
    expect(root.querySelector<HTMLElement>("#filter-empty")!.hidden).toBe(
      false,
    );
  });

  it("keeps the empty state shut for a document with no nodes at all", () => {
    // Nothing drawn and nothing hidden: the filter is not the cause, and this
    // block may only ever claim its own.
    const fake = fakeEngine();
    const { root, store } = mount();

    connectEngine(store, fake.engine, { analysis });

    expect(root.querySelector<HTMLElement>("#filter-empty")!.hidden).toBe(true);
  });
});
