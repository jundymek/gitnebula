# 5.7 — 3D view

A three-dimensional view of the same graph, so a cloud that overlaps in the
plane can be separated by depth (FR-32). **2D remains the default**; the view
switches at runtime through a control in the header, or directly with
`?view=3d`.

The point of the story is not the third dimension. It is that the third
dimension fits **behind an interface declared before anyone tried to put
anything else behind it** — AD-5's `GraphEngine` seam, which until now had one
implementation and was therefore an assertion rather than a fact.

Decision record: [ADR-0007](../../../adr/0007-3d-view-behind-the-graphengine-seam.md).
Measurements: [PERFORMANCE.md](PERFORMANCE.md). Walkthrough:
[MANUAL_TESTING.md](MANUAL_TESTING.md).

## The three constraints that shaped it

**`chrome/boundary.test.ts` passes unchanged.** The spec is explicit that
needing to edit it means the seam is being violated. Its last assertion pins
the modules that may import `d3-force` to exactly `["layout.ts"]`, so the 3D
layout is **hand-rolled** and imports no simulation library. The constraint and
the intended design agree: the story's own prototype is deliberately
dependency-free.

**Chrome cannot build an engine.** It may not name `HTMLCanvasElement`, so the
view switch reports a click and `app.ts` performs the swap — the same shape the
existing `onReplay` action has. Chrome never learns what a view is; it places
the control exactly as it already places the canvas.

**No WebGL, no Three.js.** Perspective projection onto the same 2D context the
2D view uses. This is what keeps ADR-0004's bundle budget (+5,058 B gzipped,
3.37 % of 2 MB) and what makes the unavailable-3D path a small probe instead of
a second rendering stack.

## Files

### New

| file | why |
| --- | --- |
| `packages/viz/src/engine/project3d.ts` | orbit camera → perspective projection, depth fog, painter ordering. Pure functions, no canvas. |
| `packages/viz/src/engine/layout3d.ts` | hand-rolled three-axis force layout, seeded; `ModuleLayout3D`, `MemberLayout3D`, `SettleDetector3D`. |
| `packages/viz/src/engine/render3d.ts` | 3D frame drawing and its own `Scene3D` type. |
| `packages/viz/src/engine/engine3d.ts` | `Nebula3DEngine` — the second `GraphEngine`. |
| `packages/viz/src/engine/view.ts` | view selection, the availability probe, and the AC-5 fallback. |
| `packages/viz/src/chrome/view-switch.ts` | the 2D/3D control: a pair of `aria-pressed` buttons that report a click and nothing more. |
| `packages/viz/perf/tests/fps-3d.pw.ts` | AC-3 — measures and records the 3D frame rate. |
| `packages/viz/perf/tests/degradation-3d.pw.ts` | AC-3 — the node count at which 3D degrades. |
| `docs/adr/0007-*.md` | AC-7. |
| tests | `project3d.test.ts`, `layout3d.test.ts`, `engine3d.test.ts`, `view3d.test.ts`, `chrome/view-switch.test.ts`, `app-view-swap.test.ts` |

Every 3D test is in a **new** file. No case was added to an existing 2D test
file — agreed with 5.6's owner so two parallel stories in one package never
meet in a merge, and it keeps the 2D suite's diff empty, which is how "2D comes
out of this story unchanged" is demonstrated rather than claimed.

### Updated

| file | change |
| --- | --- |
| `packages/viz/src/app.ts` | owns the engine swap, carries the reader's state across it, reads `?view=`, wires the switch. |
| `packages/viz/src/chrome/chrome.ts` | places the switch in the header slot; adds the `destroyControls` option (code review). |
| `packages/viz/src/chrome/header.ts` | one new slot, `VIEW_SLOT_ID`, on its own line. |
| `packages/viz/src/engine/index.ts` | exports the 3D factory and the view helpers (append only). |
| `packages/viz/src/test-support/fake-canvas.ts` | records `measureText` — the 3D label grid needs metrics; the 2D renderer never measured text. Test-only, additive. |
| `packages/viz/src/engine/render3d.ts` | imports 5.6's `COCHANGE_RING_*` constants after the rebase. |
| `packages/viz/perf/src/page-helpers.ts` | `openViewer(page, { view })`. |
| `.gitignore` | `perf/report-3d/`, matching how the 2D report is handled. |

## How it works

**The layout** simulates **top-level nodes only** — modules and repository root
files — with member files waking in local per-module simulations on unfold,
exactly as the 2D view does (ADR-0006). 3D showing every file at once would be
a *different map* rather than the same map from another angle, and
`unfoldedModules()` is on the interface and has to mean something. It is also
what keeps the O(n²) repulsion at ~100 nodes instead of 2,000.

**The camera** is the subtle part. `CameraState` is `{x, y, k}` and the
interface must not change, so:

- `k` → orbit **distance** (inverse: zoom in = closer),
- `x`/`y` → pan of the orbit **target**,
- **yaw/pitch → engine-internal state**, not on the seam.

Yaw and pitch are the same *kind* of thing as hover: interaction the engine
owns and chrome never reaches into. Putting them on `CameraState` would have
been a breaking change forcing every 2D consumer to carry two meaningless
fields — weakening the seam this story exists to prove. `getOrientation()` is a
class member, not an interface one; tests and the perf harness read it, chrome
cannot.

