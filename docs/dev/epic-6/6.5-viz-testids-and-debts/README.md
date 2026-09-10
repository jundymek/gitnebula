# 6.5 — Stable hooks for the readouts, and two defects Epic 5 left unowned

Wave A of Epic 6, on `epic/6-assembled-viewer`. This is **the only story in
the epic that changes what the product does**; every other story verifies.
That is why it carries an ADR.

Three pieces: a narrow `data-testid` pass over the chrome's readouts, and the
two defects the Epic 5 retrospective reported but never assigned — 7a (the
`other` layer has no legend key) and 7b (`hiddenCount().visible` ignores the
layer filter, in both engines).

## 1. The `data-testid` pass (AC-1, AC-2)

### The rule, and why the list is short

There was not one `data-testid` in `packages/viz/src/`, and that was not itself
a problem: accessibility was a first-class AC throughout Epic 5, so every
interactive **control** already carries a stable handle — `#layer-backend`..
`#layer-other`, `#view-switch button[data-view="3d"]`, `#start-here`,
`.sh-entry[data-id]`, `#p-isolate`, `#scope-bar`, a `role=combobox` search
input. Those are left alone; a second handle on an element that already has
one is drift waiting to happen.

The gap was the **readouts** — elements carrying a *number* rather than an
action, reachable only through styling classes. `.p-row` carries 5 rules in
`styles.css`, `.p-badge` 2, `.sh-metric` 1, so a restyle broke tests that were
never about styling.

A region earns a hook only when **both** hold: (a) its only current hook is a
CSS class, and (b) its value is unreachable from the `GraphEngine` interface,
so a test has no choice but to read the DOM. The second half is what keeps the
list short — `GraphEngine` exposes no edges accessor, no degree, no `repo`
metadata and no `cochanges`, and `getBlastRadius()` returns the currently
*marked* set rather than a node's partner list. Conversely `getLayerFilter()`,
`getScope()`, `getConnectedOnly()`, `getSelected()` and `getMode()` are
engine-backed, so regions fed by those need no hook.

Applying that rule yields exactly six, and they are declared in one place —
`packages/viz/src/chrome/testids.ts` — so "only these six" is visible rather
than scattered:

| constant | region | class before |
| --- | --- | --- |
| `PANEL_ROW_TESTID` | panel metric rows | `.p-row` |
| `PANEL_BLAST_ROW_TESTID` | blast-radius partner rows | `.p-blast-row` |
| `START_HERE_METRIC_TESTID` | start-here per-entry metric | `.sh-metric` |
| `LEGEND_ROW_TESTID` | legend rows | (none — a bare `span`) |
| `SCOPE_BAR_HIDDEN_TESTID` | scope bar's "N hidden" line | `.scope-bar-hidden` |
| `SCOPE_BAR_BACK_TESTID` | scope bar's "back to scope" button | `.scope-bar-back` |

`header.ts`'s two `**Do not rename.**` slot ids are byte-unchanged — the file
has zero diff.

### The count went down, which is the point (AC-2)

A pass that only adds attributes has not paid for itself, so the existing jsdom
assertions were **moved** onto the new hooks rather than duplicated. The metric
is every class-selector string literal in `packages/viz/src/chrome/*.test.ts`,
counting literals rather than `querySelector` call sites because many selectors
reach the DOM through helper functions and variables:

```bash
# after (working tree)
grep -ohE '"\.[a-z][a-z0-9-]*([ .][^"]*)?"' packages/viz/src/chrome/*.test.ts \
  | grep -vcE '^"\.(test\.)?ts"$'

# before (reproducible from the branch point)
git grep -ohE '"\.[a-z][a-z0-9-]*([ .][^"]*)?"' <base> -- 'packages/viz/src/chrome/*.test.ts' \
  | grep -vcE '^"\.(test\.)?ts"$'
```

The second `grep` removes four false positives in `boundary.test.ts`, which are
the file extensions `".ts"` and `".test.ts"` in its source-scanning code, not
selectors.

**Before: 106. After: 75. −31 (−29%).**

| file | before | after |
| --- | --- | --- |
| `scope-bar-wiring.test.ts` | 26 | 13 |
| `panel.test.ts` | 20 | 15 |
| `scope-bar.test.ts` | 19 | 10 |
| `start-here.test.ts` | 12 | 11 |
| `blast-radius.test.ts` | 9 | 8 |
| `chrome.test.ts` | 7 | 6 |
| `start-here-wiring.test.ts` | 7 | 7 |
| `legend.test.ts` | 5 | 4 |
| `search.test.ts` | 1 | 1 |
| **total** | **106** | **75** |

