/**
 * The scope bar (story 5.4, FR-30): what the frame is currently showing, and
 * how to get back out of it.
 *
 * Four jobs, all of them stated rather than implied:
 *
 * - **the scope is always visible while one is active** (AC-2) — a user can
 *   never be scoped without being able to tell, or without a way to leave;
 * - **the connected-only toggle** and the count of what it hid (AC-3);
 * - **the number is always named with its cause** (UX-DR14) — "hidden: no
 *   dependencies", never a bare total. 5.3's layer filter prints its own line
 *   with its own cause, and the two are deliberately not summed;
 * - **the way back after a search left the scope** (AC-5).
 *
 * Copy follows the convention 5.5's owner set for the epic's empty states: a
 * cause line, then an exit line, lowercase and terse, in the register of the
 * hint overlay, with the count stated whenever there is one — a number is what
 * makes an empty state read as a measurement rather than as a failure. The
 * strings are carried here rather than imported from that story's module: it
 * does not exist on this branch, neither story depends on the other, and an
 * import would leave this branch uncompilable. Folding them together is
 * wave-B tidy-up (story 5.6).
 *
 * Pure DOM. It reaches the map only through the `GraphEngine` interface it is
 * handed (AD-5); `boundary.test.ts` holds that line.
 */

export interface ScopeBarActions {
  /** Leave the active scope. */
  onLeaveScope(): void;
  /** Return to the scope a search flew out of. */
  onReturnToScope(): void;
  onConnectedOnly(connectedOnly: boolean): void;
}

/** Everything the bar draws itself from. */
export interface ScopeBarState {
  readonly scopeId: string | null;
  readonly connectedOnly: boolean;
  readonly hiddenByDegree: number;
  /** The scope a search left, offered as a way back, or null. */
  readonly leftScopeId: string | null;
  /** True when the active scope has nothing left to draw. */
  readonly scopeIsEmpty: boolean;
}

export interface ScopeBarHandle {
  readonly element: HTMLElement;
  update(state: ScopeBarState): void;
}

export const SCOPE_BAR_ID = "scope-bar";

/** "3 files" / "1 file" — a count that reads as English, not as a variable. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function renderScopeBar(actions: ScopeBarActions): ScopeBarHandle {
  const element = document.createElement("div");
  element.className = "scope-bar";
  element.id = SCOPE_BAR_ID;
  // A live region: the scope changes from a double click on the canvas and
  // from a search arrival, neither of which moves focus, so a screen-reader
  // user would otherwise have no way to learn the frame just changed.
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  const scopeLine = document.createElement("p");
  scopeLine.className = "scope-bar-scope";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "scope-bar-leave";
  leave.textContent = "leave scope";
  leave.addEventListener("click", () => actions.onLeaveScope());

  const connected = document.createElement("button");
  connected.type = "button";
  connected.className = "scope-bar-connected";
  connected.textContent = "connected only";
  connected.addEventListener("click", () =>
    // The button only asks; the engine owns the state and publishes it back on
    // `scope`, which is where this button reads it from. Same shape as the
    // isolate button in story 3.4's panel.
    actions.onConnectedOnly(connected.getAttribute("aria-pressed") !== "true"),
  );

  const hiddenLine = document.createElement("p");
  hiddenLine.className = "scope-bar-hidden";

  const leftLine = document.createElement("p");
  leftLine.className = "scope-bar-left";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "scope-bar-back";
  back.addEventListener("click", () => actions.onReturnToScope());

  element.append(scopeLine, leave, connected, hiddenLine, leftLine, back);

  const handle: ScopeBarHandle = {
    element,
    update(state) {
      const scoped = state.scopeId !== null;
      // AC-2: while a scope is active the indicator and its exit are on
      // screen, unconditionally. The whole bar hides only when there is
      // nothing at all to say.
      scopeLine.hidden = !scoped;
      leave.hidden = !scoped;
      if (scoped) {
        scopeLine.textContent = `scoped to ${state.scopeId}`;
        leave.setAttribute("aria-label", `leave the ${state.scopeId} scope`);
      }

      connected.setAttribute("aria-pressed", String(state.connectedOnly));

      // The count always arrives with its cause. 5.3's layer filter prints its
      // own line for its own cause; the two overlap and are not additive, so
      // neither of us claims a total.
      if (state.connectedOnly && state.hiddenByDegree > 0) {
        hiddenLine.hidden = false;
        hiddenLine.textContent = `${plural(
          state.hiddenByDegree,
          "node",
        )} hidden: no dependencies`;
      } else if (state.scopeIsEmpty && state.connectedOnly) {
        // Only claimed when connected-only is actually on. A scope emptied by
        // story 5.3's layer filter has a different cause, and naming the wrong
        // lever is worse than naming none — it sends the reader to a control
        // that will not bring their nodes back. That filter states its own
        // cause in its own line, which is the whole point of UX-DR14.
        hiddenLine.hidden = false;
        hiddenLine.textContent =
          "every node in this scope is hidden by connected-only";
      } else {
        hiddenLine.hidden = true;
        hiddenLine.textContent = "";
      }

      // AC-5's way back. The affordance IS the exit sentence — the button says
      // where it goes, rather than sitting unlabelled beside a line of prose.
      const offerReturn = !scoped && state.leftScopeId !== null;
      leftLine.hidden = !offerReturn;
      back.hidden = !offerReturn;
      if (offerReturn) {
        leftLine.textContent = "left the scope to reach your search result";
        back.textContent = `return to ${state.leftScopeId}`;
      }

      // The bar itself is ALWAYS on screen, because it carries the only
      // control that can switch connected-only on. Hiding it while idle made
      // that filter unreachable from the default view: a user had to discover
      // drill-down, enter a scope, and only then could they find the toggle
      // for a filter that has nothing to do with scoping. Its parts come and
      // go (see above); the bar does not.
      element.hidden = false;
    },
  };

  handle.update({
    scopeId: null,
    connectedOnly: false,
    hiddenByDegree: 0,
    leftScopeId: null,
    scopeIsEmpty: false,
  });
  return handle;
}
