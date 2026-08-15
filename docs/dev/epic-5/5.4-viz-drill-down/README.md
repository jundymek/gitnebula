# 5.4 — Drill-down and connected-only

Two levers that reduce **what the map draws**, rather than restyling it: a
module scope entered with a distinct gesture, and a filter that drops nodes
carrying no edge at all.

## Why this exists

The spec's measurement on a real langgraph checkout: the unscoped view puts
**650 nodes on one screen, 232 of them carrying no edge**, and pointer
hit-areas cover 78% of the viewport at 6× zoom. Restyling does not help a map
that is drawing too much; only drawing less does.

## The one idea everything else follows from

**Scoping is a frame concern, not a layout concern.** The simulation keeps
running on the whole graph; scoping filters the scene that gets built from it.

Three consequences, all of them load-bearing:

- leaving a scope is **instant** — there is nothing to rebuild;
- the settle is **never re-run**, and positions do not move, so the map a user
  comes back to is the map they left (AC-4);
- the same predicate can gate picking, which is what makes an excluded node
  genuinely **absent rather than dimmed** (AC-6). Two callers reading two
  different predicates is exactly how "absent" quietly becomes "invisible but
  still clickable".

## What a scope carries

`{focus module} ∪ {its member files} ∪ {modules it imports or is imported by}`

A neighbour module is in scope; **its member files are not.** That is AC-1
read literally — "that module, its member files, and the modules it imports"
attaches the files to the focus and stops — and it is what makes the reduction
real. Pulling neighbours' files in as well would read as more "complete" and
would put most of the repository back on screen.

## Measured

Method: `inScopeIds` / `degreeOf` / `visibleNodeIds` run over each document,
which is the same code the engine consults, so these are the numbers the frame
actually gets. Reproduced by `packages/viz/src/engine/scope.test.ts`; full
method and per-fixture table in [PERFORMANCE.md](PERFORMANCE.md).

| document                       | whole map   | widest scope      | connected-only hides       |
| ------------------------------ | ----------- | ----------------- | -------------------------- |
| **this repository** (real run) | 401 nodes   | 221 nodes (55.1%) | 187 of 394 files, **47.5%** |
| `synthetic-100x2000`           | 2,100 nodes | 30 nodes (1.4%)   | 869 of 2,000 files, 43.5%   |
| `langgraph-shape.ts`           | 14 nodes    | 8 nodes (57.1%)   | 0 (every file has an edge)  |

The first row is a live run: `gitnebula .` over this checkout produced a
401-node document in 0.33 s, and the story's own functions were run over it.
Its narrower scopes are far tighter than the widest — `reference/` scopes to
**2 nodes (0.5%)** — and the widest scope **plus** connected-only lands at 182
nodes, with 180 hidden by scope and 39 by degree, reported as two causes and
never as one total.

**On the spec's own figures.** The spec quotes 650/232 and 662/2388 → 169/917
from a real langgraph checkout. I do not have that checkout, so those are the
spec's numbers and are cited as such — the table above is what I measured.
`synthetic-100x2000` is the closest analogue available: 43.5% of its files are
edgeless against langgraph's 35.7%, the same order of magnitude and the same
shape of problem.

The langgraph-*shaped* fixture (story 5.1's, now on this branch) is a **shape**
fixture, not a scale one — 14 nodes, every file connected. It pins what a scope
*contains*; the synthetic fixture pins how much a scope *removes*.

## The search decision

**Binding, taken by the maintainer:** when search targets a node outside the
active scope, the scope is **left and the camera flies to the target**. The
chrome states that the scope was left and offers a one-click return.

A silent no-op is explicitly not acceptable: search stays globally useful, and
the scope is a view filter rather than a cage.

One deliberate narrowing in the implementation: membership is tested against
the **scope alone**, not against the whole visible set. A node that is *in*
scope but hidden by connected-only is not out of scope, and clearing the scope
for it would cost the user their frame without putting the target on screen.

**Known gap, not fixed here.** If connected-only alone hides a search target,
the camera still flies to a node that is not drawn. AC-5 covers the scope case
only, and extending the same principle to connected-only is a real improvement
but not one this story's criteria ask for — widening it unilaterally into a
shared file three agents are editing this wave is the wrong trade. Flagged for
the owner.

## Files

**NEW**

| file                          | why                                                              |
| ----------------------------- | ---------------------------------------------------------------- |
| `engine/scope.ts`             | the pure half: in-scope set, degree, visible ids, per-cause counts |
| `engine/scope.test.ts`        | AC-1/AC-3 decided from the document alone, no canvas               |
| `engine/drill-down.test.ts`   | AC-1…AC-6 against a real engine                                    |
| `chrome/scope-bar.ts`         | the indicator, both exits, the toggle, the counts, the way back    |
| `chrome/scope-bar.test.ts`    | the component's own contract                                       |
| `chrome/scope-bar-wiring.test.ts` | AC-2 end to end: gesture → engine → event → store → DOM        |

**UPDATED**

| file                       | why                                                                |
| -------------------------- | ------------------------------------------------------------------ |
| `engine/engine.ts`         | scope state, the `dblclick` gesture, `Escape`, two narrowing guards |
| `engine/types.ts`          | appended interface members and the `scope` event                    |
| `chrome/chrome.ts`         | one appended `off` entry, the bar's construction and placement       |
| `chrome/store.ts`          | appended slice                                                      |
| `chrome/export-button.test.ts` | the hand-built `ChromeState` literal needs every required field |
| `styles.css`               | appended `.scope-bar` block                                         |

## Boundaries kept

- `chrome/boundary.test.ts` passes **byte-unchanged** — AD-5 holds: the bar
  reaches the map only through the `GraphEngine` interface.
- No contract change; `schemaVersion` stays `"1.0"` (NFR-11).
- No RNG draw and no clock anywhere in this story (AD-6). `engine/scope.ts` is
  a pure function of the document, so a scope is reproducible.
- `render.ts` and `constants.ts` untouched — story 5.2's territory this wave.

## Notes for the reviewer

- The visible-id set is **cached and invalidated on filter or document
  change**, not rebuilt per frame: `buildScene` runs 60 times a second and
  rebuilding a 2,100-id set inside it would spend the budget this story exists
  to free. With no filter active the computation returns `null` and the
  unscoped map costs exactly what it did before.
- `Escape` listens on `globalThis`, not on the canvas — a canvas is not
  focusable, so a canvas-level `keydown` never fires. It skips text fields, so
  `chrome/search.ts` keeps owning `Escape` inside its input.
- Story 5.1's owner ceded `Escape` explicitly, so with both the start-here
  panel and a scope on screen the key has exactly one meaning.
