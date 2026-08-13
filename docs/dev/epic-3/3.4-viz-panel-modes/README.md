# 3.4 — Detail panel and view modes

Story spec: [`docs/implementation-artifacts/epic-3-exploration/3.4-viz-panel-modes.md`](../../../implementation-artifacts/epic-3-exploration/3.4-viz-panel-modes.md).
PRD FR-19, FR-20, FR-21. Owner module: `viz` (chrome).

## What this adds

Clicking a node opens a detail panel with its history metrics; the header
gains a Structure ↔ Heatmap toggle.

- **Panel** — name + `hot spot` badge, path, `kind · layer`, six metric rows
  (files / loc / churn `<window>`d / authors / last change / co-changes with),
  a churn bar, and the `isolate` + `open on github` actions, with a `×` close.
  The layout is `reference/mockup.html`'s, with one addition the mockup did
  not have: a path line, because AC-1 asks for name **and** path and a file's
  heading is its basename.
- **Isolate** — dims everything outside the selected node's dependency chain
  until it is toggled off, another node is selected, or the panel closes.
- **Mode toggle** — fills the `#mode-slot` story 2.5 left empty. Heatmap
  colours every node by churn on the mockup's cold→hot ramp.
- **Click selection** — the canvas now turns a press into a selection, with
  drag discrimination so panning never selects.

## How it is wired (AD-5)

Chrome never touches the canvas. The whole feature runs on the `GraphEngine`
interface story 2.5 froze:

```
canvas press ─► engine.setSelected ─► "select" event ─► panel.open()
search fly-to ─┘                                    └─► panel.close() on null
panel isolate ─► engine.setIsolated ─► "highlight" ─► renderer dims the rest
mode button   ─► engine.setMode     ─► "mode"      ─► toggle repaints
```

Two consequences worth stating:

- The panel opens the same way whether a click or story 3.3's search fly-to
  produced the selection — there is one path in, which is what AC-5's last
  clause asks for.
- The toggle never assumes its own click took effect. It repaints from the
  engine's `mode` event, so the engine stays the single source of truth.

## Files

### New

| file | why |
| --- | --- |
| `packages/viz/src/chrome/panel.ts` | the panel DOM, its actions, and the inert description slot |
| `packages/viz/src/chrome/panel-model.ts` | pure derivation of everything the panel prints — no DOM, no clock |
| `packages/viz/src/chrome/github.ts` | GitHub remote detection and the tree/blob URL builder |
| `packages/viz/src/chrome/mode-toggle.ts` | the two `aria-pressed` mode buttons |
| `packages/viz/src/test-support/engine-nodes.ts` | test-only `EngineNode` builder, so chrome tests need no engine |
| `*.test.ts` beside each of the above | AC coverage |

### Updated

| file | why |
| --- | --- |
| `packages/viz/src/chrome/chrome.ts` | mounts the panel and the toggle; subscribes `select` and `mode` |
| `packages/viz/src/chrome/store.ts` | `ChromeState` gains `selected` / `isolated` / `mode` (appended) |
| `packages/viz/src/chrome/format.ts` | `formatPercent`, `formatRelativeTime`, `EMPTY_METRIC` |
| `packages/viz/src/styles.css` | appended `/* modes */` and `/* panel */` blocks |
| `packages/viz/src/engine/engine.ts` | pointer click/drag discrimination (see below) |
| `packages/viz/src/engine/constants.ts` | appended `CLICK_SLOP_PX` |
| `packages/viz/src/app.ts` | passes the document to `connectEngine` |

## Decisions worth knowing

**Co-change partners are same-kind.** The contract ships `cochanges` as
same-kind pairs. A module shows its module partners; a **file shows its file
partners**. The spec's context line says "module-level cochange pairs", which
is exactly right for a module — but rolling a file's partners up into modules
would be a new aggregation computed in `viz`, and AD-1 puts aggregation in the
pipeline or nowhere. Selecting and sorting is all that happens here.

**The churn row names the document's window, not 90 days.** The mockup
hardcodes `churn 90d`; `repo.analysisWindowDays` is a real contract field and
the synthetic fixture analyses a full year. Printing `90d` over a 365-day
window would be a lie in the UI.

**No GitHub remote means no button.** Not a disabled one. GitLab and Bitbucket
use different path segments, so a guessed URL 404s; absence is honest.

**`CLICK_SLOP_PX = 4`.** The mockup sets its `moved` flag on any pointermove
at all, so a one-pixel tremor on a trackpad eats the click. The threshold is a
deliberate divergence from the reference, and AC-4's own tests are what would
have worn the bug.

**Relative time takes `now` as a parameter.** `viz` is exempt from the
analyzers' `Date.now()` ban — that ban protects `analysis.json`'s determinism —
but a formatter that reads a clock cannot be tested, so the clock is injected
and defaults to `Date.now()`.

**The description slot renders nothing (AD-10).** `PanelData.description`
exists so the post-MVP describe layer has a component API to fill. MVP shows
no placeholder and no hint; `panel.test.ts` asserts the absence of both the
text and any word that would advertise the feature.

## Territory

Cohort with 3.3 (pamela) and 3.5 (rambo), all three in `packages/viz`. Agreed
split: 3.3 owns engine interaction internals and search, 3.5 owns export and
the perf harness, 3.4 owns the panel, the mode toggle and their store slices.
Canvas click selection was ceded to 3.4 in intent-sync because it is AC-4 here
and appears in neither of the other two stories' criteria. Shared files were
edited append-only by agreement.

## Verification

`pnpm lint`, `pnpm --filter @gitnebula/viz test`, `pnpm build`, plus
[`MANUAL_TESTING.md`](./MANUAL_TESTING.md), which was executed against this
repository's own `analysis.json` in a real browser.
