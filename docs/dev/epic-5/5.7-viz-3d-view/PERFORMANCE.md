# PERFORMANCE — 5.7 3D view

Story 5.7 touches two stated performance properties, so both are measured here
rather than described: the **NFR-3 frame-rate floor** on the 2,000-node fixture
(AC-3, under NFR-13) and **ADR-0004's 2 MB gzipped viewer budget** (AC-4).

Prose adjectives are not measurements. Everything below is a number this branch
produced, with the command that reproduces it.

## Machine

| | |
| --- | --- |
| Host | macOS (darwin 25.5.0), Apple silicon |
| Browser | Chromium 151.0.7922.34 (Playwright-bundled) |
| Canvas | 1440 × 797 CSS px, DPR 1 |
| Fixture | `packages/contract/fixtures/synthetic-100x2000.json` — 100 modules / 2,000 files, 2,100 nodes |

Absolute numbers are machine-specific. The **shape** — where 3D crosses the
floor, and how it compares with 2D on the same run — is what to carry forward.

## 1. Frame rate (AC-3, NFR-3, NFR-13)

### Reproduce

```bash
pnpm --filter @gitnebula/viz build
pnpm --filter @gitnebula/viz perf
```

`perf/tests/fps-3d.pw.ts` measures the 3D view; `perf/tests/fps.pw.ts` measures
2D on the same fixture in the same run, which is what makes the comparison
below a like-for-like one. Raw output lands in `packages/viz/perf/report-3d/`
(gitignored, regenerated per run) and is transcribed here.

To see it by hand: `pnpm --filter @gitnebula/viz dev` and open
**`http://localhost:5173/?view=3d`**.

### Result — 3D takes NFR-13's second option

NFR-13 lets 3D either hold the ≥ 55 fps floor **or** document its own measured
floor and the node count at which it degrades. **3D takes the second option.**

| phase | drawn nodes | sustained fps (worst 1 s) | avg fps | median frame | p95 frame | vs 55 fps floor |
| --- | --- | --- | --- | --- | --- | --- |
| `b-frozen-pan-zoom` (folded) | ~100 | **117** | 119.8 | 8.3 ms | 9.2 ms | holds |
| `c-unfold-pan` (unfolded) | ~2,100 | **22** | 37.1 | 32.7 ms | 41.8 ms | **below** |

**This is a regression against the first measurement of this story, and it is
the price of §3's readability work.** Before the layout was stabilised and
flattened, the same phase sustained 28–29 fps; it now sustains 22. The cause is
the same one that improves the picture: filling the frame means a tighter
camera, larger discs, more covered pixels, more fill-rate per frame. The frozen
phase is untouched, because nothing there changed about how much of the screen
the nodes cover.

| | frozen | unfolded |
| --- | --- | --- |
| before the AC-8 work | 118 fps | 28 fps |
| after | 117 fps | **22 fps** |

The maintainer is the one who gets to weigh 28 → 22 fps against a map whose
files are separated instead of piled, so both numbers are here rather than only
the flattering one. The degradation knee is unmoved — still between 840 and
1,260 drawn nodes — because that curve is measured at a fixed camera, where the
flattening changes the shape of the cloud but not how many discs land on a
pixel.

2D, same fixture, same run, for comparison:

| phase | sustained fps | avg fps |
| --- | --- | --- |
| `b-frozen-pan-zoom` | 119 | 120.0 |
| `c-unfold-pan` | 92 | 117.9 |

So the 2D default is also the fast default, and the gap is entirely in the
dense, unfolded case.

### Where it degrades (AC-3's node count)

`perf/tests/degradation-3d.pw.ts` answers *where* rather than *whether*. The
camera is held still at `k = 2.2` with the map unfolded, and the drawn node
count is swept with the **layer filter** — a frame concern that removes nodes
without re-running the layout, so every sample is the same settled map at a
different density.

| drawn nodes | sustained fps (worst 1 s) | avg fps | p95 frame | vs 55 fps floor |
| --- | --- | --- | --- | --- |
| 420 | 120 | 119.9 | 9.20 ms | holds |
| 840 | 74 | 80.7 | 17.30 ms | holds |
| 1,260 | 49 | 55.4 | 25.20 ms | **below** |
| 1,680 | 35 | 41.9 | 33.30 ms | **below** |
| 2,100 | 29 | 32.2 | 34.20 ms | **below** |

> **3D holds the 55 fps floor up to roughly 840 drawn nodes, and degrades
> between 840 and 1,260.**