Two deliberate non-removals:

- **`EMPTY_STATE_CLASS` stays** in `panel.test.ts`, composed as
  `` `${PANEL_ROW}.${EMPTY_STATE_CLASS}` ``. That class is a *contract* between
  the panel and the stylesheet — story 5.5's "an absent value is marked, not
  merely worded differently" — and it is imported rather than spelled out, so
  it is not the kind of styling-only selector this pass removes.
- **`.sh-entry` and friends stay.** They are already-instrumented controls
  (`.sh-entry[data-id]`), outside the six regions AC-2 names. Re-pointing them
  is a separate, larger pass and was not in scope.

## 2. Debt 7a — the `other` layer had no legend key (AC-3, AC-4)

`LEGEND_ENTRIES` listed the mockup's five entries; `other` was missing, while
being the **largest** layer on this repository (145 of 363 nodes, against
`infra`'s 3 — measured in story 5.3). So the reader got an `other` filter
toggle with no key.

Story 5.5 declined this and was right to: `LAYER_COLOR.other` and
`LAYER_COLOR.infra` were both `#7c8598`, so a fifth entry would have drawn two
identical swatches. The maintainer took the palette decision on 2026-09-05 —
`other` gets its own fifth hue.

`LAYER_COLOR.other` is now **`#cf81cf`**, chosen by CIE L\*a\*b\* separation
against every colour already on the canvas (including `--cochange #ff5fa2`,
which is easy to miss because it is not in UX-DR1). Full method, the measured
table and the rejected alternatives are in
**[ADR-0008](../../../adr/0008-fifth-layer-hue-for-other.md)**.

`UX-DR1` is *not* contradicted: its inventory is the mockup's four layers plus
`--hot` and the void, and `LAYER_COLOR.infra` is unchanged at `#7c8598`.

Two new tests: every layer the filter can switch off has a legend key, and no
two entries share a colour. Reverting `LAYER_COLOR.other` to the old grey makes
the second fail with the pair named:

```
AssertionError: expected [ '#7c8598: infra + other' ] to deeply equal []
```

## 3. Debt 7b — `hiddenCount().visible` ignored the layer filter (AC-5, AC-6)

`types.ts` documents `visible` as the survivors of *every* filter, layers
included. But `visibleIds()` returns `null` as an early-out when there is no
scope and no connected-only filter — nothing needs materialising then — and
`hiddenCount()` read that `null` as "everything survives", falling back to
`graph.nodes.length`. The layer filter was invisible to the count on the one
path where the layer filter is the only thing removing nodes.

Found by story 5.7 while building the degradation sweep, which "read 2,100 for
every sample". 5.7 handed it to "5.3/5.4", both already merged, so nobody
received it.

**Fixed in both engines**, using the private `hiddenByLayerFilter()` each
already carried:

```ts
visible: visible
  ? visible.size
  : this.graph
    ? this.graph.nodes.length - this.hiddenByLayerFilter()
    : 0,
```

`emitScope()` in **both** engines carried its own copy of the same defective
expression, one line below a call to `hiddenCount()`. It now takes
`counts.visible`, which fixes the `scope` event too and removes the duplicate
that let the two diverge. That path is genuinely reachable: *leaving* a scope
while a layer filter is on emits with no scope left to consult.

### Watched red first, in each engine (AC-5)

Epic 5 shipped a test that went green with its bug still present, because the
fixture contained no node in the failing shape. So the shape is spelled out in
both test docstrings — ≥ 2 layers, no scope, no connected-only, one layer off —
and both tests were run against the unfixed implementation first:

| test | file | red before the fix |
| --- | --- | --- |
| 2D survivor count | `engine/filter.test.ts` | `expected 6 to be 3` |
| 2D `scope` event on leaving a scope | `engine/filter.test.ts` | `expected 6 to be 3` |
| 3D survivor count | `engine/engine3d.test.ts` | `expected 6 to be 3` |
| 3D agrees with 2D | `engine/engine3d.test.ts` | `expected 6 to be 3` |
| legend: no shared colours | `chrome/legend.test.ts` | `'#7c8598: infra + other'` |

Fixture `root-files` (6 nodes: `backend` 3, `infra` 2, `test` 1), with
`version.py` reassigned to `frontend` by `filter.test.ts`'s existing
`mixedLayerDocument()` helper.

The 3D "agrees with the 2D engine" test earns its place: after the 2D fix
landed and before the 3D one, it failed *because the two engines disagreed*,
which is exactly the drift ADR-0007 warns about when a `GraphEngine` member is
implemented twice.

### AC-6 — which readouts showed the wrong number: none, with evidence

Traced through chrome, `hiddenCount().visible` and the `scope` event's
`visibleCount` reach exactly one consumer:

```
hiddenCount() / scope.visibleCount
  -> chrome.ts:402,480  store.scopeVisibleCount
  -> chrome.ts:292      scopeIsEmpty: state.scopeId !== null && state.scopeVisibleCount === 0
```

That consumer is guarded by `scopeId !== null`, and the defect fired only when
`scopeId === null`. **The wrong value was structurally unreachable by any
readout.** The layer filter's own readouts (`layerFilter.setHidden`,
`filterEmpty.update`) are fed by the separate `filter` event, which computes
`visible` independently as `nodes.length - hiddenByLayerFilter()` and was
always correct.

