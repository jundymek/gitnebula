/**
 * The detail panel (FR-19, FR-20, UX-DR7) — the mockup's layout, driven by the
 * engine's `select` event and nothing else.
 *
 * Structure, top to bottom, exactly as `reference/mockup.html` has it:
 * close `×`, name + hot badge, path, `kind · layer`, the metric rows, the
 * churn bar, then the `isolate` and `open on github` actions.
 *
 * Two rules this component exists to hold:
 *
 * - **AD-10, the inert description slot.** `PanelData` accepts a
 *   `description`, and the panel renders NOTHING for it — no placeholder, no
 *   "coming soon" hint. The post-MVP describe layer gets a component API to
 *   fill; MVP gets no visible trace of it. `panel.test.ts` asserts the
 *   absence rather than trusting the comment.
 * - **AC-3, absence over disablement.** With no GitHub remote the action is
 *   not rendered at all. A greyed-out button that can never enable is a
 *   promise the tool cannot keep.
 *
 * The panel talks to the map through the injected actions, which the mount
 * point wires to the `GraphEngine` interface (AD-5). It knows no engine.
 */

import type { AnalysisDocument } from "@gitnebula/contract";

import type { EngineNode } from "../engine/index.js";
import { buildPanelModel, type PanelModel } from "./panel-model.js";

export interface PanelActions {
  /** Toggle isolate for the open node. */
  onIsolate(): void;
  /** Close the panel — the `×` button. */
  onClose(): void;
}

/** What one opening of the panel is given. */
export interface PanelData {
  readonly document: AnalysisDocument;
  readonly node: EngineNode;
  /**
   * Reserved for the post-MVP describe layer (AD-10). Accepted here so the
   * component API is the one the later story fills; rendered nowhere in MVP.
   */
  readonly description?: string | null;
  /** Reference instant for the relative last-change row. */
  readonly now?: number;
}

export interface PanelHandle {
  readonly element: HTMLElement;
  /** Render a node and open the panel. */
  open(data: PanelData): void;
  /** Hide the panel and forget the node. */
  close(): void;
  /** Reflect isolate state on the action's label and `aria-pressed`. */
  setIsolated(isolated: boolean): void;
}

export function renderPanel(actions: PanelActions): PanelHandle {
  const panel = document.createElement("aside");
  panel.id = "panel";
  // The mockup's `aria-live` — selection can also arrive from a search
  // fly-to (3.3), where nothing else announces what was opened.
  panel.setAttribute("aria-live", "polite");
  panel.hidden = true;

  const close = button("p-close", "×");
  close.setAttribute("aria-label", "Close panel");
  close.addEventListener("click", () => actions.onClose());

  const head = document.createElement("div");
  head.className = "p-head";
  const name = span("p-name");
  const badge = span("p-badge");
  badge.textContent = "hot spot";
  head.append(name, badge);

  const path = span("p-path");
  const kind = span("p-kind");

  const rows = document.createElement("div");
  rows.className = "p-rows";

  const bar = document.createElement("div");
  bar.className = "p-bar";
  const barFill = document.createElement("i");
  bar.append(barFill);

  const isolate = button("iconbtn", "isolate");
  isolate.id = "p-isolate";
  isolate.setAttribute("aria-pressed", "false");
  isolate.addEventListener("click", () => actions.onIsolate());

  const github = document.createElement("a");
  github.className = "iconbtn";
  github.id = "p-github";
  github.textContent = "open on github";
  github.target = "_blank";
  // `noopener` is not optional on a `_blank` link: without it the opened page
  // can reach back through `window.opener`.
  github.rel = "noopener noreferrer";

  const panelActions = document.createElement("div");
  panelActions.className = "p-actions";

  panel.append(close, head, path, kind, rows, bar, panelActions);

  const handle: PanelHandle = {
    element: panel,

    open(data) {
      const model = buildPanelModel(data.document, data.node, {
        now: data.now,
      });
      paint(model);
      panel.hidden = false;
    },

    close() {
      panel.hidden = true;
      handle.setIsolated(false);
    },

    setIsolated(isolated) {
      isolate.setAttribute("aria-pressed", String(isolated));
      isolate.textContent = isolated ? "isolated" : "isolate";
    },
  };

  function paint(model: PanelModel): void {
    name.textContent = model.name;
    badge.hidden = !model.hot;
    path.textContent = model.path;
    kind.textContent = model.kindLine;

    rows.replaceChildren(
      ...model.rows.map((row) => {
        const line = document.createElement("div");
        line.className = "p-row";
        const label = document.createElement("span");
        label.textContent = row.label;
        const value = document.createElement("span");
        value.textContent = row.value;
        line.append(label, value);
        return line;
      }),
    );

    // AC-1: the bar's width IS the churn row's number, not a second reading
    // of the same value.
    barFill.style.width = model.churnPercent;

    // AC-3: absent, not disabled.
    if (model.githubUrl === null) {
      panelActions.replaceChildren(isolate);
    } else {
      github.href = model.githubUrl;
      panelActions.replaceChildren(isolate, github);
    }
  }

  handle.setIsolated(false);
  return handle;
}

function span(className: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

function button(className: string, text: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = className;
  element.type = "button";
  element.textContent = text;
  return element;
}
