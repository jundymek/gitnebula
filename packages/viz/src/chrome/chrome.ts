/**
 * Mounts the DOM chrome and connects it to the engine — through the
 * `GraphEngine` interface and its events only (AD-5).
 *
 * Nothing under `src/chrome/` may touch a canvas, a 2D context or the
 * simulation — the bootstrap creates the stage element and passes it in as a
 * plain `HTMLElement`, so chrome only ever *places* it. `boundary.test.ts` is
 * what keeps that from eroding.
 */

import type { AnalysisDocument } from "@gitnebula/contract";

import type { GraphEngine } from "../engine/index.js";
import { renderExportButton } from "./export-button.js";
import {
  EXPORT_SLOT_ID,
  MODE_SLOT_ID,
  renderHeader,
  type HeaderActions,
} from "./header.js";
import { renderHint } from "./hint.js";
import { renderLegend } from "./legend.js";
import { renderModeToggle, type ModeToggleHandle } from "./mode-toggle.js";
import { renderPanel, type PanelHandle } from "./panel.js";
// Types only: the bootstrap constructs these and hands them in, so chrome
// wires them without owning their lifetime.
import type { SearchBox } from "./search.js";
import type { Tooltip } from "./tooltip.js";
import { createStore, type ChromeState, type Store } from "./store.js";

export interface MountOptions {
  /** The element the engine draws on. Chrome places it and nothing more. */
  readonly stage: HTMLElement;
  readonly actions: HeaderActions;
  /**
   * Extra overlay elements to place over the stage — story 3.3's search box
   * and tooltip. Optional and appended last, so `mountChrome`'s signature is
   * unchanged for the stories building alongside this one.
   */
  readonly overlays?: readonly HTMLElement[];
}

/** What `connectEngine` needs beyond the handle. */
export interface ConnectOptions {
  readonly search?: SearchBox;
  readonly tooltip?: Tooltip;
  /** The document the panel derives its rows from (3.4). */
  readonly analysis: AnalysisDocument;
  /** Reference instant for the panel's relative last-change row (3.4). */
  readonly now?: number;
}

/**
 * What `mountChrome` hands back. It IS the store — every 2.5 caller keeps
 * working — plus the handles story 3.4's components need for the engine
 * wiring in `connectEngine`.
 */
export interface ChromeHandle extends Store<ChromeState> {
  readonly panel: PanelHandle;
  readonly modeToggle: ModeToggleHandle;
  /**
   * Give the chrome the engine its controls act on. Called by
   * `connectEngine`, because the engine cannot exist before the stage it
   * measures is in the document.
   */
  attachEngine(engine: GraphEngine | null): void;
}

export function mountChrome(
  root: Element,
  analysis: AnalysisDocument,
  options: MountOptions,
): ChromeHandle {
  const store = createStore<ChromeState>({
    repoName: analysis.repo.name,
    files: analysis.repo.stats.files,
    loc: analysis.repo.stats.loc,
    commits: analysis.repo.stats.commits,
    // AC-4: derived from the node set. `repo.stats` has no module count, and
    // a second count would be a second truth.
    modules: analysis.nodes.filter((node) => node.kind === "module").length,
    languages: analysis.repo.stats.languages,
    settling: true,
    hoveredId: null,
    selectedId: null,
    unfolded: 0,
    selected: null,
    isolated: false,
    mode: "structure",
  });

  // Set by `connectEngine`. The panel's controls are live from the moment
  // they are in the DOM, but the engine is constructed after the stage is
  // attached — so they reach it through this rather than capturing it.
  let engine: GraphEngine | null = null;

  const panel = renderPanel({
    onIsolate() {
      // Isolate is a toggle on the open node; the engine owns the state and
      // the store mirrors it from the `highlight` event.
      const selected = store.getState().selected;
      if (!engine || !selected) return;
      const next = store.getState().isolated ? null : selected.id;
      engine.setIsolated(next);
      store.setState({ isolated: next !== null });
      panel.setIsolated(next !== null);
    },
    onClose() {
      // Closing clears selection AND isolate together (AC-4). The engine
      // echoes a `select: null` back, which shuts the panel a second time —
      // but the panel is also shut here, so × works before an engine is
      // attached rather than looking dead.
      engine?.setIsolated(null);
      engine?.setSelected(null);
      store.setState({ selected: null, isolated: false });
      panel.close();
    },
  });

  const modeToggle = renderModeToggle({
    onMode(mode) {
      engine?.setMode(mode);
    },
  });

  const header = renderHeader(store, options.actions);
  header.querySelector(`#${MODE_SLOT_ID}`)?.append(modeToggle.element);

  const main = document.createElement("main");
  main.append(options.stage, renderLegend(), renderHint(), panel.element);
  if (options.overlays) main.append(...options.overlays);

  root.replaceChildren(header, main);

  return {
    ...store,
    panel,
    modeToggle,
    attachEngine(next) {
      engine = next;
    },
  };
}

/**
 * Subscribes chrome to the engine. Returns a teardown function.
 */
export function connectEngine(
  handle: ChromeHandle,
  engine: GraphEngine,
  options: ConnectOptions,
): () => void {
  handle.attachEngine(engine);
  const off = [
    engine.on("settle-start", () => handle.setState({ settling: true })),
    engine.on("settled", () => handle.setState({ settling: false })),
    // Story 3.3: the tooltip is a pure function of the engine's hover event —
    // chrome never asks the canvas what is under the pointer (AD-5).
    engine.on("hover", ({ node, screen }) => {
      options.tooltip?.update(node, screen);
      handle.setState({ hoveredId: node?.id ?? null });
    }),
    // One `select` handler for both stories: 3.3 records the id, 3.4 drives
    // the panel from it. The event arrives from a canvas click and from a
    // search fly-to alike, which is what AC-5's last clause asks for.
    engine.on("select", ({ node }) => {
      handle.setState({ selectedId: node?.id ?? null });
      // Isolate belongs to the open node, so any selection change drops it —
      // whether the panel is closing or moving on (AC-4).
      engine.setIsolated(null);
      if (node === null) {
        handle.setState({ selected: null, isolated: false });
        handle.panel.close();
        return;
      }
      handle.setState({ selected: node, isolated: false });
      handle.panel.setIsolated(false);
      handle.panel.open({
        document: options.analysis,
        node,
        now: options.now,
      });
    }),
    engine.on("unfold", () => {
      handle.setState({ unfolded: engine.unfoldedModules().length });
    }),
    engine.on("collapse", () => {
      handle.setState({ unfolded: engine.unfoldedModules().length });
    }),
    engine.on("mode", ({ mode }) => {
      handle.setState({ mode });
      handle.modeToggle.setMode(mode);
    }),
  ];
  options.search?.setNodes(engine.nodes);
  handle.modeToggle.setMode(engine.getMode());
  // The PNG button (3.5) is mounted here rather than in `mountChrome` because
  // this is where the engine handle exists — the header only reserves the slot.
  document
    .getElementById(EXPORT_SLOT_ID)
    ?.replaceChildren(renderExportButton(handle, engine));
  return () => {
    handle.attachEngine(null);
    for (const unsubscribe of off) unsubscribe();
    options.search?.destroy();
  };
}
