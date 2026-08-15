/**
 * The start-here panel (FR-26, UX-DR12): the map's first state is an answer to
 * "what do I read first", not an inventory of everything.
 *
 * The component is a pure view over `StartHereModel` — it computes no ranking,
 * knows no engine and moves no camera. Choosing an entry calls `onSelect` with
 * a node id, and the mount point turns that into the `flyTo` the search box has
 * used since story 3.3; the camera flight, the unfold of a collapsed parent and
 * the `select` event that opens the detail panel are all that path's, not this
 * one's (AD-5, AC-4).
 *
 * It binds **no** keyboard shortcut. `Escape` is story 5.4's scope exit, and
 * one key answered by two handlers in two branches is the collision this wave
 * is coordinating to avoid.
 */

import type {
  StartHereCategory,
  StartHereEntry,
  StartHereModel,
} from "./start-here-model.js";

export const START_HERE_ID = "start-here";
const TITLE_ID = "start-here-title";

export interface StartHereActions {
  /** A row was chosen — the id of the file to fly to. */
  onSelect(id: string): void;
  /** The `×` was pressed. */
  onClose(): void;
}

export interface StartHereHandle {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function renderStartHere(
  model: StartHereModel,
  actions: StartHereActions,
): StartHereHandle {
  const panel = document.createElement("aside");
  panel.id = START_HERE_ID;
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", TITLE_ID);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "sh-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close start here");
  close.addEventListener("click", () => actions.onClose());

  const title = document.createElement("h2");
  title.id = TITLE_ID;
  title.className = "sh-title";
  title.textContent = "start here";

  const subtitle = document.createElement("p");
  subtitle.className = "sh-sub";
  subtitle.textContent = `a reading order for ${model.repoName}`;

  panel.append(
    close,
    title,
    subtitle,
    ...model.categories.map((category) => section(category, actions)),
  );

  // The content is built once. Reopening the panel only unhides it, which is
  // what AC-3's "does not reload the document or re-run the settle" means at
  // this level: nothing here recomputes and nothing here touches the engine.
  return {
    element: panel,
    open() {
      panel.hidden = false;
    },
    close() {
      panel.hidden = true;
    },
    isOpen() {
      return !panel.hidden;
    },
  };
}

function section(
  category: StartHereCategory,
  actions: StartHereActions,
): HTMLElement {
  const element = document.createElement("section");
  element.className = "sh-cat";
  element.dataset.category = category.key;

  const heading = document.createElement("h3");
  heading.textContent = category.title;

  const blurb = document.createElement("p");
  blurb.className = "sh-blurb";
  blurb.textContent = category.blurb;

  element.append(heading, blurb);

  if (category.entries.length === 0) {
    element.append(emptyState(category));
    return element;
  }

  const list = document.createElement("ul");
  list.className = "sh-list";
  for (const entry of category.entries) {
    const item = document.createElement("li");
    item.append(row(entry, actions));
    list.append(item);
  }
  element.append(list);

  // Say what the list is a slice of, rather than implying it is the whole set.
  if (category.total > category.entries.length) {
    const more = document.createElement("p");
    more.className = "sh-more";
    more.textContent = `${category.total - category.entries.length} more below the top ${category.entries.length}`;
    element.append(more);
  }
  return element;
}

function row(entry: StartHereEntry, actions: StartHereActions): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sh-entry";
  button.dataset.id = entry.id;
  // Authored, for the reason `search.ts` documents: a control built from
  // sibling spans is exposed with an empty accessible name.
  button.setAttribute("aria-label", `${entry.path}, ${entry.metricLabel}`);

  const name = document.createElement("span");
  name.className = "sh-name";
  name.textContent = entry.name;

  const path = document.createElement("span");
  path.className = "sh-path";
  path.textContent = entry.path;
  // The span clips long paths from the front; the title puts them back within
  // reach without touching the truncation.
  path.title = entry.path;

  const metric = document.createElement("span");
  metric.className = "sh-metric";
  metric.textContent = entry.metricLabel;

  button.append(name, path, metric);
  button.addEventListener("click", () => actions.onSelect(entry.id));
  return button;
}

/** UX-DR14: a cause and an exit, in that order, one sentence each. */
function emptyState(category: StartHereCategory): HTMLElement {
  const element = document.createElement("p");
  element.className = "sh-empty";

  const cause = document.createElement("span");
  cause.className = "sh-cause";
  cause.textContent = category.empty.cause;

  const exit = document.createElement("span");
  exit.className = "sh-exit";
  exit.textContent = category.empty.exit;

  element.append(cause, exit);
  return element;
}
