/**
 * The layer filter (story 5.3, FR-28): five multi-select toggles that decide
 * which layers the map draws.
 *
 * Styled after `chrome/mode-toggle.ts` and built the same way (UX-DR6): a
 * `role="group"` of `aria-pressed` buttons rather than a menu, so **the active
 * set is visible without opening anything** (UX-DR13). The one deliberate
 * difference from the mode toggle is multi-select — mode is one-of-two, a
 * layer filter is any-of-five — which is also why `aria-pressed` is right here
 * and a radio group would not be.
 *
 * The control only *asks*. The engine owns the filter and publishes it on its
 * `filter` event, which is where this reads its state back from — the same
 * shape story 3.4 used for the mode toggle, so a filter changed anywhere
 * (a test, the empty state's reset, a future control) reaches these buttons.
 */

import type { Layer } from "@gitnebula/contract";

import { ALL_LAYERS, LAYER_LABEL, LAYER_COLOR } from "../engine/index.js";

export interface LayerFilterActions {
  /** The full surviving set after the click, never a delta. */
  onFilter(layers: readonly Layer[]): void;
}

export interface LayerFilterHandle {
  readonly element: HTMLElement;
  /** Reflect the engine's filter. Called from the engine's `filter` event. */
  setLayers(layers: readonly Layer[]): void;
  /**
   * State how many nodes this filter is hiding, next to the toggles that did
   * it (UX-DR14: name the cause).
   *
   * The count is **this** filter's alone. Story 5.4's connected-only filter
   * states its own count with its own cause, by agreement between the two
   * stories' owners — a combined "N of M shown" total would name neither.
   */
  setHidden(count: number): void;
}

/** The id the empty state's reset button and the tests reach the group by. */
export const LAYER_FILTER_ID = "layer-filter";

export function renderLayerFilter(
  actions: LayerFilterActions,
  initial: readonly Layer[] = ALL_LAYERS,
): LayerFilterHandle {
  const group = document.createElement("div");
  group.className = "layers";
  group.id = LAYER_FILTER_ID;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Layer filter");

  let active: ReadonlySet<Layer> = new Set(initial);

  const buttons = ALL_LAYERS.map((layer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `layer-${layer}`;
    // The swatch comes from the engine's palette, so a toggle and the node it
    // governs cannot drift apart — the same reason the legend reads it.
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = LAYER_COLOR[layer];
    const label = document.createElement("span");
    label.textContent = LAYER_LABEL[layer];
    button.append(dot, label);
    button.addEventListener("click", () => {
      const next = new Set(active);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      // Emitted in ALL_LAYERS order so the engine, the store and this control
      // never disagree about what "the same filter" means.
      actions.onFilter(ALL_LAYERS.filter((entry) => next.has(entry)));
    });
    group.append(button);
    return { layer, button };
  });

  const hidden = document.createElement("span");
  hidden.className = "hidden-count";
  hidden.id = "layer-filter-hidden";
  // Polite rather than assertive: the reader caused this, so it is a
  // confirmation and not an interruption.
  hidden.setAttribute("aria-live", "polite");
  group.append(hidden);

  const handle: LayerFilterHandle = {
    element: group,
    setHidden(count) {
      hidden.textContent = count === 0 ? "" : hiddenText(count);
    },
    setLayers(layers) {
      active = new Set(layers);
      for (const entry of buttons) {
        const on = active.has(entry.layer);
        entry.button.setAttribute("aria-pressed", String(on));
        // Belt and braces for the visible-without-a-menu half of UX-DR13:
        // `aria-pressed` carries it for assistive technology, the class
        // carries it for everyone else, and neither is the only signal.
        entry.button.classList.toggle("off", !on);
      }
    },
  };

  handle.setLayers(initial);
  handle.setHidden(0);
  return handle;
}

/** "N nodes hidden: layer filter" — the count and its cause, never a bare number. */
export function hiddenText(count: number): string {
  return `${count} ${count === 1 ? "node" : "nodes"} hidden: layer filter`;
}
