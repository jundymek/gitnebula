// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { connectEngine, mountChrome } from "./chrome.js";
import { EXPORT_SLOT_ID, MODE_SLOT_ID } from "./header.js";
import { HINT_LINES } from "./hint.js";
import { LEGEND_ENTRIES } from "./legend.js";
import { HOT_COLOR, LAYER_COLOR, UNFOLD_ZOOM } from "../engine/index.js";
import type { GraphEngine, GraphEngineEvent } from "../engine/index.js";
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

describe("chrome — AD-5 wiring", () => {
  it("follows the engine's settle events and unsubscribes on teardown", () => {
    const listeners = new Map<GraphEngineEvent, (payload: never) => void>();
    let subscriptions = 0;
    let offCalls = 0;
    const engine = {
      on(event: GraphEngineEvent, listener: (payload: never) => void) {
        listeners.set(event, listener);
        subscriptions++;
        return () => {
          offCalls++;
        };
      },
      // Story 3.3's handlers read these back when unfold/collapse arrive.
      unfoldedModules: () => [],
      nodes: [],
    } as unknown as GraphEngine;

    const { store } = mount();
    const teardown = connectEngine(store, engine);

    (listeners.get("settled") as (payload: unknown) => void)({
      frames: 148,
      durationMs: 2470,
    });
    expect(store.getState().settling).toBe(false);

    (listeners.get("settle-start") as (payload: unknown) => void)({
      reason: "replay",
    });
    expect(store.getState().settling).toBe(true);

    teardown();
    // Every subscription is released — asserted as the invariant rather than
    // as a fixed count, so a story that adds a listener does not have to come
    // back and edit this number (3.3 took it from 2 to 6).
    expect(subscriptions).toBeGreaterThanOrEqual(2);
    expect(offCalls).toBe(subscriptions);
  });
});
