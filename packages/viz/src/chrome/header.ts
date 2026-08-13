/**
 * The header (UX-DR6): brand, repo name, stats bar, then the controls.
 *
 * Two of the mockup's controls are not 2.5's to build — the Structure/Heatmap
 * toggle is story 3.4 and the PNG button is story 3.5 — so the header renders
 * **empty slots** for them rather than dead buttons. 3.5's spec says "the
 * export button slot in the header exists since 2.5"; this is that slot, and
 * an empty container is honest where a disabled button that never enables is
 * not. Replay is 2.5's own (FR-12).
 */

import { formatCount, formatInteger, formatLanguages } from "./format.js";
import type { ChromeState, Store } from "./store.js";

export interface HeaderActions {
  onReplay(): void;
}

/** Ids stories 3.4 and 3.5 fill in. Do not rename them. */
export const MODE_SLOT_ID = "mode-slot";
export const EXPORT_SLOT_ID = "export-slot";

export function renderHeader(
  store: Store<ChromeState>,
  actions: HeaderActions,
): HTMLElement {
  const header = document.createElement("header");

  const brand = document.createElement("span");
  brand.className = "brand";
  const brandName = document.createElement("b");
  brandName.textContent = "gitnebula";
  brand.append(brandName);

  const repo = document.createElement("span");
  repo.className = "repo";

  const stats = document.createElement("span");
  stats.className = "stats";

  const spacer = document.createElement("span");
  spacer.className = "spacer";

  const modeSlot = document.createElement("div");
  modeSlot.id = MODE_SLOT_ID;

  const replay = document.createElement("button");
  replay.className = "iconbtn";
  replay.id = "replay";
  replay.title = "Replay layout animation";
  replay.textContent = "↻ replay";
  replay.addEventListener("click", () => actions.onReplay());

  const exportSlot = document.createElement("div");
  exportSlot.id = EXPORT_SLOT_ID;

  header.append(brand, repo, stats, spacer, modeSlot, replay, exportSlot);

  store.subscribe((state) => {
    repo.textContent = state.repoName;
    stats.replaceChildren(
      ...statLines(state).map((text) => {
        const span = document.createElement("span");
        span.textContent = text;
        return span;
      }),
    );
    replay.disabled = state.settling;
  });

  return header;
}

/** The stats bar's six entries, in the mockup's order (FR-13). */
export function statLines(state: ChromeState): string[] {
  const lines = [
    `${formatInteger(state.files)} files`,
    `${formatCount(state.loc)} loc`,
    `${formatInteger(state.modules)} modules`,
    `${formatInteger(state.commits)} commits`,
  ];
  const languages = formatLanguages(state.languages);
  if (languages) lines.push(languages);
  return lines;
}
