// @vitest-environment jsdom
/**
 * The filter control's own contract (AC-1): multi-select, `aria-pressed` on
 * every toggle, and an active set that is readable without opening anything.
 *
 * The control asks and never decides — it emits the full surviving set and
 * moves its own buttons only when `setLayers` is called back. These tests hold
 * that asymmetry, because it is what keeps one filter state in the engine
 * instead of two that drift.
 */
import { describe, expect, it, vi } from "vitest";

import type { Layer } from "@gitnebula/contract";

import { ALL_LAYERS, LAYER_COLOR } from "../engine/index.js";
import { hiddenText, renderLayerFilter } from "./layer-filter.js";

function buttons(element: HTMLElement): HTMLButtonElement[] {
  return [...element.querySelectorAll("button")];
}

function pressedLayers(element: HTMLElement): string[] {
  return buttons(element)
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.id.replace("layer-", ""));
}

describe("AC-1 — one toggle per layer, all five of them", () => {
  it("renders a button per contract layer, in ALL_LAYERS order", () => {
    const { element } = renderLayerFilter({ onFilter: () => {} });
    expect(buttons(element).map((b) => b.id)).toEqual(
      ALL_LAYERS.map((layer) => `layer-${layer}`),
    );
  });

  it("is a labelled group, the mode toggle's markup (UX-DR6)", () => {
    const { element } = renderLayerFilter({ onFilter: () => {} });
    expect(element.getAttribute("role")).toBe("group");
    expect(element.getAttribute("aria-label")).toBe("Layer filter");
  });

  it("starts with every layer on", () => {
    const { element } = renderLayerFilter({ onFilter: () => {} });
    expect(pressedLayers(element)).toEqual([...ALL_LAYERS]);
  });

  it("carries aria-pressed on every button, in both states", () => {
    const handle = renderLayerFilter({ onFilter: () => {} });
    handle.setLayers(["backend", "test"]);
    for (const button of buttons(handle.element)) {
      // Present on all five, not only on the pressed ones: a control that
      // drops the attribute when off announces nothing at all.
      expect(button.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
    }
    expect(pressedLayers(handle.element)).toEqual(["backend", "test"]);
  });

  it("shows the active set without opening a menu (UX-DR13)", () => {
    const handle = renderLayerFilter({ onFilter: () => {} });
    handle.setLayers(["frontend"]);
    // Every label is on screen and the state is on the buttons themselves —
    // there is no popup, no summary, and nothing to click to find out.
    expect(handle.element.textContent).toContain("frontend");
    expect(handle.element.textContent).toContain("backend");
    expect(handle.element.querySelectorAll("[aria-expanded]")).toHaveLength(0);
  });

  it("carries the engine's palette on each swatch, so it matches the canvas", () => {
    const { element } = renderLayerFilter({ onFilter: () => {} });
    const dot = element.querySelector<HTMLElement>("#layer-backend .dot");
    expect(dot?.style.background).toBeTruthy();
    expect(LAYER_COLOR.backend).toBe("#3fcfa0");
  });
});

describe("AC-1 — multi-select, unlike the single-select mode toggle", () => {
  it("emits the set minus the layer that was switched off", () => {
    const onFilter = vi.fn();
    const handle = renderLayerFilter({ onFilter });
    handle.element.querySelector<HTMLButtonElement>("#layer-test")?.click();
    expect(onFilter).toHaveBeenCalledWith([
      "backend",
      "frontend",
      "infra",
      "other",
    ]);
  });

  it("emits the set plus the layer that was switched back on", () => {
    const onFilter = vi.fn();
    const handle = renderLayerFilter({ onFilter }, ["backend"]);
    handle.element.querySelector<HTMLButtonElement>("#layer-infra")?.click();
    expect(onFilter).toHaveBeenCalledWith(["backend", "infra"]);
  });

  it("can empty the set completely — that is AC-4's case, not an error", () => {
    const onFilter = vi.fn();
    const handle = renderLayerFilter({ onFilter }, ["test"]);
    handle.element.querySelector<HTMLButtonElement>("#layer-test")?.click();
    expect(onFilter).toHaveBeenCalledWith([]);
  });

  it("does not move its own buttons until the engine says so", () => {
    const handle = renderLayerFilter({ onFilter: () => {} });
    handle.element.querySelector<HTMLButtonElement>("#layer-test")?.click();
    // The click asked; nothing echoed back, so the control still shows the
    // engine's last known truth rather than an optimistic one.
    expect(pressedLayers(handle.element)).toEqual([...ALL_LAYERS]);
    handle.setLayers(["backend"]);
    expect(pressedLayers(handle.element)).toEqual(["backend"]);
  });

  it("always emits in ALL_LAYERS order, whatever order it was given", () => {
    const onFilter = vi.fn();
    const handle = renderLayerFilter({ onFilter }, [
      "test",
      "backend",
    ] as Layer[]);
    handle.element.querySelector<HTMLButtonElement>("#layer-infra")?.click();
    expect(onFilter).toHaveBeenCalledWith(["backend", "infra", "test"]);
  });
});

describe("the hidden count names its own cause (UX-DR14)", () => {
  it("says nothing while nothing is hidden", () => {
    const handle = renderLayerFilter({ onFilter: () => {} });
    expect(handle.element.textContent).not.toContain("hidden");
  });

  it("states the count and the cause, never a bare number", () => {
    const handle = renderLayerFilter({ onFilter: () => {} });
    handle.setHidden(232);
    expect(handle.element.textContent).toContain(
      "232 nodes hidden: layer filter",
    );
  });

  it("agrees with itself on the singular", () => {
    expect(hiddenText(1)).toBe("1 node hidden: layer filter");
    expect(hiddenText(2)).toBe("2 nodes hidden: layer filter");
  });

  it("announces politely, so a keyboard reader is told what changed", () => {
    const handle = renderLayerFilter({ onFilter: () => {} });
    const live = handle.element.querySelector("#layer-filter-hidden");
    expect(live?.getAttribute("aria-live")).toBe("polite");
  });
});
