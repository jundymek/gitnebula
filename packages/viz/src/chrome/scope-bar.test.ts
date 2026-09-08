// @vitest-environment jsdom
/**
 * Story 5.4's chrome half. AC-2's central promise is asserted here: whenever a
 * scope is active, the indicator and a way out are both on screen — a user can
 * never be scoped without being able to tell, or without being able to leave.
 */
import { describe, expect, it, vi } from "vitest";

import { renderScopeBar, type ScopeBarState } from "./scope-bar.js";
import { SCOPE_BAR_BACK_TESTID, SCOPE_BAR_HIDDEN_TESTID } from "./testids.js";

const IDLE: ScopeBarState = {
  scopeId: null,
  connectedOnly: false,
  hiddenByDegree: 0,
  leftScopeId: null,
  scopeIsEmpty: false,
};

function bar(actions: Partial<Parameters<typeof renderScopeBar>[0]> = {}) {
  return renderScopeBar({
    onLeaveScope: vi.fn(),
    onReturnToScope: vi.fn(),
    onConnectedOnly: vi.fn(),
    ...actions,
  });
}

/**
 * Story 6.5: the two readouts are reached by their stable hook, not by their
 * styling class. `.scope-bar-hidden` and `.scope-bar-back` are what the
 * stylesheet paints; what these tests are actually about is the sentence the
 * bar composes and whether it is on screen, and that survives a restyle.
 */
const HIDDEN_LINE = `[data-testid="${SCOPE_BAR_HIDDEN_TESTID}"]`;
const BACK_BUTTON = `[data-testid="${SCOPE_BAR_BACK_TESTID}"]`;

function text(element: HTMLElement, selector: string): string {
  const found = element.querySelector<HTMLElement>(selector);
  if (!found || found.hidden) return "";
  return found.textContent ?? "";
}

describe("AC-2 — the scope is always visible while one is active", () => {
  it("names the scope and offers a way out", () => {
    const handle = bar();
    handle.update({ ...IDLE, scopeId: "libs/langgraph/" });

    expect(text(handle.element, ".scope-bar-scope")).toContain(
      "libs/langgraph/",
    );
    expect(handle.element.hidden).toBe(false);
    const leave = handle.element.querySelector<HTMLElement>(".scope-bar-leave");
    expect(leave?.hidden).toBe(false);
  });

  it("hides the scope line when nothing is scoped", () => {
    const handle = bar();
    handle.update(IDLE);
    expect(text(handle.element, ".scope-bar-scope")).toBe("");
    expect(
      handle.element.querySelector<HTMLElement>(".scope-bar-leave")?.hidden,
    ).toBe(true);
  });

  it("keeps the connected-only toggle reachable in the default view", () => {
    // The bar carries the ONLY control that switches connected-only on.
    // Hiding the whole bar while idle made that filter unreachable from the
    // default view: a user had to discover drill-down and enter a scope before
    // they could find a toggle that has nothing to do with scoping.
    const handle = bar();
    handle.update(IDLE);
    expect(handle.element.hidden).toBe(false);
    const toggle = handle.element.querySelector<HTMLElement>(
      ".scope-bar-connected",
    );
    expect(toggle?.hidden).toBe(false);
  });

  it("can switch connected-only on straight from the idle state", () => {
    const onConnectedOnly = vi.fn();
    const handle = bar({ onConnectedOnly });
    handle.update(IDLE);
    handle.element
      .querySelector<HTMLButtonElement>(".scope-bar-connected")!
      .click();
    expect(onConnectedOnly).toHaveBeenCalledWith(true);
  });

  it("asks to leave the scope when the exit is pressed", () => {
    const onLeaveScope = vi.fn();
    const handle = bar({ onLeaveScope });
    handle.update({ ...IDLE, scopeId: "libs/langgraph/" });
    handle.element
      .querySelector<HTMLButtonElement>(".scope-bar-leave")!
      .click();
    expect(onLeaveScope).toHaveBeenCalledOnce();
  });

  it("is a live region, because nothing here moves focus", () => {
    // The scope changes from a double click on the canvas and from a search
    // arrival; without a live region a screen-reader user is never told.
    const handle = bar();
    expect(handle.element.getAttribute("role")).toBe("status");
    expect(handle.element.getAttribute("aria-live")).toBe("polite");
  });
});