**Depth is encoded twice**: nearer nodes are both larger (perspective) and
brighter (fog, normalised against the frame's own near/far). One cue carries
the shape; two carry the density, which is the whole reason to have depth.

**Determinism** covers the camera as well as the layout. The initial
orientation is seeded from the document, drawn from its **own** stream
(`hash("orientation:" + seed)`) rather than the layout's — taking numbers from
the layout stream would have shifted every node position the moment a seeded
orientation was added.

## Interaction

| gesture | effect |
| --- | --- |
| drag | rotate (orbit). Ends idle auto-rotation for the session. |
| shift + drag | pan the orbit target |
| wheel | zoom (orbit distance) |
| click | select — same `select` event as 2D |
| double-click a module | scope to it; empty space or the focus module leaves |
| `Escape` | leave the scope |
| switch view | mode, layers, scope, connected-only, selection and isolate all carry across |
| hover | dependency chain, same encoding and constants as 2D |

Idle auto-rotation runs until the reader rotates by hand, and never runs under
`prefers-reduced-motion` (AC-6).

## Acceptance criteria

| AC | where |
| --- | --- |
| AC-1 second impl. behind the seam, 2D default, `boundary.test.ts` unchanged | `engine3d.test.ts` "AC-1" block; `boundary.test.ts` has a **zero-line diff** |
| AC-2 determinism incl. initial orientation | `engine3d.test.ts` "AC-2" block; `layout3d.test.ts` |
| AC-3 3D perf measured and recorded | [PERFORMANCE.md](PERFORMANCE.md); `fps-3d.pw.ts`, `degradation-3d.pw.ts` |
| AC-4 bundle within ADR-0004's budget | [PERFORMANCE.md](PERFORMANCE.md) §2; `packages/cli` budget tests |
| AC-5 degrades to 2D with a stated reason | `view3d.test.ts`; `view-switch.test.ts` |
| AC-6 reduced motion: no auto-rotation, no entry animation | `engine3d.test.ts` "AC-6" block |
| AC-7 ADR | [ADR-0007](../../../adr/0007-3d-view-behind-the-graphengine-seam.md) |
| AC-8 human review | [MANUAL_TESTING.md](MANUAL_TESTING.md), left unticked |

Headline result for AC-3: **3D holds the 55 fps floor to ~840 drawn nodes and
degrades between 840 and 1,260**, reaching 28 fps sustained at the full 2,100.
This is NFR-13's second option — a documented measured floor — taken
deliberately and in the open.

## Reported, not fixed

Two defects found during this story that are **not** 5.7's to fix. Both are
recorded here and in the PR body rather than patched, because several agents
patching one bug several ways across several branches is worse than the bug.

1. **NUL byte in `packages/viz/src/engine/layout.ts`** (line 238, byte 8879).
   The 2D `topLevelLinks` joins two ids with a literal `\0`, which makes the
   scanner classify the file as binary — gitnebula's map of its own repository
   draws `layout.ts` at **`loc: 0`**, so it appears at minimum size.

   Its **edges survive**: `deps` does not read the scanner's binary flag, so
   the node keeps 3 out-edges and 4 in-edges. (The first report of this said
   the imports were lost too; its author measured the emitted `analysis.json`
   and corrected it, and this line reflects the corrected version rather than
   the original claim.)

   Found by the 5.8 agent, independently reproduced here at the byte level, and
   also confirmed by 5.6's. Now tracked as story **5.10**. It would have
   propagated into `layout3d.ts`, because a read of `layout.ts` renders the NUL
   as an ordinary space and it copies invisibly — `layout3d.ts` therefore dedups
   links through a **nested map** with no separator at all, so there is no byte
   to choose badly.

2. **`hiddenCount().visible` ignores the layer filter when no scope and no
   connected-only filter is active.** The interface documents the field as the
   survivors of *every* filter including layers, but the implementation
   short-circuits to `graph.nodes.length` on that path. Found while building
   the degradation sweep, which read 2,100 for every sample until the
   measurement was moved to the scene the renderer is actually handed. The 2D
   engine behaves identically; it belongs to 5.3/5.4.

## Deliberate omissions

- **No new CSS.** `styles.css` is 5.6's territory this wave, so the switch
  reuses the shared `modes` segmented-control class and `aria-pressed`, which
  `.modes button[aria-pressed="true"]` already styles. The pressed view is
  therefore visible without this story editing a file it does not own.
- **The renderer optimisation that would move the perf knee** — see
  PERFORMANCE.md §3. Measured, costed, and left to a story that asks for it.

## Resolved during the wave

- **5.6's `setBlastRadius`/`getBlastRadius`** were implemented here before the
  interface declared them, by agreement with its owner, so neither PR could
  block the other in either merge order. 5.6 has since merged into the epic;
  this branch is rebased onto it and `Nebula3DEngine` satisfies the widened
  interface with no edit.
- **The co-change ring now imports `COCHANGE_RING_*` from `constants.ts`**
  rather than carrying transcribed copies. While 5.6's PR was open the five
  values were duplicated locally behind a marked `TODO(rebase)`; that TODO is
  resolved and the duplicates are gone, so the two views cannot drift on the
  encoding — which was the whole argument for drawing the ring in 3D at all.
- **The renderer optimisation that would move the perf knee** — see
  PERFORMANCE.md §3. Measured, costed, and left to a story that asks for it.
