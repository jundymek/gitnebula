# 5.6 — Blast radius from co-change

**Story:** `docs/implementation-artifacts/epic-5-onboarding/5.6-viz-blast-radius.md`
**Module:** `viz` · **Base:** `epic/5-onboarding` · **Contract:** unchanged
(`schemaVersion` stays `"1.0"`)

## What this story does

`analysis.json` has carried a `cochanges` array since epic 1, and until now the
Viewer read it in exactly one place: a metric row naming three partners as a
joined string. This story turns it into a section of the detail panel that the
reader can act on, and gives the map a way to show the partner set.

Selecting a node now shows **blast radius** — every node that historically
changed together with it, with the number of commits they shared, ordered
count-descending then by id. Clicking a partner flies to it. A `show on map`
toggle marks the whole set on the canvas.

Why this is worth a section rather than a row: co-change is the one thing on
this map that **no static analysis can produce**. Measured on this repository's
own history (90-day window, 83 commits), `packages/viz/src/chrome/chrome.ts`
co-changes with `packages/viz/src/styles.css` in 9 commits — and the import
graph connects them with nothing, because a `.css` file is not imported by a
`.ts` file at all. That pairing is invisible to `deps` and obvious to `githist`.

## The three claims worth reading the diff for

### 1. It reads; it does not compute (AD-1)

Partner lookup selects the pairs touching one node and sorts them. That is
selection and sorting, not aggregation. Nothing here rolls a file's partners up
into modules or a module's down into files — that would be a new aggregation
computed in the Viewer, which AD-1 puts in the pipeline or nowhere. A file
therefore shows file partners, a module shows module partners, which is the
shape the contract already ships.

### 2. The order cannot depend on the machine (NFR-12)

The tie-break is an explicit code-unit comparison, the same one
`githist/src/cochange.ts` used when it produced these pairs. The row this story
replaced used `localeCompare`, which is locale-aware: under most ICU locales
`a-b` sorts before `ab`, by code unit the reverse — so two readers of one
`analysis.json` could see two different lists. `blast-radius.test.ts` scans this
story's source files and fails if the banned method appears in any of them,
which is why its name is not written in a comment either.

### 3. The mark is not an edge (AC-4)

Co-change is **not** a dependency. Drawing it as a line between two nodes would
tell the reader something false, so the map marks the partner *nodes* with a
dashed ring outside the selection ring, in a magenta the layer palette does not
contain — and adds nothing to the edge list. The encoding test asserts the
scene's edges are identical with the mark on and off; it was watched failing
against a deliberately broken build that drew the partners as lines.

## The empty state is the majority state

610 of 662 nodes on the langgraph checkout the spec measured, and **330 of 384**
on this repository, appear in no co-change pair at all. A section that showed
nothing would read as a broken feature on most nodes the reader opens. So it
names its cause and its lever, following the conventions story 5.5 put in the
base:

> nothing changed with it in 3 or more commits of the last 90 days
> re-run with `--window-days` to look further back than 90 days

One sentence covers both reasons a pair can be missing — never shared a commit
in the window, or shared fewer than three — because the contract carries
surviving pairs only and genuinely cannot tell them apart. Naming one specific
cause would be a guess printed as a fact.

Where the **repository** caught no commits in the window, the section says
nothing at all: the panel-level notice from story 5.5 already states that once,
and repeating it per node would blame the node for a property of the repository.
That precedence rule is 5.5's, kept rather than reinvented.

## Files

### New

| path | why |
| --- | --- |
| `packages/viz/src/chrome/blast-radius.test.ts` | determinism (AC-1), level disambiguation (AC-5), empty states (AC-3), the section's DOM and the toggle (AC-2, AC-4) |
| `packages/viz/src/engine/blast-radius-encoding.test.ts` | the mark over render state, and the "no edge was added" assertion (AC-4) |

Both are new files rather than cases appended to `panel.test.ts` /
`render.test.ts`: 5.7 works in the same package this wave, and a new file is a
merge neither branch can lose.

### Updated

| path | why |
| --- | --- |
| `packages/viz/src/chrome/panel-model.ts` | `cochangePartners` (whole ordered list), deterministic tie-break, the `blastRadius` model, `MIN_COCHANGE_COUNT` restated for copy |
| `packages/viz/src/chrome/panel.ts` | the section, its partner buttons, its toggle, its empty state |
| `packages/viz/src/chrome/chrome.ts` | two additive action wirings: `flyTo` for a partner, `setBlastRadius` for the toggle |
| `packages/viz/src/chrome/empty-state.ts` | one appended builder, so the epic keeps one empty-state convention in one home |
| `packages/viz/src/engine/types.ts` | `setBlastRadius` / `getBlastRadius` on `GraphEngine` |
| `packages/viz/src/engine/engine.ts` | the marked set as frame state; cleared on `load` |
| `packages/viz/src/engine/render.ts` | optional `RenderScene.blastRadius`, the `inBlastRadius` predicate, the dashed ring |
| `packages/viz/src/engine/constants.ts` | the mark's colour, offset, alpha, width and dash |
| `packages/viz/src/engine/index.ts` | export the encoding constants, as the layer colours are |
| `packages/viz/src/styles.css` | the section's rules and the `--cochange` variable |
| `packages/viz/src/test-support/fake-canvas.ts` | record `setLineDash`, so the dash is assertable |
| `packages/viz/src/chrome/panel-model.test.ts`, `panel.test.ts` | the `co-changes with` row's assertions, superseded by this story |

## Decisions taken along the way

Recorded in full in `DECISIONS.md` on the branch. The two a reviewer is most
likely to question:

- **Story 3.4's `co-changes with` row is gone**, not kept alongside the section.
  The spec asked this story to "reconcile with that row rather than duplicating
  it", and two renderings of one datum in one panel is the duplication it meant.
  The row's derivation survives as the section's first three entries, so the
  summary cannot drift from the list.
- **The ≥ 3 threshold is restated in `viz`**, not imported. `viz` may depend on
  `contract` only (AD-2), and the bound is deliberately analyzer policy that
  never travels in `analysis.json` — the schema says so. `HOT_THRESHOLD` is
  restated in the Viewer for exactly the same reason. It is used for copy only;
  nothing re-filters on it.

## Cross-story coordination

`setBlastRadius` / `getBlastRadius` are new members of `GraphEngine`, which
story 5.7 must also satisfy with its second engine implementation. Its owner
asked to be told before any interface member landed; they were told before a
line of it was written, approved the exact signature, and implemented both in
`engine3d.ts` on their own branch — so neither merge order leaves a hole.

## Interface addition, in full

```ts
/** Mark a node's co-change partner set on the map, or clear it with null. */
setBlastRadius(ids: readonly string[] | null): void;
/** The partner set currently marked; empty when nothing is. */
getBlastRadius(): readonly string[];
```

No new `GraphEngineEventMap` key: chrome asked for the set and already knows
it, so nothing has to be published back.
