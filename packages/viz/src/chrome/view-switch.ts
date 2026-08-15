/**
 * The 2D / 3D view switch (story 5.7, FR-32).
 *
 * A plain DOM control that reports which view the reader asked for. It knows
 * nothing about engines: chrome may not name a canvas or construct an engine
 * (`boundary.test.ts`), so swapping the implementation is `app.ts`'s job and
 * this only says what was clicked — exactly the shape the existing `onReplay`
 * action has.
 *
 * **2D is pressed by default** (AC-1). When 3D is unavailable the control is
 * *disabled with the reason attached* rather than hidden or silently inert: a
 * button that does nothing when clicked is worse than one that explains why it
 * is off, and AC-5 requires the reason to be stated somewhere the reader can
 * find it.
 */

export type ViewSwitchKind = "2d" | "3d";

export interface ViewSwitchOptions {
  /** The view currently shown. Defaults to 2D. */
  readonly current?: ViewSwitchKind;
  /**
   * Why 3D cannot be offered, or null when it can. A string here disables the
   * 3D button and becomes its tooltip and its accessible description.
   */
  readonly unavailableReason?: string | null;
  readonly onChange: (view: ViewSwitchKind) => void;
}

export interface ViewSwitchHandle {
  readonly element: HTMLElement;
  /** Reflect the view actually in use — including a 3D request that fell back. */
  setCurrent(view: ViewSwitchKind): void;
  /** Disable 3D with a stated reason, or re-enable it with null. */
  setUnavailable(reason: string | null): void;
  getCurrent(): ViewSwitchKind;
}

export const VIEW_SWITCH_ID = "view-switch";
/** Where the reason is announced when 3D is unavailable (AC-5). */
export const VIEW_SWITCH_REASON_ID = "view-switch-reason";

export function renderViewSwitch(options: ViewSwitchOptions): ViewSwitchHandle {
  let current: ViewSwitchKind = options.current ?? "2d";

  const group = document.createElement("div");
  group.id = VIEW_SWITCH_ID;
  group.className = "view-switch";
  // A radio group rather than two buttons: the two views are mutually
  // exclusive states, and a screen reader should hear "2 of 2 selected", not
  // two unrelated buttons that happen to sit together.
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Map view");

  // The reason lives in the DOM even when empty, so the `aria-describedby` on
  // the 3D button always points at a real element.
  const reason = document.createElement("span");
  reason.id = VIEW_SWITCH_REASON_ID;
  reason.className = "view-switch-reason";
  // Announced when it changes: a control that becomes unavailable while the
  // reader is elsewhere on the page should say so.
  reason.setAttribute("role", "status");

  const make = (
    view: ViewSwitchKind,
    label: string,
    title: string,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "iconbtn";
    button.dataset.view = view;
    button.textContent = label;
    button.title = title;
    button.setAttribute("role", "radio");
    button.addEventListener("click", () => {
      if (button.disabled) return;
      // Re-clicking the active view is a no-op, not a reload: rebuilding the
      // engine would re-run the settle and throw away the reader's camera.
      if (view === current) return;
      options.onChange(view);
    });
    return button;
  };

  const twoD = make("2d", "2D", "Show the map in two dimensions");
  const threeD = make("3d", "3D", "Show the map in three dimensions");
  threeD.setAttribute("aria-describedby", VIEW_SWITCH_REASON_ID);

  group.append(twoD, threeD, reason);

  const paint = (): void => {
    for (const [button, view] of [
      [twoD, "2d"],
      [threeD, "3d"],
    ] as const) {
      const active = view === current;
      button.setAttribute("aria-checked", String(active));
      button.classList.toggle("active", active);
      // Only the selected radio is in the tab order; arrow keys are the
      // in-group movement a radiogroup is expected to have.
      button.tabIndex = active ? 0 : -1;
    }
  };

  const handle: ViewSwitchHandle = {
    element: group,
    getCurrent: () => current,
    setCurrent(view) {
      current = view;
      paint();
    },
    setUnavailable(text) {
      threeD.disabled = text !== null;
      reason.textContent = text ?? "";
      // `aria-disabled` as well as `disabled`: a disabled button is skipped by
      // some screen-reader controls entirely, and the reason is the point.
      threeD.setAttribute("aria-disabled", String(text !== null));
      if (text !== null) threeD.title = text;
    },
  };

  // Arrow-key movement within the group, as a radiogroup is expected to have.
  group.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = current === "2d" ? "3d" : "2d";
    if (target === "3d" && threeD.disabled) return;
    event.preventDefault();
    options.onChange(target);
  });

  handle.setUnavailable(options.unavailableReason ?? null);
  paint();
  return handle;
}
