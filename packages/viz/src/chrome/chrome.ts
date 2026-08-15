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

import { ALL_LAYERS, type GraphEngine } from "../engine/index.js";
import { renderExportButton } from "./export-button.js";
import {
  EXPORT_SLOT_ID,
  FILTER_SLOT_ID,
  MODE_SLOT_ID,
  renderHeader,
  type HeaderActions,
} from "./header.js";
import { renderFilterEmpty, type FilterEmptyHandle } from "./filter-empty.js";
import { renderHint } from "./hint.js";
import { renderLayerFilter, type LayerFilterHandle } from "./layer-filter.js";
import { renderLegend } from "./legend.js";
import { renderModeToggle, type ModeToggleHandle } from "./mode-toggle.js";
import { renderPanel, type PanelHandle } from "./panel.js";
// Types only: the bootstrap constructs these and hands them in, so chrome
// wires them without owning their lifetime.
import type { SearchBox } from "./search.js";
import { renderStartHere, type StartHereHandle } from "./start-here.js";
import { buildStartHereModel } from "./start-here-model.js";
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
  /** Story 5.1's start-here panel (FR-26). */
  readonly startHere: StartHereHandle;
  /** Story 5.3's layer filter and its empty state (FR-28). */
  readonly layerFilter: LayerFilterHandle;
  readonly filterEmpty: FilterEmptyHandle;
  /**
   * Give the chrome the engine its controls act on. Called by
   * `connectEngine`, because the engine cannot exist before the stage it
   * measures is in the document.
   */
  attachEngine(engine: GraphEngine | null): void;
}

/**
 * Whether the reader asked for less animation — the same query the engine
 * resolves, deliberately duplicated here for one value.
 *
 * **Why this exists.** Under reduced motion `engine.load()` runs the layout to
 * Settled and emits `settled` *synchronously inside the call* (UX-DR11), and
 * `app.ts` connects the chrome to the engine only afterwards. The event is
 * therefore emitted before anything is listening: `settling` would stay true
 * forever, the 2.5 replay control would never enable, and story 5.1's panel —
 * which waits for the settle to end — would never appear for exactly the
 * readers who asked for less motion.
 *
 * The defect is in the boot order, not here, and its proper fix is either a
 * settle-state accessor on the `GraphEngine` interface or connecting before
 * loading — both of which reach outside this story's territory during a
 * five-agent wave on this package. This resolves the initial value only;
 * `settle-start` and `settled` keep owning every later transition.
 */
