# 5.2 — Hover that highlights instead of dimming

## The baseline this replaces

Hover was a **subtractive** encoding: everything outside the hovered node's
one-hop chain fell to `NODE_ALPHA_DIMMED` (0.1) and its edges to
`EDGE_ALPHA_DIMMED` (0.03). That reads well in `reference/mockup.html`, which
draws a few dozen hardcoded nodes. It does not survive a real repository.

Measured on a langgraph checkout, and quoted as binding context in the story
spec:

| measurement | value |
| --- | --- |
| nodes dimmed by one hover | **647 of 650** |
| median 1-hop chain | **3 nodes** |
| share of the viewport covered by pointer hit-areas at 6× | **78%** |

The cursor is therefore over *something* nearly all the time, and the map
strobes as it moves. FR-29 supersedes FR-17's **mechanism**, not its intent:
the chain must still be unambiguously identifiable — by emphasis rather than by
everything else disappearing.

The measurement is reproduced independently in this branch's
[`PERFORMANCE.md`](PERFORMANCE.md): on the 2,100-node synthetic fixture at
3.2× zoom, the old encoding deleted **425 of 467 file labels** the moment the
pointer touched a node, and restored them the moment it left. That is the
largest single strobe on the map.

## What changed

### One `chain`, two encodings

`RenderScene` gains one **optional** field, `chainMode`:

| | out-of-chain node | out-of-chain edge | chain edge |
| --- | --- | --- | --- |
| `"hover"` (new) | `NODE_ALPHA_HOVER_REST` **0.55** | `EDGE_ALPHA_HOVER_REST` **0.12** | `EDGE_ALPHA_CHAIN` 0.62 |
| `"isolate"` (unchanged) | `NODE_ALPHA_DIMMED` 0.1 | `EDGE_ALPHA_DIMMED` 0.03 | `EDGE_ALPHA_CHAIN` 0.62 |

The two resting values are the maintainer's decision recorded in the spec, not
a re-derivation.

`NODE_ALPHA_DIMMED` and `EDGE_ALPHA_DIMMED` keep their names **and their
values**. Isolate (story 3.4) means "show me this and nothing else" and is
entitled to extinguish the map; hover cannot mean that. AC-4 requires 3.4's
tests — including `engine-export.test.ts`'s assertion on the dimmed module
label `rgba(214,222,236,0.16)` — to pass **unmodified**, and they do.

Omitting `chainMode` means `"isolate"`, so every scene built before this story
keeps its exact meaning.

### The chain is added to, not carved out

Emphasis, applied on the hover path only:

- **brightness** — the chain's glow radius is multiplied by `CHAIN_GLOW_BOOST`
  (1.35);
- **a ring** at `screenRadius + CHAIN_RING_OFFSET_PX` (3 px) at
  `CHAIN_RING_ALPHA` (0.5), deliberately inside the selection ring's +5 px so a
  hovered neighbour never reads as a selected node;
- **`EDGE_ALPHA_CHAIN`** on chain edges, unchanged from the mockup.

### File labels survive a hover

`render.ts` used to suppress file labels for out-of-chain nodes. At
`FILE_LABEL_ZOOM` that is hundreds of labels vanishing and returning with every
pointer movement. Under hover they now stay and ride their node's resting
opacity; under isolate the suppression is unchanged. Measured effect: the label
count under hover is now **identical** to the label count with no hover at all
(467 vs 467, against 42 under the old rule).

### No frame without a chain (AC-3)

A pointer sweeping a dense map crosses a few pixels of background between two
nodes. The pointer-move path used to clear the chain on that frame and pick the
next one up on the following frame — the whole map jumping back to full opacity
and down again.

The chain the pointer just left is now **held** for `HOVER_CARRY_MS` (120 ms)
on the engine's existing frame clock, and replaced the instant a new node is
hovered. The hold is bounded, so a pointer parked on the background does not
leave a highlight behind.

Three things deliberately bypass the hold:

- `setHovered(null)` — the explicit answer, used by `pointerleave` and by
  chrome. Full opacity returns in the same frame (AC-2, and story 3.3's
  existing test asserts exactly this).
- `pointerdown` — hover stays suppressed for the whole pan gesture (AC-2).
- a new hover — it replaces the held chain immediately, which is what makes the
  transition seamless rather than merely slower.

**This is a debounce, not a transition.** The held chain is the same chain at
the same alphas for every frame of the hold, and then it is gone; no drawn
value is a function of elapsed time. That is why `prefers-reduced-motion` needs
no special case (AC-5, NFR-7, UX-DR11), and a test asserts the alphas are
identical at t=0 and t=5000 under both motion settings.

## Files

| file | kind | why |
| --- | --- | --- |
| `packages/viz/src/engine/constants.ts` | UPDATE | the six new constants; no existing value renamed, removed or changed |
| `packages/viz/src/engine/render.ts` | UPDATE | `chainMode` on the scene; `nodeAlpha` / `edgeAlpha` / `emphasised` as pure functions over the render state; chain glow + ring; label rules |
| `packages/viz/src/engine/engine.ts` | UPDATE | `buildScene` tags the chain's source; the hover carry (fields, `carriedHover()`, the `onPointerMove` branch, the `onPointerDown` cancel); `setHovered` split into the public clear-and-set and the internal `applyHover` |
| `packages/viz/src/engine/hover-encoding.test.ts` | NEW | AC-1, AC-2, AC-3, AC-4, AC-5 |
| `docs/dev/epic-5/5.2-viz-hover-fix/PERFORMANCE.md` | NEW | draw-call and fps measurements |
| `docs/dev/epic-5/5.2-viz-hover-fix/MANUAL_TESTING.md` | NEW | executed steps + the AC-6 human-review item |

Nothing under `chrome/` is touched, the simulation is untouched, `types.ts` and
`pick()` are untouched, and there is no contract change (`schemaVersion` stays
`"1.0"`, NFR-11).

## Why the tests are where they are

AC-1 asks for the encoding to be asserted **over the render state, not by
screenshot**. `nodeAlpha`, `edgeAlpha` and `emphasised` are exported pure
functions, so the assertion is direct — the same shape `nodeColor`,
`glowRadius` and `pulseFactor` already had. AC-3 is asserted through the real
pointer path (`pointermove` on the canvas) against the deterministic frame
clock, one `engine.frame(t)` at a time.

They live in a file of their own rather than in `render.test.ts` or
`navigation.test.ts` because four other agents were editing `packages/viz` in
the same wave, and a new file cannot conflict.

Each assertion was watched fail before it was relied on: disabling the carry
turns the three AC-3 tests red, and restoring the old single-alpha rule turns
AC-1's first test red.

## Verification

```bash
pnpm --filter @gitnebula/viz test   # 39 files, 488 tests
pnpm lint && pnpm test && pnpm build
PERF_PORT=<free port> pnpm --filter @gitnebula/viz perf
```

The one perf-suite failure (`export.pw.ts`, `exportHeight` 1654 vs 1594) is
**pre-existing**: it reproduces identically on an untouched checkout of
`origin/epic/5-onboarding` in the same environment. It is a window-height
disagreement inside the export parity harness (827 vs 797 CSS px) and touches
nothing this story changes. Reported rather than fixed, per the cohort rule
that a defect outside a story does not get patched five different ways in five
branches.