describe("AC-3 — the hidden count always names its cause (UX-DR14)", () => {
  it("states the count and why those nodes went", () => {
    const handle = bar();
    handle.update({ ...IDLE, connectedOnly: true, hiddenByDegree: 232 });
    expect(text(handle.element, HIDDEN_LINE)).toBe(
      "232 nodes hidden: no dependencies",
    );
  });

  it("never prints a bare total without its cause", () => {
    const handle = bar();
    handle.update({ ...IDLE, connectedOnly: true, hiddenByDegree: 232 });
    const line = text(handle.element, HIDDEN_LINE);
    expect(line).toMatch(/no dependencies/);
  });

  it("reads as English for a single node", () => {
    const handle = bar();
    handle.update({ ...IDLE, connectedOnly: true, hiddenByDegree: 1 });
    expect(text(handle.element, HIDDEN_LINE)).toBe(
      "1 node hidden: no dependencies",
    );
  });

  it("says nothing when the filter is on but hid nothing", () => {
    const handle = bar();
    handle.update({ ...IDLE, connectedOnly: true, hiddenByDegree: 0 });
    expect(text(handle.element, HIDDEN_LINE)).toBe("");
  });

  it("names the cause when the filter emptied the scope", () => {
    const handle = bar();
    handle.update({
      ...IDLE,
      scopeId: "libs/langgraph/",
      connectedOnly: true,
      hiddenByDegree: 0,
      scopeIsEmpty: true,
    });
    expect(text(handle.element, HIDDEN_LINE)).toBe(
      "every node in this scope is hidden by connected-only",
    );
  });

  it("does NOT blame connected-only for a scope another filter emptied", () => {
    // Fourth Codex pass: naming the wrong lever is worse than naming none —
    // it sends the reader to a control that cannot bring their nodes back.
    // Story 5.3's layer filter states its own cause in its own line.
    const handle = bar();
    handle.update({
      ...IDLE,
      scopeId: "libs/langgraph/",
      connectedOnly: false,
      scopeIsEmpty: true,
    });
    expect(text(handle.element, HIDDEN_LINE)).toBe("");
  });

  it("carries aria-pressed on the toggle (UX-DR13)", () => {
    const handle = bar();
    const toggle = handle.element.querySelector(".scope-bar-connected")!;
    handle.update(IDLE);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    handle.update({ ...IDLE, connectedOnly: true });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for the opposite of what is currently pressed", () => {
    const onConnectedOnly = vi.fn();
    const handle = bar({ onConnectedOnly });
    handle.update({ ...IDLE, connectedOnly: true });
    handle.element
      .querySelector<HTMLButtonElement>(".scope-bar-connected")!
      .click();
    expect(onConnectedOnly).toHaveBeenCalledWith(false);
  });
});

describe("AC-5 — the way back after a search left the scope", () => {
  it("states that the scope was left and offers a one-click return", () => {
    const handle = bar();
    handle.update({ ...IDLE, leftScopeId: "libs/langgraph/" });

    expect(text(handle.element, ".scope-bar-left")).toContain("left the scope");
    // The affordance IS the exit sentence: the button says where it goes.
    expect(text(handle.element, BACK_BUTTON)).toBe("return to libs/langgraph/");
  });

  it("returns to the scope when the button is pressed", () => {
    const onReturnToScope = vi.fn();
    const handle = bar({ onReturnToScope });
    handle.update({ ...IDLE, leftScopeId: "libs/langgraph/" });
    handle.element.querySelector<HTMLButtonElement>(BACK_BUTTON)!.click();
    expect(onReturnToScope).toHaveBeenCalledOnce();
  });

  it("drops the offer once a scope is active again", () => {
    const handle = bar();
    handle.update({ ...IDLE, leftScopeId: "libs/langgraph/" });
    handle.update({
      ...IDLE,
      scopeId: "libs/langgraph/",
      leftScopeId: "libs/langgraph/",
    });
    expect(text(handle.element, BACK_BUTTON)).toBe("");
  });
});