These numbers were re-measured after semantic zoom was made viewport-scoped
(review round eight) and are unchanged: at `k = 2.2` the fixture's whole cloud
is still in frame, so all 100 modules unfold either way. The viewport rule
bounds work on larger repositories and at higher zoom; it does not soften this
measurement, which remains the honest worst case.

Frame cost is close to linear in drawn nodes (p95 interval rises ~8 ms per 420
nodes), which points at **per-node render work** rather than at the simulation.
That matches the design: the layout freezes on settle and is not ticked at all
in these phases, while every drawn node costs a radial-gradient glow plus a
core disc, painted back-to-front because a canvas has no depth buffer.

### Settle

| view | frames | duration |
| --- | --- | --- |
| 3D | 193 | 1,609 ms |
| 2D | 148 | 1,236 ms |

Both inside FR-12's 2–3 s budget. 3D settles in more frames because its
hand-rolled integrator uses a slower alpha decay; only the ~100 top-level nodes
are simulated in either view.

### What is asserted, and what is only recorded

`fps-3d.pw.ts` asserts the run is **valid and real** — right fixture, no page
error, and the renderer actually drew the frames that were counted — plus a
usability floor of 20 fps, which is the line below which the view would be
broken rather than merely slower. It deliberately does **not** assert the 55 fps
floor: NFR-13 accepts a documented lower floor, and asserting it would turn an
accepted characteristic into a red build. AC-3's requirement that an unmeasured
3D view does not satisfy the story is met by the measurement being part of the
suite, not by the threshold.

## 2. Bundle size (AC-4, ADR-0004)

### Reproduce

```bash
pnpm --filter @gitnebula/viz build
gzip -c packages/viz/dist/index.html | wc -c
pnpm --filter gitnebula exec vitest run src/bundle.test.ts   # the budget check
```

### Result — well inside budget

| build | raw | gzipped | share of the 2 MB budget |
| --- | --- | --- | --- |
| `epic/5-onboarding` (before this story) | 220,194 B | 65,716 B | 3.13 % |
| with the 3D view | 250,100 B | 70,814 B | **3.37 %** |
| delta | +29,906 B | **+5,098 B** | +0.24 pp |

**+7.7 % gzipped for an entire second renderer.** The before-figure was
produced by building `epic/5-onboarding` from a clean `git archive` extraction,
so it is a real measurement rather than a remembered one. Both rows were
re-measured after this branch rebased onto the epic with story 5.6 merged, so
the delta is attributable to 5.7 alone rather than to the two stories together
— an earlier pass measured 64,892 B → 69,867 B against the pre-5.6 base and
reached the same +7.7 %.

This is the ADR-0004 consequence of the no-WebGL decision. A WebGL renderer
plus a scene-graph library would have been one to two orders of magnitude more
and would have needed a genuine fallback path as well.

The budget itself is enforced by `packages/cli` (`describeViewerSize`,
`VIEWER_GZIP_BUDGET_BYTES`), whose 17 tests pass on this branch.

## 3. Occlusion — AC-8's missing number

AC-8 asked whether depth separates clusters that overlap in the plane. It was
the only criterion in this story with no measurement behind it, and it is the
one that failed review: the maintainer ran the 3D view and reported a dense
blur where everything blended together.

**Metric.** The share of drawn node discs whose projected area is more than
half covered by a nearer disc, sampled at 96 deterministic points per disc,
walked farthest-first — the order the renderer paints in, so "nearer" means
"on top". Committed as `packages/viz/src/engine/occlusion3d.test.ts`, with a
self-check on cases whose answer is known by hand and a 2D control.

### Reproduce

```bash
pnpm --filter @gitnebula/viz test -- occlusion3d
# against a real repository rather than the fixture:
node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/self.json
```

### What the review found, and why

Measured on **this repository** (456 nodes, 7 modules), scoped to `packages/`
(253 files), each view at its own `fit`:

| | drawn | buried > 50 % |
| --- | --- | --- |
| 2D | 254 / 254 | **0.0 %** |
| 3D, before | **60 / 254** | 51.7 % |
| 3D, after the stability fix | **254 / 254** | **17.7 %** |
| 3D, after the frame work too | **254 / 254** | **22.0 %** |

The first column is the finding. 3D drew 60 of 254 files because the other 194
had **diverged to ~1e13 world units** — `MemberLayout3D` was numerically
unstable on a large module. What looked like a density problem was a layout
that had thrown most of the module off the number line; the "dense blur" was
the residue that happened to land near the camera. Three causes, all fixed:
repulsion floored the *squared* distance rather than the distance, damping
retained far more velocity than the 2D layout (0.86 / 0.8 against 0.55 / 0.5),
and there was no collision term at all where 2D has `forceCollide` at both
levels.

