# Performance — 5.4 drill-down and connected-only

This story's subject **is** a performance property: how many nodes the frame
carries. The numbers below are what it measures.

## Method

Reproduce with the same functions the engine consults, so the figures are the
ones the frame actually gets rather than a parallel calculation:

```js
import { buildGraph } from "packages/viz/src/engine/graph.ts";
import { degreeOf, inScopeIds, visibleNodeIds } from "packages/viz/src/engine/scope.ts";

const graph = buildGraph(document);
visibleNodeIds(graph, { scopeId: "<module id>", connectedOnly: false });
```

The same assertions run in CI as part of `packages/viz/src/engine/scope.test.ts`
and `engine/drill-down.test.ts`, so a regression in these ratios fails the
suite rather than silently degrading the map.

Machine note: measurements are pure document maths — no canvas, no timing — so
they are machine-independent and byte-reproducible from the fixture. Nothing
here is a wall-clock number.

## Scene sizes

Documents: `packages/contract/fixtures/synthetic-100x2000.json` (the FR-12 /
ADR-0006 yardstick) and `packages/viz/src/test-support/langgraph-shape.ts`
(story 5.1's shape fixture).

| document                | nodes | modules | files | edges | widest scope      | narrowest scope |
| ----------------------- | ----- | ------- | ----- | ----- | ----------------- | --------------- |
| **gitnebula** (live run) | 401   | 7       | 394   | 450   | 221 nodes (55.1%) | 2 nodes (0.5%)  |
| `synthetic-100x2000`    | 2,100 | 100     | 2,000 | 1,095 | 30 nodes (1.4%)   | 22 nodes (1.0%) |
| `langgraph-shape.ts`    | 14    | 3       | 11    | 21    | 8 nodes (57.1%)   | 4 nodes (28.6%) |

The gitnebula row is a real run rather than a fixture: `gitnebula .` over this
checkout, 401 nodes in 0.33 s, then the story's own functions over the emitted
document. It has only 7 modules, one of which (`packages/`) holds most of the
repository — hence a wide "widest scope" and a very tight median. That spread
is the honest shape of the feature on a real tree: scoping helps enormously
for a leaf module and barely at all for the one module that contains
everything.

## Connected-only

| document                 | edgeless files | share of files |
| ------------------------ | -------------- | -------------- |
| **gitnebula** (live run) | 187 of 394     | **47.5%**      |
| `synthetic-100x2000`     | 869 of 2,000   | **43.5%**      |
| `langgraph-shape.ts`     | 0 of 11        | 0%             |

The langgraph-shaped fixture has no edgeless nodes by construction — story 5.1
built it so every file ranks, which means every file has an edge. It pins what
a scope *contains*; the synthetic fixture pins how much the filters *remove*.

## Verdict against the spec's baseline

The spec's budget is stated as measurements from a real langgraph checkout:
650 nodes with 232 edgeless, and `libs/langgraph/` scoping 662 nodes to 169.

| property                    | spec (langgraph) | gitnebula (live) | `synthetic-100x2000` | verdict                                              |
| --------------------------- | ---------------- | ---------------- | -------------------- | ---------------------------------------------------- |
| share of files with no edge | 35.7% (232/650)  | **47.5%** (187/394) | 43.5% (869/2,000) | met on both — the filter has at least as much to remove as the spec assumed |
| scope as a share of the map | 25.5% (169/662)  | 0.5%–55.1%       | 1.0%–1.4%            | met, with a caveat: the ratio depends entirely on module granularity |

**The langgraph figures are the spec's, not mine.** I do not have that checkout
locally, so they are cited rather than reproduced; every number in the tables
above is measured on fixtures committed to this repository and re-derivable by
anyone who clones it.

**The scope ratio is not a single number, and reporting it as one would
flatter the feature.** It is a function of how the repository is divided into
modules, not of this code. `synthetic-100x2000` has 100 sparsely-linked
modules, so any scope is ~1% of the map. gitnebula has 7 modules, one of which
(`packages/`) contains most of the tree — scoping to it still leaves 55% on
screen, while scoping to `reference/` leaves 0.5%.

The honest reading: **drill-down pays off in proportion to how many modules a
repository has.** On a flat repository with one dominant module it does little,
and connected-only is the lever that still works there (47.5% of files removed
on gitnebula). Both are shipped, which is why the story has two.

## Frame cost

The visible-id set is computed once per filter change and cached, not rebuilt
per frame — `buildScene` runs on every rendered frame, and rebuilding a
2,100-entry set inside it would spend exactly the budget this story exists to
free. With no filter active the computation short-circuits to `null` and both
`buildScene` and `pick` skip the membership test entirely, so an unscoped map
costs what it cost before this story.

No frame-rate measurement is claimed here: this story removes work from the
frame and adds none to the unfiltered path, and the 60 fps yardstick belongs to
the stories that own the render loop.