function prefersReducedMotion(): boolean {
  return (
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
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
    // Normally true until the engine says otherwise — except under reduced
    // motion, where the engine has already finished settling before anything
    // here is listening. See `prefersReducedMotion` below.
    settling: !prefersReducedMotion(),
    hoveredId: null,
    selectedId: null,
    unfolded: 0,
    selected: null,
    isolated: false,
    mode: "structure",
    // Story 5.1: shut until the layout settles, then opened once (AC-3).
    startHereOpen: false,
    startHereShown: false,
    // Story 5.3: every layer on until the reader says otherwise (FR-28).
    visibleLayers: ALL_LAYERS,
    filteredOutCount: 0,
  });

  // Set by `connectEngine`. The panel's controls are live from the moment
  // they are in the DOM, but the engine is constructed after the stage is
  // attached — so they reach it through this rather than capturing it.
  let engine: GraphEngine | null = null;

  const panel = renderPanel({
    onIsolate() {
      // A toggle on the open node. The button only *asks*: the engine owns
      // isolate state and publishes it on `highlight`, which is where the
      // store and this button read it back from.
      const selected = store.getState().selected;
      if (!engine || !selected) return;
      engine.setIsolated(store.getState().isolated ? null : selected.id);
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

  // Story 5.1. The ranking is computed once, from the document the chrome was
  // mounted with — the panel is a view over it and recomputes nothing when it
  // is reopened (AC-3).
  const startHere = renderStartHere(buildStartHereModel(analysis), {
    onSelect(id) {
      // The existing flight, not a second one: `flyTo` unfolds a collapsed
      // parent, waits for the wake, and selects on arrival — which is what
      // opens the detail panel (AD-5, AC-4). Chrome moves no camera by hand.
      void engine?.flyTo(id);
      store.setState({ startHereOpen: false });
    },
    onClose() {
      store.setState({ startHereOpen: false });
    },
  });

  // The panel follows the store rather than being toggled at each call site,
  // so the header control, the first-load open and a row's dismissal are all
  // one path.
  store.subscribe((state) => {
    if (state.startHereOpen) startHere.open();
    else startHere.close();
  });

  // AC-3: the default first state, once — and only when the reader has not
  // already gone somewhere themselves. Driven by the store's `settling` field
  // rather than a second `settled` subscription, because `connectEngine` is
  // shared ground this wave and a listener there is not this story's to add.
  store.subscribe((state) => {
    if (state.startHereShown || state.settling) return;
    store.setState({
      startHereShown: true,
      startHereOpen: state.selectedId === null,
    });
  });

  // Story 5.3. The control only asks; the engine owns the filter and echoes it
  // back on its `filter` event, which is what moves these buttons — the same
  // shape the mode toggle uses, so a filter changed anywhere reaches the UI.
  const layerFilter = renderLayerFilter({
    onFilter(layers) {
      engine?.setLayerFilter(layers);
    },
  });

  const filterEmpty = renderFilterEmpty({
    onReset() {
      // AC-4's one click back to the unfiltered map.
      engine?.setLayerFilter(ALL_LAYERS);
    },
  });

  const header = renderHeader(store, options.actions);
  header.querySelector(`#${MODE_SLOT_ID}`)?.append(modeToggle.element);
  header.querySelector(`#${FILTER_SLOT_ID}`)?.append(layerFilter.element);

  const main = document.createElement("main");
  main.append(
    options.stage,
    renderLegend(),
    renderHint(),
    panel.element,
    startHere.element,
    filterEmpty.element,
  );
  if (options.overlays) main.append(...options.overlays);

  root.replaceChildren(header, main);

  return {
    ...store,
    panel,
    modeToggle,
    startHere,
    layerFilter,
    filterEmpty,
    attachEngine(next) {
      engine = next;
    },
  };
}

/**
 * Subscribes chrome to the engine. Returns a teardown function.
 *
 * **One connection describes one document.** `options.analysis` is the
 * document the panel derives its rows from, and it is captured here — so a
 * caller that later hands the same engine a *different* document through
 * `engine.load()` must tear this connection down and make a new one, or the
 * panel would print the previous repository's metrics and GitHub links. The
 * Viewer loads once (`app.ts`), so the shipped path cannot reach that state;
 * the constraint is written down because the next caller will not be able to
 * infer it from the signature.
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
      // whether the panel is closing or moving to another node. The engine
      // echoes the result on `highlight`, which is what updates the button.
      engine.setIsolated(null);
      if (node === null) {
        // Empty canvas, or the × : selection and isolate go together (AC-4).
        handle.setState({ selected: null });
        handle.panel.close();
        return;
      }
      handle.setState({ selected: node });
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
    // Isolate state is the engine's, not the panel's. Reading it back from
    // the event it is published on means a change made anywhere — the panel
    // button, a future control, a test — reaches the button and the store.
    engine.on("highlight", ({ isolated }) => {
      handle.setState({ isolated });
      handle.panel.setIsolated(isolated);
    }),
    engine.on("mode", ({ mode }) => {
      handle.setState({ mode });
      handle.modeToggle.setMode(mode);
    }),
    // Story 5.3, appended as its own entry rather than folded into a handler
    // above — the convention this wave's five agents agreed on for this array.
    engine.on("filter", ({ layers, hidden, visible }) => {
      handle.setState({ visibleLayers: layers, filteredOutCount: hidden });
      handle.layerFilter.setLayers(layers);
      handle.layerFilter.setHidden(hidden);
      // The counts come from the event rather than from `engine.nodes`, which
      // is deliberately the *unfiltered* set (search and the 5.1 ranking read
      // it) — subtracting against it here would make chrome re-derive a number
      // the engine already knows.
      handle.filterEmpty.update({ visible });
    }),
  ];
  options.search?.setNodes(engine.nodes);
  // Both halves of the mirror, not just the visible one: a subscriber reading
  // `state.mode` before the first `mode` event must see the engine's answer.
  const mode = engine.getMode();
  handle.setState({ mode });
  handle.modeToggle.setMode(mode);
  // Story 5.3, the same mirror: a subscriber reading `state.visibleLayers`
  // before the first `filter` event must see the engine's answer, not a
  // hopeful default. Nothing is hidden yet, so the empty state stays shut.
  const layers = engine.getLayerFilter();
  handle.setState({ visibleLayers: layers, filteredOutCount: 0 });
  handle.layerFilter.setLayers(layers);
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
