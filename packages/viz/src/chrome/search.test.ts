// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSearchBox,
  SEARCH_RESULT_LIMIT,
  type SearchBox,
} from "./search.js";
import type { EngineNode } from "../engine/index.js";

function node(id: string, kind: "module" | "file" = "file"): EngineNode {
  return {
    id,
    kind,
    parent: kind === "file" ? "src/" : null,
    path: id,
    layer: "backend",
    loc: 10,
    churn: 0.1,
    commits: 1,
    authors: 1,
    lastChangedAt: null,
    description: null,
    hot: false,
    radius: 3,
  };
}

const NODES = [
  node("src/engine/graph.ts"),
  node("src/engine/render.ts"),
  node("src/engine/layout.ts"),
  node("src/chrome/legend.ts"),
  node("src/chrome/panel.ts"),
  node("src/cli/index.ts"),
  node("src/deps/python.ts"),
  node("src/githist/churn.ts"),
  node("src/", "module"),
];

let box: SearchBox;
let selected: string[];

function input(): HTMLInputElement {
  return box.element.querySelector("input")!;
}

function list(): HTMLUListElement {
  return box.element.querySelector("ul")!;
}

function options(): HTMLElement[] {
  return [...list().querySelectorAll("li")];
}

function type(value: string): void {
  input().value = value;
  input().dispatchEvent(new Event("input"));
}

function press(key: string, init: KeyboardEventInit = {}): void {
  input().dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
}

beforeEach(() => {
  selected = [];
  box = createSearchBox({ onSelect: (id) => selected.push(id) });
  box.setNodes(NODES);
  document.body.append(box.element);
});

afterEach(() => {
  box.destroy();
  document.body.replaceChildren();
});