### Across module sizes, not just the one that broke

`packages/` at 253 files is the case that diverged, so it is the case the fix
was tuned against — which is exactly why it is not the only one measured. Every
module of this repository, each scoped and fitted on its own:

| module | files | drawn | buried > 50 % (3D) | 2D |
| --- | --- | --- | --- | --- |
| `packages/` | 253 | 254 / 254 | 22.0 % | 0.0 % |
| `docs/` | 127 | 128 / 128 | 10.9 % | 0.0 % |
| `test-fixtures/` | 39 | 40 / 40 | 7.5 % | 0.0 % |
| `scripts/` | 4 | 5 / 5 | 0.0 % | 0.0 % |
| `.github/` | 2 | 3 / 3 | 0.0 % | 0.0 % |
| `reference/` | 1 | 2 / 2 | **50.0 %** | 0.0 % |

Occlusion falls with module size, as it should, and **every node reaches the
frame at every size** — the column that was 60 / 254 before the layout was
stabilised.

`reference/` looks alarming and is not: it holds one file, so its module disc
covering that file is one buried node out of two. At n = 2 the metric has no
resolution, and a module drawn over its own single member is the encoding
working rather than failing. Recorded rather than filtered out, because a
threshold that quietly excluded inconvenient cases would not be a measurement.

### Member spacing, chosen by measurement

`MEMBER_COLLIDE_PADDING_3D`, on `packages/`:

| padding | 1.2 | 6 | 12 | **18** |
| --- | --- | --- | --- | --- |
| buried > 50 % | 63.4 % | 51.6 % | 29.9 % | **17.7 %** |

Far larger than the 2D value of 1.2 because in 2D the plane *is* the screen, so
collision separates exactly what the eye sees. In perspective a ball of N
members projects onto a disc and readability goes as `N · (r / R)²`; at 1.2 a
253-file module settled into a ball 38 units across whose members' own discs
summed to more than the ball's projected area — overlap was guaranteed by
geometry before a frame was drawn.

### Using the frame

The maintainer's second note was that the map sat squeezed in a corner.
Measured: the cloud filled **28 % of the width against 69 % of the height**.
Two causes, both addressed:

- `fit` sized the **bounding sphere**, whose silhouette is a circle inscribed
  in the *shorter* viewport axis — so a 16:10 canvas can never use its width.
  It now takes one correction step onto the silhouette the cloud actually
  casts.
- The cloud was a **ball**, and a ball projects to a circle. It is now
  flattened about Y into a disc (`GRAVITY_Y_3D`), which also keeps its
  silhouette stable under idle rotation, since yaw is the axis that turns.

| | width used | height used | buried |
| --- | --- | --- | --- |
| before | 28 % | 69 % | 22.8 % |
| after | **62 %** | **95 %** | 28.5 % |

**The trade is real and is recorded rather than argued away:** filling the
frame means a tighter camera, which means larger discs, which means more
overlap. Flattening harder fills more and costs more — at `GRAVITY_Y_3D = 4`
the map reaches 89 % of the width at 34.3 % buried and starts pushing nodes
past the padding.

### The guarantee that changed

Sphere-fit never clipped at any orientation. Silhouette-fit sizes to the
orientation `fit` was called at, so idle rotation can afterwards carry a corner
past the edge — **measured worst case 45.9 px of 800, i.e. 5.7 %**, asserted at
7 %. That is a deliberate trade of a guarantee for a usable frame, not an
oversight.

### The limit worth stating plainly

3D will not reach 2D's 0 %. 2D collides in the projection plane, so its
separation is exactly what the eye sees; a projected volume can always stack
two nodes that share a line of sight, however well the layout is spread. The
number to judge 3D by is whether it is low enough to read, not whether it
matches the plane.

## 4. Known lever, not taken

The obvious optimisation is the renderer, not the layout: the per-node radial
gradient dominates, and at 2,100 nodes most nodes project to a radius of a few
pixels where a gradient is invisible anyway. Drawing small nodes as flat discs
(or from a pre-rendered sprite atlas) would very likely move the knee well past
2,100.

It is **not** done here. It is a render-quality change affecting the shared
node encoding (UX-DR4), no acceptance criterion asks for it, and 5.7 is already
the largest story in the epic. Recorded so the next person starts from the
measurement instead of from a guess.
