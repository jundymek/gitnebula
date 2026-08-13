/**
 * The search box (FR-18, UX-DR8/11): persistent, top-left, `⌘K`.
 *
 * Keyboard model, which is the whole feature:
 *
 * - `Cmd/Ctrl+K` or `/` focuses it from anywhere on the page;
 * - typing filters to the top 7 fuzzy matches over node ids;
 * - `↑`/`↓` move the active result, `Enter` flies to it;
 * - `Esc` closes the list and blurs, returning the keyboard to the map.
 *
 * Accessibility follows the ARIA combobox pattern rather than being bolted on:
 * the input owns a listbox, `aria-activedescendant` names the active option,
 * and the results are announced as they change. Arrowing through a list that a
 * screen reader cannot follow is not navigation, and FR-18 is a navigation
 * requirement.
 *
 * The `/` shortcut is deliberately ignored while the user is typing in a field
 * — otherwise a slash can never be typed into a path query, which is the most
 * likely thing anyone searches for in this tool.
 */

import { fuzzySearch, type EngineNode } from "../engine/index.js";

/** FR-18's cap. */
export const SEARCH_RESULT_LIMIT = 7;

export interface SearchActions {
  /** Fly the camera to a node and select it. */
  readonly onSelect: (id: string) => void;
}

export interface SearchBox {
  readonly element: HTMLElement;
  /** The node set to search. Set once the document is loaded. */
  setNodes(nodes: readonly EngineNode[]): void;
  /** Focus the input and select whatever is in it. */
  focus(): void;
  /** Close the results and blur. */
  close(): void;
  /** Detach the document-level key listener. */
  destroy(): void;
}

/** True when a keystroke is already going somewhere that wants text. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function createSearchBox(actions: SearchActions): SearchBox {
  let nodes: readonly EngineNode[] = [];
  let results: EngineNode[] = [];
  let activeIndex = -1;

  const element = document.createElement("div");
  element.className = "search";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.placeholder = "search files and modules";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", "search files and modules");
  // `search` inputs get a native clear button that steals the Escape key in
  // some browsers; the list's own Escape handling is the one we want.
  input.autocomplete = "off";

  const listId = "search-results";
  const list = document.createElement("ul");
  list.className = "search-results";
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.setAttribute("aria-controls", listId);

  const hint = document.createElement("kbd");
  hint.className = "search-hint";
  hint.textContent = "⌘K";

  // A live region so the result count reaches a screen reader; the list itself
  // is announced through `aria-activedescendant` as the user arrows.
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  element.append(input, hint, list, status);

  function optionId(index: number): string {
    return `search-result-${index}`;
  }

  function render(): void {
    list.replaceChildren();
    for (const [index, node] of results.entries()) {
      const option = document.createElement("li");
      option.id = optionId(index);
      option.className = "search-result";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === activeIndex));
      // The name is authored rather than left to name-from-content. `option`
      // is children-presentational per ARIA, so the two spans below should
      // flatten into a name on their own — they do not. Chrome's accessibility
      // tree gives every option an empty name and exposes both spans as
      // separate generic nodes, and VoiceOver duly reads a result as "menu
      // item, group" with no path in it at all. An authored name is the one
      // thing no engine has to infer. It also puts a separator between the two
      // spans, which name-from-content would not: their text runs together as
      // "assemble.tsfile".
      option.setAttribute("aria-label", `${node.path}, ${node.kind}`);
      if (index === activeIndex) option.classList.add("is-active");

      const name = document.createElement("span");
      name.className = "search-result-name";
      name.textContent = node.path;
      // The span clips long paths from the front, so the directories a result
      // lives in are on screen but unreadable. The title puts them back within
      // reach without touching the truncation. It is the sighted half of the
      // fix and belongs on the element that clips; the `aria-label` above is
      // the other half. A title on the option instead would have become its
      // accessible description and been read out after the name.
      name.title = node.path;
      const kind = document.createElement("span");
      kind.className = "search-result-kind";
      kind.textContent = node.kind;
      option.append(name, kind);

      // `mousedown` rather than `click`: the input's blur fires first on a
      // click and would close the list before the selection is read.
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(index);
      });
      list.append(option);
    }

    const open = results.length > 0;
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (activeIndex >= 0 && activeIndex < results.length) {
      input.setAttribute("aria-activedescendant", optionId(activeIndex));
    } else {
      input.removeAttribute("aria-activedescendant");
    }
    status.textContent = open
      ? `${results.length} result${results.length === 1 ? "" : "s"}`
      : input.value.trim().length > 0
        ? "no results"
        : "";
  }

  function search(query: string): void {
    results = fuzzySearch(
      nodes,
      query,
      (node) => node.id,
      SEARCH_RESULT_LIMIT,
    ).map((match) => match.item);
    // The first result is active from the start, so Enter works without
    // arrowing — the common case is "type three letters and hit Enter".
    activeIndex = results.length > 0 ? 0 : -1;
    render();
  }

  function move(delta: number): void {
    if (results.length === 0) return;
    // Wraps, so ↑ from the first result reaches the last one.
    activeIndex = (activeIndex + delta + results.length) % results.length;
    render();
  }

  function choose(index: number): void {
    const node = results[index];
    if (!node) return;
    actions.onSelect(node.id);
    close();
  }

  function close(): void {
    results = [];
    activeIndex = -1;
    render();
    input.blur();
  }

  input.addEventListener("input", () => search(input.value));

  input.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter":
        if (activeIndex >= 0) {
          event.preventDefault();
          choose(activeIndex);
        }
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  });

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      focus();
      return;
    }
    // Bare `/` only when the keystroke is not already destined for a field,
    // and not when it carries a modifier (Ctrl+/ is a browser shortcut).
    if (
      event.key === "/" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      focus();
    }
  };

  function focus(): void {
    input.focus();
    input.select();
  }

  document.addEventListener("keydown", onDocumentKeyDown);

  return {
    element,
    setNodes(next) {
      nodes = next;
    },
    focus,
    close,
    destroy() {
      document.removeEventListener("keydown", onDocumentKeyDown);
    },
  };
}
