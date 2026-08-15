# 5.1 — Start-here ranking

Story spec: [`docs/implementation-artifacts/epic-5-onboarding/5.1-viz-start-here.md`](../../../implementation-artifacts/epic-5-onboarding/5.1-viz-start-here.md).
PRD FR-26, UX-DR12, UX-DR14, NFR-11, NFR-12, AD-5, AD-6. Owner module: `viz`
(chrome).

## What this adds

The map used to open as an inventory of everything. It now opens on an answer:
once the layout settles and nothing is selected, a **start-here panel** lists a
reading order in three categories, computed from the loaded `analysis.json`.

| category               | members                                          | ranked by       |
| ---------------------- | ------------------------------------------------ | --------------- |
| core                   | non-test files that at least one other imports    | in-degree desc  |
| entry points           | non-test files nobody imports, that import others | out-degree desc |
| tests as documentation | files in the `test` layer                         | out-degree desc |

Choosing a row flies the camera to that file and opens its detail panel.
The panel is dismissible and comes back from the `◎ start here` header control.

**No contract change.** `schemaVersion` stays `"1.0"`; every number comes from
`nodes[].layer` and the file-level `edges` the pipeline already emits (NFR-11).

## How it is wired (AD-5)

```
analysis.json ─► buildStartHereModel()  ─► renderStartHere()
                 (pure, no DOM)             │ onSelect(id)
                                            ▼
                                     engine.flyTo(id)
                                            │
                                     "select" event ─► detail panel (3.4)
```

`flyTo` is story 3.3's, unchanged: it unfolds a collapsed parent module, waits
for the local wake to settle, aims at the node and selects it on arrival. The
start-here panel therefore adds **no camera code to `chrome/`** — the same path
the search box has used since 3.3 — and `chrome/boundary.test.ts` passes
untouched.

The first-load open is driven by the chrome store's existing `settling` field
rather than by a second `engine.on("settled", …)` subscription. Two reasons:
`connectEngine` is the file four stories append to in this wave, and the fake
engine in `chrome.test.ts` keeps one listener per event, so a second `settled`
subscription would silently displace the existing one in every peer's run.

## A pre-existing bug this story had to work around

Under `prefers-reduced-motion`, `engine.load()` runs the layout to Settled and
emits `settled` **synchronously inside the call** (UX-DR11, `engine.ts`), while
`app.ts` connects the chrome to the engine only afterwards. The event is
emitted before anything is listening, so `settling` stayed `true` for the rest
of the session. Two consequences, one of them older than this story:

- the 2.5 replay control was permanently disabled for reduced-motion readers;
- a start-here panel waiting for the settle to end would never appear for them.

The proper fix is a settle-state accessor on the `GraphEngine` interface, or
connecting before loading (which cannot be a straight reorder — `connectEngine`
seeds the search corpus from `engine.nodes`, which is empty before `load`).
Both reach outside this story's territory while four other agents hold
`engine/` and `chrome/` in the same wave, so this branch resolves only the
**initial** value of `settling`, by reading the same media query the engine
does. Every later transition still belongs to `settle-start` / `settled`.
`start-here-wiring.test.ts` covers all three states, and the reduced-motion
assertions were seen red before the fix.

## Decisions worth knowing

- **`core` requires in-degree > 0.** AC-1 asks for core as "non-test files
  ranked by in-degree" *and* promises the three lists are disjoint by
  construction. Unfiltered, core would contain every entry point at the bottom
  of its list. The disjointness clause wins: a file nobody imports is not the
  core of anything, and it is listed under entry points instead.
- **Degrees are file-level only.** `edges` carries import edges at both levels
  (ADR-0005); a module edge's weight is the number of underlying file pairs.
  An edge counts only when both endpoints are file nodes, or a file's degree
  would be inflated by its directory's traffic.
- **No `localeCompare`, anywhere.** Ties break on `id` with a code-point
  comparison, so the reading order is the same on every machine (NFR-12,
  AD-6). A test greps the story's own sources for the call.
- **No global keyboard shortcut.** `Escape` is story 5.4's scope exit; the
  ownership was agreed in writing with that story's agent during intent-sync.
- **Five entries per category.** The model returns the complete ranking and the
  view slices it (`START_HERE_LIMIT`), stating how many are below the cut. A
  list of 259 files is the inventory this story exists to replace.

## Files

| file                                          | new/updated | why                                                            |
| --------------------------------------------- | ----------- | -------------------------------------------------------------- |
| `packages/viz/src/chrome/start-here-model.ts`  | NEW         | the ranking — pure, no DOM, no engine                           |
| `packages/viz/src/chrome/start-here.ts`        | NEW         | the panel DOM and its open/close handle                         |
| `packages/viz/src/chrome/start-here-model.test.ts` | NEW     | AC-1, AC-2, AC-5 and the determinism proof                      |
| `packages/viz/src/chrome/start-here.test.ts`   | NEW         | the panel's rendering, empty states and selection               |
| `packages/viz/src/chrome/start-here-wiring.test.ts` | NEW    | AC-3 and AC-4 at the `mountChrome` level                        |
| `packages/viz/src/test-support/langgraph-shape.ts` | NEW     | the langgraph-shaped document AC-2 is asserted against          |
| `packages/viz/src/chrome/chrome.ts`            | UPDATE      | construction, `main.append` argument, first-load open           |
| `packages/viz/src/chrome/store.ts`             | UPDATE      | appended slice: `startHereOpen`, `startHereShown`               |
| `packages/viz/src/chrome/header.ts`            | UPDATE      | appended `◎ start here` disclosure control                      |
| `packages/viz/src/chrome/export-button.test.ts`| UPDATE      | its hand-built `ChromeState` literal needs the two new fields   |
| `packages/viz/src/styles.css`                  | UPDATE      | appended `#start-here` block, no existing selector touched      |

## Tests

`pnpm --filter @gitnebula/viz test` — 39 new assertions across three files, in
a suite that goes from 383 to 422 passing. Worth naming three of them:

- the ranking is computed twice over one document and the two results are
  compared as JSON, and again after reversing the node and edge arrays, so
  neither the tie-break nor the input order can drift (NFR-12);
- the langgraph-shaped fixture carries module-level edges beside the file-level
  ones and a test file with an entry point's degree signature, which is what
  catches a category filter written in the wrong order;
- the first-load open was verified red by removing its `startHereShown` guard
  before being relied on.

`packages/viz/src/chrome/export-button.test.ts` needed two lines because it
builds a full `ChromeState` literal by hand — `vitest` stays green when a
required field is missing there and only `pnpm --filter @gitnebula/viz
typecheck` catches it. The two peers appending their own store slices this wave
were told.
