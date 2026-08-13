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
import { renderHeader, type HeaderActions } from "./header.js";
import { renderHint } from "./hint.js";
import { renderLegend } from "./legend.js";
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
   * and tooltip. Optional and appended last, so `mountChrome`'s signature and
   * return type are unchanged for the stories building alongside this one.
   */
  readonly overlays?: readonly HTMLElement[];
}

/** What `connectEngine` needs beyond the store, if the caller has it. */
export interface ConnectOptions {
  readonly search?: SearchBox;
  readonly tooltip?: Tooltip;
}

export function mountChrome(
  root: Element,
  analysis: AnalysisDocument,
  options: MountOptions,
): Store<ChromeState> {
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
  });

  const main = document.createElement("main");
  main.append(options.stage, renderLegend(), renderHint());
  if (options.overlays) main.append(...options.overlays);

  root.replaceChildren(renderHeader(store, options.actions), main);

  return store;
}

/**
 * Subscribes chrome to the engine. Returns a teardown function.
 */
export function connectEngine(
  store: Store<ChromeState>,
  engine: GraphEngine,
  options: ConnectOptions = {},
): () => void {
  const off = [
    engine.on("settle-start", () => store.setState({ settling: true })),
    engine.on("settled", () => store.setState({ settling: false })),
    // Story 3.3: the tooltip is a pure function of the engine's hover event —
    // chrome never asks the canvas what is under the pointer (AD-5).
    engine.on("hover", ({ node, screen }) => {
      options.tooltip?.update(node, screen);
      store.setState({ hoveredId: node?.id ?? null });
    }),
    engine.on("select", ({ node }) => {
      store.setState({ selectedId: node?.id ?? null });
    }),
    engine.on("unfold", () => {
      store.setState({ unfolded: engine.unfoldedModules().length });
    }),
    engine.on("collapse", () => {
      store.setState({ unfolded: engine.unfoldedModules().length });
    }),
  ];
  options.search?.setNodes(engine.nodes);
  return () => {
    for (const unsubscribe of off) unsubscribe();
    options.search?.destroy();
  };
}
