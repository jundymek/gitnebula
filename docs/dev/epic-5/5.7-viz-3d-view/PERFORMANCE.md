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
| `b-frozen-pan-zoom` (folded) | ~100 | **118** | 119.9 | 8.3 ms | 9.1 ms | holds |
| `c-unfold-pan` (unfolded) | ~2,100 | **28** | 47.3 | 24.7 ms | 33.4 ms | **below** |

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
| 420 | 120 | 120.0 | 9.00 ms | holds |
| 840 | 87 | 86.5 | 17.30 ms | holds |
| 1,260 | 48 | 54.3 | 25.10 ms | **below** |
| 1,680 | 36 | 39.9 | 33.40 ms | **below** |
| 2,100 | 28 | 32.0 | 41.70 ms | **below** |

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

## 3. Known lever, not taken

The obvious optimisation is the renderer, not the layout: the per-node radial
gradient dominates, and at 2,100 nodes most nodes project to a radius of a few
pixels where a gradient is invisible anyway. Drawing small nodes as flat discs
(or from a pre-rendered sprite atlas) would very likely move the knee well past
2,100.

It is **not** done here. It is a render-quality change affecting the shared
node encoding (UX-DR4), no acceptance criterion asks for it, and 5.7 is already
the largest story in the epic. Recorded so the next person starts from the
measurement instead of from a guess.
