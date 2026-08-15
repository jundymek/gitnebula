# 5.3 — Layer filter

Five multi-select toggles in the header that decide which layers the map
draws. FR-28, UX-DR13 (`aria-pressed`, active set visible without a menu),
UX-DR6 (styled after the mode toggle), UX-DR14 (empty states name their cause),
FR-22 (export matches the screen), NFR-11 (no contract change — `schemaVersion`
stays `"1.0"`), AD-5 (chrome never touches the canvas).

## The one idea

**Excluded means not drawn, never dimmed.** A filtered-out node leaves the
frame entirely, so it cannot be hovered, picked, or counted as pointer
hit-area. That is the difference from story 5.2's work: dimming is an
*encoding*, this is *removal*. On a real langgraph checkout hit-areas cover 78%
of the viewport at 6× zoom, so a merely-dimmed node still catches every pick —
which is why every test here asserts absence and never an alpha.

The second idea follows from the first: filtering narrows **the frame**, never
the layout. The simulation keeps running on the whole graph, so switching a
layer back on restores nodes exactly where they were and never re-runs the
settle (AC-6).

## How it is put together

The engine owns the filter; chrome asks and mirrors — the same shape story 3.4
used for the view mode, so a filter changed anywhere (a control, the empty
state's reset, a test) reaches every reader of it.

```
click on a toggle
  → LayerFilterHandle emits the full surviving set
  → chrome calls engine.setLayerFilter(layers)     ← the only direction chrome writes
  → engine narrows buildScene + pick, redraws, emits `filter`
  → chrome mirrors it into the store, the buttons and the empty state
```

Two narrowings, one predicate:

- `buildScene()` drops non-surviving nodes and every edge missing an endpoint.
  `exportPNG` already delegates to `buildScene`, so **AC-5 needed no export
  code at all** — only a test proving the export and the live frame issue the
  same draw calls under an active filter.
- `pick()` carries the matching guard, which is the half that makes AC-2 true
  rather than merely visual.

## Files

### New

| file                              | why                                                          |
| --------------------------------- | ------------------------------------------------------------ |
| `engine/layers.ts`                | `ALL_LAYERS` / `LAYER_LABEL` — the five layers as an ordered list, not a lookup |
| `engine/filter.test.ts`           | AC-2, AC-3, AC-5, AC-6 proved at the engine, where they live  |
| `chrome/layer-filter.ts`          | the five `aria-pressed` toggles and the hidden-count line     |
| `chrome/layer-filter.test.ts`     | AC-1                                                          |
| `chrome/filter-empty.ts`          | AC-4: a cause, an exit, one click back                        |
| `chrome/filter-empty.test.ts`     | AC-4                                                          |

### Updated

| file                            | change                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `engine/types.ts`               | appended: the `filter` event, `getLayerFilter`/`setLayerFilter` |
| `engine/engine.ts`              | `visibleLayers` field, the filter method section, one guard line in `pick`, one narrowing block in `buildScene` |
| `engine/index.ts`               | appended export of the layer list                               |
| `chrome/store.ts`               | appended slice: `visibleLayers`, `filteredOutCount`             |
| `chrome/header.ts`              | `FILTER_SLOT_ID` and its empty div, after `replay`              |
| `chrome/chrome.ts`              | control construction, slot fill, empty-state element, one appended `off` entry |
| `chrome/chrome.test.ts`         | the fake engine learned the 5.3 seam; appended wiring block     |
| `chrome/export-button.test.ts`  | the two new required `ChromeState` fields                       |
| `styles.css`                    | appended `#layer-filter` / `#filter-empty` block                |

`chrome/boundary.test.ts` is **byte-unchanged and still passing** (AC-7).

## Decisions worth knowing

Full reasoning in `DECISIONS.md` at the branch root. The four that affect a
reader of this code:

1. **The filter lives in the engine.** AC-2 requires unpickability and `pick()`
   is engine-side; AD-5 forbids chrome from reaching the canvas. Added as
   appended interface members, announced to the cohort before being written.
2. **`engine.nodes` still returns every node.** The filter narrows the frame,
   not the node set — the search corpus and story 5.1's ranking read that
   getter, and neither is this story's to change.
3. **Hiding the hovered or selected node clears it**, through the existing
   setters, so no event payload changes. A panel left open on an invisible node
   is worse than a closed one.
4. **The empty state triggers on "nothing survives"**, a superset of AC-4's
   literal "every layer excluded" — a repository that is all one layer, with
   that layer off, is the same dead map.

## Measured on this repository

`gitnebula` run against its own checkout, 363 nodes / 418 edges:

| layer      | nodes |
| ---------- | ----- |
| `other`    | 145   |
| `backend`  | 111   |
| `test`     | 97    |
| `frontend` | 7     |
| `infra`    | 3     |

210 of 418 edges (50%) cross a layer boundary, which is why AC-3's
both-endpoints rule is load-bearing rather than a formality — half the edges
are candidates for removal under any single-layer filter.

Note `other` is the **largest** layer here while `chrome/legend.ts` names only
four and omits it. The filter exposes all five (the contract carries five), so
a reader gets an `other` toggle with no legend key. The legend is story 5.5's
territory; reported to its owner rather than edited here.

## Verification

```bash
pnpm --filter @gitnebula/viz test        # 469 passing
pnpm --filter @gitnebula/viz typecheck
pnpm lint
pnpm --filter @gitnebula/viz build
```

`MANUAL_TESTING.md` in this folder records what was executed against a real
build and what remains for a human.
