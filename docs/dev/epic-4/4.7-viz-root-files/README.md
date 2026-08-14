# 4.7 — The Viewer draws the repository's root files

## What was wrong

`packages/viz/src/engine/graph.ts` dropped every `kind: "file"` node with
`parent: null` on the floor:

```ts
if (node.kind !== "file" || node.parent === null) return;
```

Member files are the only route a file node had into a layout, so a
repository-root file was in no module, in no simulation, and in no scene — at
any zoom level. Pointed at `free-proxy`, gitnebula drew two modules and nothing
else: **7 of 12 file nodes and 554 of 679 lines (82%) were missing from the
map**, including the largest file in the repository.

Neither half of the pipeline was wrong. Story 2.1 deliberately gives root files
`parent: null` rather than inventing a synthetic `./` module that would have to
claim a layer by ADR-0002's dominance rule over an arbitrary bag of files. The
emitted `analysis.json` was correct all along; the Viewer had never learned the
case, because **not one contract fixture contained a parent-less file node** —
`viz` is built against the fixtures by design, so it was developed against a
world where this node shape does not occur.

## The decision (AC-2): root files are top-level and always visible

A root file joins the **module-level** layout beside the module nodes and is
drawn at every zoom level. It never unfolds and it never collapses.

Why, and not "appears with unfolding":

1. **Unfold has no referent for it.** `MemberLayout` is anchored on a module's
   position and contains that module's members alone — that structure is what
   makes ADR-0006's "unfolding does not disturb the global layout" true by
   construction rather than by tuning. A parent-less file has neither an anchor
   nor a membership set.
2. **ADR-0006's budget is untouched.** The ADR narrows unfold to bound the
   *simulated file count* by what fits on screen. Root files are a handful per
   repository (7 in `free-proxy`, 15 in this one), so admitting them
   permanently is a fixed, tiny cost — measured in `PERFORMANCE.md`.
3. **AC-2's no-shift requirement then holds structurally.** There is no
   appearance event to shift anything around: a root file is in the layout from
   the first settle tick and stays there. `root-files.test.ts` asserts the full
   unfold→collapse cycle against `SETTLE_DISPLACEMENT_PX`, the same bound
   `navigation.test.ts` holds the global layout to.

The contract and the scanner are untouched, per the spec's binding Context.

## Files

### Changed

| file | what and why |
| ---- | ------------ |
| `packages/viz/src/engine/graph.ts` | UPDATE — parent-less files are collected into new `rootFileIndices`, and `topLevelIndices` (= modules ++ root files) is what the layout seeds from. `moduleIndices` stays modules-only because it is what feeds ADR-0006's unfold candidates. The old comment calling such a node an "orphan" was describing a contract violation; it now names the ordinary output of every real repository. |
| `packages/viz/src/engine/layout.ts` | UPDATE — `ModuleLayout` seeds from `topLevelIndices`. New `topLevelLinks()` lifts every file edge touching a root file to the top level (`setup.py → fp/proxy.py` becomes `setup.py → fp/`), so a root file settles beside the module it imports instead of drifting as a free particle. |
| `packages/viz/src/engine/engine.ts` | UPDATE — `updateUnfolds` filters unfold candidates to `kind === "module"`, so a root file is never asked to unfold into members it does not have. |
| `packages/contract/src/fixtures.test.ts` | UPDATE — the expected fixture list gains `root-files.json`. |
| `packages/contract/fixtures/README.md` | UPDATE — a row naming the edge the new fixture exists to exercise. |

### New

| file | why |
| ---- | --- |
| `packages/contract/fixtures/root-files.json` | AC-4 — the gap that hid the defect. Three root files beside one module, with all three edge directions that can touch one. |
| `packages/viz/src/engine/root-files.test.ts` | AC-1/2/3 — drawn, sized, coloured, pickable, selectable, fly-to-able; never unfolds; layout stable across an unfold/collapse cycle; edges render both ways. |
| `docs/dev/epic-4/4.7-viz-root-files/*` | This README, `MANUAL_TESTING.md` and `PERFORMANCE.md`. |

## Notes

- **`topLevelLinks` only lifts edges that touch a root file.** A file edge
  between two modules' files is already represented by the module-level edge
  the pipeline aggregated it into; lifting it again would double its pull and
  change the settled layout of every existing document.
- **No committed fixture has a root file**, so the settle numbers on
  `synthetic-100x2000` are byte-identical before and after (148 frames,
  1242 ms). The change cannot regress the yardstick because the yardstick does
  not exercise it — which is precisely the hole this story also closes.
- **Root-file labels follow the existing `showFileLabels` rule** (3.0× and up).
  They are files, and AC-1 asks for the same rules as any other file rather
  than for an exception.
