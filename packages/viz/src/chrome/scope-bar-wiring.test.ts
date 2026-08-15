// @vitest-environment jsdom
/**
 * Story 5.4's wiring, asserted against a **real engine** rather than a double.
 *
 * AC-2 does not ask "does the component render a string" — it asks that a user
 * can never be scoped without being able to tell, and without a way out. That
 * is a claim about the whole path: canvas gesture → engine state → `scope`
 * event → store → DOM. A component test cannot make it; this one can.
 *
 * Its own file rather than `chrome.test.ts`, for the reason story 5.1 gives:
 * four stories are appending to that suite this wave, and a separate file is
 * the same assertions with none of the merge cost.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { connectEngine, mountChrome } from "./chrome.js";
import { SCOPE_BAR_ID } from "./scope-bar.js";
import { CanvasGraphEngine } from "../engine/engine.js";
import { buildGraph } from "../engine/graph.js";
import { inScopeIds } from "../engine/scope.js";
import { installFakeCanvas } from "../test-support/fake-canvas.js";
import { langgraphShapedDocument } from "../test-support/langgraph-shape.js";

const FRAME_MS = 1000 / 60;

let engine: CanvasGraphEngine;
let teardown: (() => void) | null = null;

function mount() {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const stage = document.createElement("canvas");
  const analysis = langgraphShapedDocument();

  const chrome = mountChrome(root, analysis, {
    stage,
    actions: { onReplay: () => {} },
  });
  engine = new CanvasGraphEngine({ canvas: stage, reducedMotion: true });
  engine.load(analysis);
  teardown = connectEngine(chrome, engine, { analysis });

  let clock = 0;
  for (let i = 0; i < 10; i++) {
    clock += FRAME_MS;
    engine.frame(clock);
  }

  const bar = root.querySelector<HTMLElement>(`#${SCOPE_BAR_ID}`)!;
  return { root, chrome, bar };
}

function firstModuleId(): string {
  return engine.nodes.find((node) => node.kind === "module")!.id;
}

function visibleText(bar: HTMLElement, selector: string): string {
  const found = bar.querySelector<HTMLElement>(selector);
  return !found || found.hidden ? "" : (found.textContent ?? "");
}

beforeEach(() => {
  installFakeCanvas(1200, 800);
});

afterEach(() => {
  teardown?.();
  teardown = null;
  engine?.destroy();
  document.body.replaceChildren();
});

describe("AC-2 — a scope is never invisible and never inescapable", () => {
  it("puts the indicator in the DOM the moment the engine is scoped", () => {
    const { bar } = mount();
    expect(bar.hidden).toBe(true);

    const focus = firstModuleId();
    engine.setScope(focus);

    expect(bar.hidden).toBe(false);
    expect(visibleText(bar, ".scope-bar-scope")).toContain(focus);
  });

  it("keeps the indicator up for every way INTO a scope, not just one", () => {
    // The gesture and the programmatic call go through the same state, but a
    // regression that wired only one of them would still pass a narrower test.
    const { bar, root } = mount();
    const focus = firstModuleId();
    const stage = root.querySelector("canvas")!;

    void engine.flyTo(focus, { durationMs: 0, zoom: 1.2 });
    stage.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 600, clientY: 400, bubbles: true }),
    );

    expect(engine.getScope()).toBe(focus);
    expect(bar.hidden).toBe(false);
    expect(visibleText(bar, ".scope-bar-scope")).toContain(focus);
  });

  it("leaves the scope when the bar's exit is pressed", () => {
    const { bar } = mount();
    engine.setScope(firstModuleId());
    bar.querySelector<HTMLButtonElement>(".scope-bar-leave")!.click();
    expect(engine.getScope()).toBeNull();
  });

  it("takes the indicator down again once the scope is left", () => {
    const { bar } = mount();
    engine.setScope(firstModuleId());
    engine.setScope(null);
    expect(visibleText(bar, ".scope-bar-scope")).toBe("");
  });

  it("clears the indicator when Escape leaves the scope", () => {
    const { bar } = mount();
    engine.setScope(firstModuleId());
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(engine.getScope()).toBeNull();
    expect(visibleText(bar, ".scope-bar-scope")).toBe("");
  });
});

describe("AC-3 — the connected-only toggle and its count", () => {
  it("drives the engine from the bar and states the count with its cause", () => {
    const { bar } = mount();
    bar.querySelector<HTMLButtonElement>(".scope-bar-connected")!.click();

    expect(engine.getConnectedOnly()).toBe(true);
    const hidden = engine.hiddenCount().byDegree;
    if (hidden > 0) {
      expect(visibleText(bar, ".scope-bar-hidden")).toBe(
        `${hidden} node${hidden === 1 ? "" : "s"} hidden: no dependencies`,
      );
    } else {
      expect(visibleText(bar, ".scope-bar-hidden")).toBe("");
    }
  });

  it("mirrors the engine's state on the toggle, not its own", () => {
    const { bar } = mount();
    const toggle = bar.querySelector<HTMLButtonElement>(
      ".scope-bar-connected",
    )!;
    engine.setConnectedOnly(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    engine.setConnectedOnly(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("AC-5 — a search out of the scope states it and offers the way back", () => {
  /**
   * A target genuinely outside the scope. "Any other module" is not enough —
   * a neighbour module IS in scope by AC-1, so picking one would fly without
   * leaving anything and the test would be asserting the wrong thing.
   */
  async function flyOutOfScope(focus: string): Promise<string> {
    const scope = inScopeIds(buildGraph(langgraphShapedDocument()), focus);
    const outside = engine.nodes.find((node) => !scope.has(node.id));
    if (!outside) throw new Error("fixture has nothing outside this scope");
    await engine.flyTo(outside.id, { durationMs: 0 });
    return outside.id;
  }

  it("says the scope was left and names the one to go back to", async () => {
    const { bar } = mount();
    const focus = firstModuleId();
    engine.setScope(focus);
    await flyOutOfScope(focus);

    expect(engine.getScope()).toBeNull();
    expect(visibleText(bar, ".scope-bar-left")).toContain("left the scope");
    expect(visibleText(bar, ".scope-bar-back")).toBe(`return to ${focus}`);
  });

  it("restores the scope in one click", async () => {
    const { bar } = mount();
    const focus = firstModuleId();
    engine.setScope(focus);
    await flyOutOfScope(focus);

    bar.querySelector<HTMLButtonElement>(".scope-bar-back")!.click();
    expect(engine.getScope()).toBe(focus);
  });

  it("does NOT claim a search happened when the user pressed Escape", async () => {
    // Found by the Codex re-review. `previousScopeId` is populated by *any*
    // exit, so keying the offer on it greeted a user who pressed Escape with
    // "left the scope to reach your search result" — a sentence about
    // something that did not happen. Only AC-5's transition may say it.
    const { bar } = mount();
    engine.setScope(firstModuleId());
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(engine.getScope()).toBeNull();
    expect(visibleText(bar, ".scope-bar-left")).toBe("");
    expect(visibleText(bar, ".scope-bar-back")).toBe("");
  });

  it("does NOT claim a search happened when the leave button was pressed", async () => {
    const { bar } = mount();
    engine.setScope(firstModuleId());
    bar.querySelector<HTMLButtonElement>(".scope-bar-leave")!.click();

    expect(visibleText(bar, ".scope-bar-back")).toBe("");
  });

  it("keeps the offer alive across an unrelated filter change", async () => {
    // The offer is the user's way back; toggling something else must not
    // withdraw it before they have had a chance to use it.
    const { bar } = mount();
    const focus = firstModuleId();
    engine.setScope(focus);
    await flyOutOfScope(focus);
    expect(visibleText(bar, ".scope-bar-back")).toBe(`return to ${focus}`);

    engine.setConnectedOnly(true);
    expect(visibleText(bar, ".scope-bar-back")).toBe(`return to ${focus}`);
  });

  it("drops a return offer that points into a document that is gone", async () => {
    // Also from the re-review: loading a new document while an offer was on
    // screen left the button there, pointing at the previous repository's
    // module, and clicking it no-opped against the new graph forever.
    const { bar } = mount();
    const focus = firstModuleId();
    engine.setScope(focus);
    await flyOutOfScope(focus);
    expect(visibleText(bar, ".scope-bar-back")).not.toBe("");

    engine.load(langgraphShapedDocument());

    expect(visibleText(bar, ".scope-bar-back")).toBe("");
    expect(engine.getLastScope()).toBeNull();
  });

  it("withdraws the offer once a scope is active again", async () => {
    const { bar } = mount();
    const focus = firstModuleId();
    engine.setScope(focus);
    await flyOutOfScope(focus);
    bar.querySelector<HTMLButtonElement>(".scope-bar-back")!.click();
    expect(visibleText(bar, ".scope-bar-back")).toBe("");
  });
});
