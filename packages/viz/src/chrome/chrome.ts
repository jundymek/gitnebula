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
import { createStore, type ChromeState, type Store } from "./store.js";

export interface MountOptions {
  /** The element the engine draws on. Chrome places it and nothing more. */
  readonly stage: HTMLElement;
  readonly actions: HeaderActions;
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
  });

  const main = document.createElement("main");
  main.append(options.stage, renderLegend(), renderHint());

  root.replaceChildren(renderHeader(store, options.actions), main);

  return store;
}

/**
 * Subscribes chrome to the engine. Returns a teardown function.
 */
export function connectEngine(
  store: Store<ChromeState>,
  engine: GraphEngine,
): () => void {
  const off = [
    engine.on("settle-start", () => store.setState({ settling: true })),
    engine.on("settled", () => store.setState({ settling: false })),
  ];
  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