So no readout is corrected here, because none consumed it. That claim is
pinned by three tests in `chrome/scope-bar-wiring.test.ts` rather than left as
prose — a later refactor dropping the `scopeId !== null` guard would turn the
old defect into a visible one with nothing to catch it.

**Why it still had to be fixed now:** wave B's stories assert through this
interface. A test written against the old behaviour would have encoded the
wrong number as the expected one, and the defect would have become
load-bearing.

## Files

**NEW**

| file | why |
| --- | --- |
| `packages/viz/src/chrome/testids.ts` | the six hooks and the rule for adding a seventh, in one place |
| `docs/adr/0008-fifth-layer-hue-for-other.md` | the palette departure from `reference/mockup.html` (AC-4) |
| `docs/dev/epic-6/6.5-viz-testids-and-debts/README.md` | this file |
| `docs/dev/epic-6/6.5-viz-testids-and-debts/MANUAL_TESTING.md` | executed verification steps |

**UPDATE**

| file | why |
| --- | --- |
| `packages/viz/src/engine/constants.ts` | `LAYER_COLOR.other` → `#cf81cf` (7a) |
| `packages/viz/src/engine/engine.ts` | 2D `hiddenCount()` + `emitScope()` (7b) |
| `packages/viz/src/engine/engine3d.ts` | 3D `hiddenCount()` + `emitScope()` (7b) |
| `packages/viz/src/engine/filter.test.ts` | 2D red-first tests (AC-5) |
| `packages/viz/src/engine/engine3d.test.ts` | 3D red-first tests, incl. cross-engine agreement (AC-5) |
| `packages/viz/src/chrome/legend.ts` | `other` entry; row hook; docstrings |
| `packages/viz/src/chrome/legend.test.ts` | AC-3 tests; assertions moved onto the hook |
| `packages/viz/src/chrome/panel.ts` | metric-row and blast-row hooks |
| `packages/viz/src/chrome/panel.test.ts` | assertions moved onto the hooks |
| `packages/viz/src/chrome/start-here.ts` | `.sh-metric` hook |
| `packages/viz/src/chrome/start-here.test.ts` | assertion moved onto the hook |
| `packages/viz/src/chrome/scope-bar.ts` | hidden-line and back-button hooks |
| `packages/viz/src/chrome/scope-bar.test.ts` | assertions moved onto the hooks |
| `packages/viz/src/chrome/scope-bar-wiring.test.ts` | assertions moved; AC-6 evidence tests |
| `packages/viz/src/chrome/blast-radius.test.ts` | assertion moved onto the hook |
| `packages/viz/src/chrome/chrome.test.ts` | legend list now six entries, keyed by hook |

**Untouched, deliberately:** `packages/viz/ui/` (6.1's territory — the two
wave-A branches must not be able to conflict), `packages/viz/src/chrome/header.ts`,
`packages/viz/src/styles.css` (see ADR-0008), and the contract.

## Verification

| check | result |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm --filter @gitnebula/viz test` | **56 files, 827 tests, all pass** — this story adds 13 (806 → 819); the remaining 8 and the 56th file arrived with story 6.1, which merged into the epic branch while this one was in review |
| `pnpm build` | exit 0 (tsup + vite) |
| `packages/viz/src/chrome/boundary.test.ts` | **24 tests pass, file unchanged** (AC-7) |
| `packages/contract/src/analysis.schema.json` | **zero diff**; `schemaVersion` still `"1.0"` (AC-7, NFR-11) |
| `packages/viz/src/chrome/header.ts` | **zero diff** (AC-1) |
| files under `packages/viz/ui/` | **none touched** (AC-7) |

No `PERFORMANCE.md`: this story touches no stated performance property — it
adds test hooks, one palette value and a counting correction. Project rules ask
for that file where performance is the story's subject and say not to invent
budgets to test against.
