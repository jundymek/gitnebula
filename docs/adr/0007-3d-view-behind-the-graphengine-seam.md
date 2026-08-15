# ADR-0007: The 3D view is a second `GraphEngine`, drawn on canvas 2D

Status: accepted
Date: 2026-08-15
Story: 5.7-viz-3d-view

## Context

FR-32 asks for a three-dimensional view of the same graph, so that a cloud
which overlaps in the plane can be separated by depth. AD-5 declared the
`GraphEngine` interface a **swap seam** and FR-14 called for exactly this use
of it, but until now there has only ever been one implementation behind it — a
seam with one side is an assertion, not a fact.

Three existing decisions constrain how 3D may be built:

- **AD-5** — chrome talks only to the `GraphEngine` interface and its events.
  `chrome/boundary.test.ts` enforces this, including a clause pinning the set
  of modules that may import `d3-force` to exactly `["layout.ts"]`.
- **AD-6** — the same `analysis.json` must always produce the same map. There
  is one seeded PRNG stream and no unseeded randomness in the viewer.
- **ADR-0004** — the viewer ships as a single static bundle within a **2 MB
  gzipped** budget, and must work as an ordinary static file with no backend.

NFR-3 sets a ≥ 55 fps automated floor at 100 modules / 2,000 files. NFR-13
deliberately gives 3D two ways to satisfy it: hold that floor, **or** document
its own measured floor and the node count at which it degrades.

A throwaway prototype was built first, on the question "does depth actually
help at this density, before we pay for WebGL, a second renderer and a fallback
path". It answered yes, and it answered it without WebGL.

## Decision

**1. 3D is a second implementation behind the existing interface, not a fork of
the renderer.** `Nebula3DEngine implements GraphEngine`. Chrome reaches it
through the same members and the same events; `boundary.test.ts` passes
**unchanged**. 2D remains the default, and the view switches at runtime.

**2. It renders through canvas 2D — no WebGL, no Three.js.** Perspective
projection onto the same context the 2D view uses. Depth is encoded twice:
nearer nodes are both larger (perspective) and brighter (depth fog).

**3. The layout is hand-rolled and imports no simulation library.** A
three-axis force simulation written directly, seeded from the document.

**4. The orbit camera is derived from `CameraState`, not added to it.** `k`
drives orbit distance, `x`/`y` pan the orbit target, and **yaw/pitch are
engine-internal interaction state** — the same kind of thing as hover, owned by
the engine and never reached into by chrome.

**5. 3D simulates top-level nodes only, with local member wakes on unfold**,
exactly as the 2D view does (ADR-0006).

**6. Where 3D cannot be built, the viewer degrades to the 2D map with a stated
reason** — never a blank canvas.

## Consequences

### For AD-5 — the seam is now load-bearing

The interface has been shown to admit a genuinely different implementation
without changing: different layout, different projection, different renderer,
different input model. That is the strongest evidence AD-5 has ever had, and it
is now regression-tested rather than asserted.

The cost is that the interface is **harder to change**: every member added to
`GraphEngine` must now be implemented twice, and a member added to one engine
only is a silent capability gap in the other rather than a compile error in an
obvious place. This is already live — story 5.6 added `setBlastRadius` /
`getBlastRadius` during the same wave, and coordinating it took a round of
messages between two agents before either wrote code.

**Guidance that follows:** an addition to `GraphEngine` is now a cross-story
change and should be announced as one.

### For AD-6 — determinism extends to the camera

The 3D layout and the **initial camera orientation** are both seeded from the
document. Two loads of the same `analysis.json` produce identical positions and
an identical starting pose; `replay()` returns to exactly the same map.

The orientation draws from its own stream (`hash("orientation:" + seed)`)
rather than from the layout's. Taking numbers from the layout stream would have
shifted every node position the moment a seeded orientation was introduced —
one feature silently changing another feature's output is precisely what AD-6
exists to prevent.

### For ADR-0004 — the budget survives, with room to spare

Measured on this branch:

| build | raw | gzipped | share of 2 MB budget |
| --- | --- | --- | --- |
| `epic/5-onboarding` (before) | 220,194 B | 65,716 B | 3.13 % |
| with the 3D view | 249,988 B | 70,774 B | **3.37 %** |

**+5,058 B gzipped, +7.7 %.** The no-WebGL decision is what bought this: a
WebGL renderer plus a scene-graph library would have been one to two orders of
magnitude more, and would additionally have required a real fallback path for
machines without working WebGL rather than the general availability probe that
now covers it.

### On performance — 3D takes NFR-13's second option

3D does **not** hold the 55 fps floor at full density, and this is recorded
rather than hidden. Measured on the 2,000-node fixture (see
`docs/dev/epic-5/5.7-viz-3d-view/PERFORMANCE.md` for method and raw numbers):

| condition | drawn nodes | sustained fps |
| --- | --- | --- |
| folded map, pan + zoom | ~100 | **118** |
| unfolded, pan | ~2,100 | **28** |

Degradation curve at a fixed camera:

| drawn nodes | sustained fps | vs 55 fps floor |
| --- | --- | --- |
| 420 | 120 | holds |
| 840 | 87 | holds |
| 1,260 | 48 | below |
| 1,680 | 36 | below |
| 2,100 | 28 | below |

**3D holds the floor to roughly 840 drawn nodes and degrades between 840 and
1,260.** The 2D view sustains 92–119 fps across the same phases, so the 2D
default is also the fast default.

The cause is per-node canvas work — a radial-gradient glow per node, painted
back-to-front with no depth buffer — not the simulation, which freezes on
settle. Two consequences follow. First, **2D must stay the default**, which
AC-1 requires for other reasons as well. Second, the obvious future lever is
the renderer rather than the layout: cheaper glows at small projected radii,
or an impostor sprite atlas.

### Rejected alternatives

**Three.js / WebGL.** Rejected on ADR-0004's budget and on the fallback path it
would have required. The prototype showed canvas 2D is sufficient for the
question the view exists to answer.

**Extending `CameraState` with yaw/pitch.** Rejected: it is a breaking change
to a shared interface, and it would force every 2D consumer to carry two fields
that mean nothing to it, weakening the very seam this ADR strengthens.

**One cloud containing every file, as the prototype had.** Rejected: it would
make 3D a *different map* rather than the same map from another angle, and
`unfoldedModules()` is on the interface and has to mean something. It is also
what keeps the hand-rolled O(n²) repulsion at ~100 nodes instead of 2,000.
