# 3.3 — Navigation: semantic zoom, hover, search

Turns the settled map from story 2.5 into something you can explore: zoom
unfolds modules into their files, hover lights the dependency chain, and a
search box flies the camera anywhere in the repository.

Everything here runs through the `GraphEngine` interface frozen in 2.5. No new
event was added and none was reshaped — the 2.5 author declared the whole
interface up front, including the parts 2.5 did not implement, so this story
filled in `flyTo`, `unfoldedModules`, `isUnfolded` and the hover path against a
shape that was already agreed.

## What it does

### Semantic unfold (AC-1, ADR-0006, FR-16)

Past `UNFOLD_ZOOM` (1.8×), modules **intersecting the viewport plus a 15 %
margin** unfold into their member files. Off-screen modules stay collapsed;
panning a collapsed module into view at ≥ 1.8× unfolds it; dropping below 1.8×
collapses everything. File labels appear from 3.0×.

This is the ADR's deliberate deviation from the mockup, which unfolds every
module at once — at the 2,000-file yardstick that is precisely the 60 fps worst
case. Bounding unfold by the viewport keeps the simulated file count in the low
hundreds.

Two pieces:

- `engine/unfold.ts` — pure geometry. Which modules the camera wants unfolded,
  and the diff against what currently is. No canvas, no simulation, so the
  ADR's rule is tested as arithmetic.
- `engine/layout.ts`'s `MemberLayout` — one local d3-force wake per unfolded
  module.

**The wake contains only that module's files.** Not the module, not any
sibling. That is how "the global layout is undisturbed" is guaranteed: not by
balancing forces, but by never including the nodes that must not move. Members
spawn into a 12 px golden-angle disc centred on their module and are pulled
back toward it by `forceX`/`forceY`; there is no `forceCenter`, per the spike's
AC-5 finding.

Each wake is seeded from `hash(moduleId) ^ documentSeed` rather than from the
shared settle stream, so a module's cloud is identical no matter what order the
user panned through the map (AD-6 through unfold).

### Hover chains (AC-2, FR-17)

`onPointerMove` picks the node under the cursor and calls `setHovered`; the
engine emits `hover`, and `chrome/tooltip.ts` draws `path · churn N%` following
the cursor. The renderer already honoured `chain` since 2.5 — chain edges at
0.62, non-chain nodes at 0.1 and edges at 0.03 — so this story supplies the
chain rather than the encoding. A hovered module lights its member files once
unfolded, which `chainOf` already expressed and which only started producing
anything when unfold became real.

Hover is not evaluated while dragging: a pan would otherwise light and dim
every node it swept past. Leaving the canvas restores full opacity.

The tooltip **flips** to the other side of the cursor near a viewport edge
rather than being clamped flat against it — a clamped tooltip ends up under the
pointer and hides the node it describes.

### Search (AC-3, FR-18, UX-DR8/11)

Persistent top-left box with a `⌘K` hint. `Cmd/Ctrl+K` or a bare `/` focuses
it; typing fuzzy-matches node ids; the top 7 are listed; `↑`/`↓` move (wrapping),
`Enter` selects, `Esc` closes and blurs. The first result is active immediately,
so the common case is three letters and Enter.

`/` is ignored when the keystroke is already headed for a text field — otherwise
a slash could never be typed into a path query, which is the most likely thing
anyone searches for here.

Selecting flies the camera 620 ms ease-out to 2.0× (module) or 3.0× (file),
pulses the target, and emits `select` on **arrival** — story 3.4's panel opens
from that event, and opening it at departure would describe a node the user
cannot see yet. A file inside a collapsed module unfolds it on the way. Under
reduced motion the camera jumps and there is no pulse.

Accessibility follows the ARIA combobox pattern: the input owns the listbox,
`aria-activedescendant` names the active option, and a polite live region
announces the result count. Arrowing through a list a screen reader cannot
follow is not navigation, and FR-18 is a navigation requirement.

## Files

### New

