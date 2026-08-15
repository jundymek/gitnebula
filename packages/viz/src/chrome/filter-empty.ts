/**
 * The layer filter's empty state (story 5.3, AC-4, UX-DR14).
 *
 * A filter that leaves nothing on screen must not read as a broken renderer.
 * The convention — agreed with story 5.5's owner, who establishes it for the
 * epic — is UX-DR14 read literally: **a cause and an exit, in that order, one
 * sentence each.** Never a bare em dash, never "no data".
 *
 * The strings live here rather than being imported from 5.5's
 * `chrome/empty-state.ts` because that module does not exist on
 * `epic/5-onboarding` until its PR merges, and the two stories are
 * `depends_on: []` in both directions. Consolidating is a wave-B follow-up
 * (story 5.6), not a cross-branch dependency to force now.
 */

export interface FilterEmptyActions {
  /** Switch every layer back on. The AC's "one-click way back". */
  onReset(): void;
}

export interface FilterEmptyHandle {
  readonly element: HTMLElement;
  /**
   * Show the block when the filter has left nothing on screen.
   *
   * The trigger is "nothing survives", which is a superset of AC-4's literal
   * "every layer excluded": a repository whose nodes are all `backend`, with
   * `backend` switched off, is the same dead map and deserves the same
   * sentence. The count that names the cause in the non-empty case belongs to
   * the filter control, not here.
   *
   * `hidden` is what makes this block honest about **its own** cause: a
   * document that is empty on its own account (no nodes at all) is a different
   * cause with a different sentence, and claiming the filter did it would be a
   * lie. So the block appears only when the filter is the reason.
   */
  update(state: { readonly visible: number; readonly hidden: number }): void;
}

export const FILTER_EMPTY_ID = "filter-empty";
export const FILTER_EMPTY_CAUSE = "no nodes match the active filters";
export const FILTER_EMPTY_EXIT =
  "turn a layer back on to see the rest of the map";

export function renderFilterEmpty(
  actions: FilterEmptyActions,
): FilterEmptyHandle {
  const block = document.createElement("div");
  block.id = FILTER_EMPTY_ID;
  block.className = "empty";
  // A live region, so a reader who switched the last layer off with the
  // keyboard is told what happened rather than being left on a silent canvas.
  block.setAttribute("role", "status");
  block.hidden = true;

  const cause = document.createElement("p");
  cause.className = "cause";
  cause.textContent = FILTER_EMPTY_CAUSE;

  const exit = document.createElement("p");
  exit.className = "exit";
  exit.textContent = FILTER_EMPTY_EXIT;

  const reset = document.createElement("button");
  reset.type = "button";
  reset.id = "filter-reset";
  reset.textContent = "show all layers";
  reset.addEventListener("click", () => actions.onReset());

  block.append(cause, exit, reset);

  return {
    element: block,
    update({ visible, hidden }) {
      block.hidden = visible > 0 || hidden === 0;
    },
  };
}
