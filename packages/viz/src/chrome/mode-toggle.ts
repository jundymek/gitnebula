/**
 * The Structure ↔ Heatmap toggle (FR-21, mockup header) that fills the
 * `#mode-slot` story 2.5 left empty.
 *
 * It is a pair of `aria-pressed` buttons inside a `role="group"`, which is the
 * mockup's markup and also the accessible one: a radio group would demand
 * arrow-key roving focus for two controls that read perfectly well as two
 * toggles.
 *
 * The heat ramp itself is NOT here. `render.ts`'s `nodeColor` has carried the
 * mockup's cold→hot interpolation since 2.5; this component only moves the
 * engine's mode, so there is one copy of the formula and the canvas is its
 * only consumer.
 */

import type { ViewMode } from "../engine/index.js";

export interface ModeToggleActions {
  onMode(mode: ViewMode): void;
}

export interface ModeToggleHandle {
  readonly element: HTMLElement;
  /** Reflect the engine's mode. Called from the engine's `mode` event. */
  setMode(mode: ViewMode): void;
}

/** Label per mode, the mockup's wording. */
export const MODE_LABEL: Readonly<Record<ViewMode, string>> = {
  structure: "structure",
  heat: "change heatmap",
};

export function renderModeToggle(
  actions: ModeToggleActions,
  initial: ViewMode = "structure",
): ModeToggleHandle {
  const group = document.createElement("div");
  group.className = "modes";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "View mode");

  const buttons = (["structure", "heat"] as const).map((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `mode-${mode}`;
    button.textContent = MODE_LABEL[mode];
    button.addEventListener("click", () => actions.onMode(mode));
    group.append(button);
    return { mode, button };
  });

  const handle: ModeToggleHandle = {
    element: group,
    setMode(mode) {
      for (const entry of buttons) {
        entry.button.setAttribute("aria-pressed", String(entry.mode === mode));
      }
    },
  };

  handle.setMode(initial);
  return handle;
}