describe("the search box itself", () => {
  it("is present and shows the shortcut hint", () => {
    expect(box.element.querySelector("kbd")?.textContent).toBe("⌘K");
  });

  it("starts closed with no results", () => {
    expect(list().hidden).toBe(true);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("declares the ARIA combobox relationship to its listbox", () => {
    expect(input().getAttribute("role")).toBe("combobox");
    expect(list().getAttribute("role")).toBe("listbox");
    expect(input().getAttribute("aria-controls")).toBe(list().id);
  });
});

describe("filtering", () => {
  it("shows fuzzy matches as the user types", () => {
    type("graph");
    expect(options()).toHaveLength(1);
    expect(options()[0]!.textContent).toContain("src/engine/graph.ts");
    expect(list().hidden).toBe(false);
  });

  it("matches a subsequence, not just a substring", () => {
    type("engrender");
    expect(options()[0]!.textContent).toContain("render.ts");
  });

  it("caps the list at seven results (FR-18)", () => {
    // "s" matches every fixture id.
    type("s");
    expect(options().length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT);
    expect(options()).toHaveLength(SEARCH_RESULT_LIMIT);
  });

  it("closes and reports when nothing matches", () => {
    type("zzzzz");
    expect(options()).toHaveLength(0);
    expect(list().hidden).toBe(true);
    expect(box.element.textContent).toContain("no results");
  });

  it("clears the list when the query is emptied", () => {
    type("graph");
    type("");
    expect(list().hidden).toBe(true);
  });

  it("announces the result count politely", () => {
    const status = box.element.querySelector("[role=status]")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    type("engine");
    expect(status.textContent).toMatch(/\d+ results?/);
  });

  it("labels a single result in the singular", () => {
    type("graph");
    expect(box.element.querySelector("[role=status]")!.textContent).toBe(
      "1 result",
    );
  });
});

describe("the full path of a truncated result (FR-18)", () => {
  // Long enough that `.search-result-name` clips it in the real listbox; the
  // basename survives, the directories do not — which is the whole reason the
  // path has to be readable some other way.
  const LONG = "docs/adr/0006-viewport-scoped-semantic-unfold-and-hot-spot.md";

  function name(option: HTMLElement): HTMLElement {
    return option.querySelector(".search-result-name")!;
  }

  it("exposes a clipped path in full as a title", () => {
    box.setNodes([node(LONG)]);
    type("unfold");
    expect(options()).toHaveLength(1);
    expect(name(options()[0]!).title).toBe(LONG);
  });

  it("titles every result, not only the long one", () => {
    type("s");
    expect(options().length).toBeGreaterThan(1);
    for (const option of options()) {
      expect(name(option).title).toBe(name(option).textContent);
    }
  });

  it("keeps the title off the option itself", () => {
    // The title belongs to the span that clips, not to the `role=option`
    // ancestor — there it would become the option's accessible description and
    // be read out after the name.
    type("graph");
    expect(options()[0]!.hasAttribute("title")).toBe(false);
  });

  it("names each option outright, path first", () => {
    // Name-from-content does not happen here: Chrome leaves a `role=option`
    // built from two spans with an empty accessible name and exposes the spans
    // separately, so VoiceOver announces "menu item, group" and no path.
    box.setNodes([node(LONG)]);
    type("unfold");
    expect(options()[0]!.getAttribute("aria-label")).toBe(`${LONG}, file`);
  });

  it("separates the path from the kind in the name", () => {
    // Without the separator the two spans run together as "assemble.tsfile".
    type("graph");
    expect(options()[0]!.getAttribute("aria-label")).toBe(
      "src/engine/graph.ts, file",
    );
    expect(options()[0]!.textContent).toBe("src/engine/graph.tsfile");
  });

  it("names a module option by its kind too", () => {
    box.setNodes([node("src/", "module")]);
    type("src");
    expect(options()[0]!.getAttribute("aria-label")).toBe("src/, module");
  });

  it("does not disturb the ARIA wiring it sits inside", () => {
    type("engine");
    const active = options()[0]!;
    expect(active.getAttribute("role")).toBe("option");
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(active.id);
  });
});

describe("keyboard navigation", () => {
  it("activates the first result so Enter works without arrowing", () => {
    type("engine");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(
      options()[0]!.id,
    );
  });

  it("moves the active result with the arrow keys", () => {
    type("engine");
    press("ArrowDown");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    press("ArrowUp");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("wraps from the first result to the last", () => {
    type("engine");
    const count = options().length;
    expect(count).toBeGreaterThan(1);
    press("ArrowUp");
    expect(options()[count - 1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("selects the active result on Enter", () => {
    type("graph");
    press("Enter");
    expect(selected).toEqual(["src/engine/graph.ts"]);
  });

  it("closes the list after selecting", () => {
    type("graph");
    press("Enter");
    expect(list().hidden).toBe(true);
  });

  it("does nothing on Enter with no results", () => {
    type("zzzzz");
    press("Enter");
    expect(selected).toEqual([]);
  });

  it("closes and blurs on Escape", () => {
    input().focus();
    type("graph");
    press("Escape");
    expect(list().hidden).toBe(true);
    expect(document.activeElement).not.toBe(input());
  });

  it("selects a result clicked with the mouse", () => {
    type("engine");
    options()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selected).toHaveLength(1);
  });
});

describe("global shortcuts (UX-DR8)", () => {
  function pressDocument(key: string, init: KeyboardEventInit = {}): void {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  }

  it("focuses on Cmd+K", () => {
    pressDocument("k", { metaKey: true });
    expect(document.activeElement).toBe(input());
  });

  it("focuses on Ctrl+K", () => {
    pressDocument("k", { ctrlKey: true });
    expect(document.activeElement).toBe(input());
  });

  it("focuses on a bare slash", () => {
    pressDocument("/");
    expect(document.activeElement).toBe(input());
  });

  it("does not steal a slash typed into a field", () => {
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();

    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    const prevented = vi.spyOn(event, "preventDefault");
    other.dispatchEvent(event);

    // The user is typing a path into some field — a slash must reach it, or
    // "src/engine" can never be typed anywhere on the page.
    expect(prevented).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(other);
  });

  it("does not hijack Ctrl+/ , which belongs to the browser", () => {
    document.body.focus();
    pressDocument("/", { ctrlKey: true });
    expect(document.activeElement).not.toBe(input());
  });

  it("stops listening once destroyed", () => {
    box.destroy();
    document.body.focus();
    pressDocument("k", { metaKey: true });
    expect(document.activeElement).not.toBe(input());
  });
});