| file | why |
| --- | --- |
| `packages/viz/src/engine/unfold.ts` | ADR-0006's rule as pure geometry: visible-rect, intersection, set diff |
| `packages/viz/src/engine/unfold.test.ts` | Threshold, margin, pan-into-view, collapse-all |
| `packages/viz/src/engine/fuzzy.ts` | Path-shaped subsequence scorer and ranking for the search box |
| `packages/viz/src/engine/fuzzy.test.ts` | Subsequence filter, boundary/consecutive bonuses, deterministic ties |
| `packages/viz/src/engine/navigation.test.ts` | The story's engine-side ACs against the 100×2,000 fixture |
| `packages/viz/src/chrome/search.ts` | Search box, results listbox, keyboard model, ARIA combobox |
| `packages/viz/src/chrome/search.test.ts` | Filtering, top-7 cap, arrows/Enter/Esc, global shortcuts |
| `packages/viz/src/chrome/tooltip.ts` | Hover tooltip: label, cursor-following, edge flipping |
| `packages/viz/src/chrome/tooltip.test.ts` | Label format and the never-overflows invariant |

### Updated

| file | why |
| --- | --- |
| `packages/viz/src/engine/engine.ts` | Unfold driving, hover wiring, `flyTo`, arrival pulse, `buildScene` extraction |
| `packages/viz/src/engine/layout.ts` | `MemberLayout` — the local per-module wake, plus its tuning constants |
| `packages/viz/src/engine/render.ts` | Optional `pulse` on the scene and the arrival ring that draws it |
| `packages/viz/src/engine/constants.ts` | Appended `PULSE_DURATION_MS`, `PULSE_MAX_RADIUS_PX` |
| `packages/viz/src/engine/index.ts` | Exports the fuzzy scorer through the barrel chrome may import |
| `packages/viz/src/chrome/chrome.ts` | Optional `overlays` + `ConnectOptions`; hover/select/unfold subscriptions |
| `packages/viz/src/chrome/store.ts` | Appended `hoveredId`, `selectedId`, `unfolded` |
| `packages/viz/src/app.ts` | Constructs the search box and tooltip and wires them in |
| `packages/viz/src/styles.css` | Appended search and tooltip blocks |
| `packages/viz/src/chrome/chrome.test.ts` | Subscription count became an invariant (see DECISIONS D8) |
| `packages/viz/src/engine/engine.test.ts` | `flyTo` removed from the not-implemented list — it is implemented now |

## Cohort notes

Three stories share `packages/viz`. Territory was agreed before any code was
written and holds:

- **3.4 (panel and modes)** owns `chrome/` panel and mode toggle, and
  **click-to-select** in the engine's pointer handlers. This story never calls
  `setSelected` from a pointer path.
- **3.5 (export and perf)** owns `exportPNG`, whose `notYet()` stub is left
  byte-identical here, and the perf harness. It re-renders through the
  `buildScene` extracted in this story.

Per-frame work changes materially with unfold — unfolded modules add file nodes
and member edges to both the simulation and the draw path — so 3.5's fps
numbers must be measured after this story merges. Flagged to that agent
directly.

## Verification

```bash
pnpm --filter @gitnebula/viz test   # 240 tests
pnpm lint
pnpm build
```

`MANUAL_TESTING.md` in this folder records the browser walkthrough, including
which steps were executed and which are left for a human.

Note that `pnpm test` from the workspace root fails in `githist` on this base —
a pre-existing race between concurrent callers of the fixture-repo build script,
specced as story 3.6 and untouched here. `githist` passes 74/74 in isolation.

## Two bugs the browser found

Both were on this story's own surface, and both are now covered by
deterministic tests that were watched failing first.

1. **Unfold went stale during a camera flight.** `advanceFlight` moves the
   camera without going through `setCamera` — it has to, since `setCamera`
   cancels the flight it is animating — so the unfold set was never recomputed
   mid-flight. A fly-to arrived at 3.0× with only its own module unfolded and
   every visible neighbour still collapsed. The unit tests had missed it by
   flying with `durationMs: 0`, which does route through `setCamera`.

2. **The settle-completion `fit()` cancelled a user's fly-to.** The search box
   is usable from the first frame, but the map settles over 2–3 s; a search
   during that window had its flight cancelled by the automatic fit, so search
   looked broken. A user-initiated camera move now suppresses that fit.
