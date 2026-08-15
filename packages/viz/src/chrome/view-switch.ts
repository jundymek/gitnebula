/**
 * The 2D / 3D view switch (story 5.7, FR-32).
 *
 * A plain DOM control that reports which view the reader asked for. It knows
 * nothing about engines: chrome may not name a canvas or construct one
 * (`boundary.test.ts`), so swapping the implementation is `app.ts`'s job and
 * this only says what was clicked — the same shape the existing `onReplay`
 * action has.
 *
 * **Markup follows `mode-toggle.ts`**: a pair of `aria-pressed` buttons in a
 * `role="group"`, carrying the `modes` class. That is this repository's
 * established segmented-control pattern (the mode toggle, the layer filter and
 * the scope bar all use it), and `.modes button[aria-pressed="true"]` already
 * styles the pressed state — so the selected view is visible to sighted
 * readers without this story editing `styles.css`, which belongs to another
 * agent this wave. Reusing the pattern is also the accessible answer for two
 * controls that read perfectly well as two toggles: a radio group would demand
 * arrow-key roving focus for no gain, which is the same call `mode-toggle.ts`
 * documents.
 *
 * **2D is pressed by default** (AC-1). When 3D is unavailable the button is
 * *disabled with the reason attached* rather than hidden or silently inert: a
 * control that does nothing when clicked is worse than one that explains why
 * it is off, and AC-5 requires the reason to be stated where a reader finds it.
 */

export type ViewSwitchKind = "2d" | "3d";

export interface ViewSwitchOptions {
  /** The view currently shown. Defaults to 2D. */
  readonly current?: ViewSwitchKind;
  /**
   * Why 3D cannot be offered, or null when it can. A string disables the 3D
   * button and becomes its tooltip and its accessible description.
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

const LABEL: Readonly<Record<ViewSwitchKind, string>> = {
  "2d": "2D",
  "3d": "3D",
};

const TITLE: Readonly<Record<ViewSwitchKind, string>> = {
  "2d": "Show the map in two dimensions",
  "3d": "Show the map in three dimensions",
};

export function renderViewSwitch(options: ViewSwitchOptions): ViewSwitchHandle {
  let current: ViewSwitchKind = options.current ?? "2d";

  const group = document.createElement("div");
  group.id = VIEW_SWITCH_ID;
  // `modes` for the shared segmented-control styling, plus our own hook.
  group.className = "modes view-switch";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Map view");

  const buttons = (["2d", "3d"] as const).map((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = view;
    button.textContent = LABEL[view];
    button.title = TITLE[view];
    button.addEventListener("click", () => {
      if (button.disabled) return;
      // Re-clicking the active view is a no-op, not a reload: rebuilding the
      // engine would re-run the settle and throw away the reader's camera.
      if (view === current) return;
      options.onChange(view);
    });
    group.append(button);
    return { view, button };
  });

  const threeD = buttons[1]!.button;

  // The reason element exists even when empty, so `aria-describedby` never
  // points at nothing. `role="status"` announces it if it appears later.
  const reason = document.createElement("span");
  reason.id = VIEW_SWITCH_REASON_ID;
  reason.className = "view-switch-reason";
  reason.setAttribute("role", "status");
  threeD.setAttribute("aria-describedby", VIEW_SWITCH_REASON_ID);
  group.append(reason);

  const handle: ViewSwitchHandle = {
    element: group,
    getCurrent: () => current,
    setCurrent(view) {
      current = view;
      for (const entry of buttons) {
        entry.button.setAttribute(
          "aria-pressed",
          String(entry.view === current),
        );
      }
    },
    setUnavailable(text) {
      threeD.disabled = text !== null;
      reason.textContent = text ?? "";
      // `aria-disabled` as well as `disabled`: some screen-reader controls skip
      // a disabled button entirely, and the reason is the point.
      threeD.setAttribute("aria-disabled", String(text !== null));
      threeD.title = text ?? TITLE["3d"];
    },
  };

  handle.setUnavailable(options.unavailableReason ?? null);
  handle.setCurrent(current);
  return handle;
}
