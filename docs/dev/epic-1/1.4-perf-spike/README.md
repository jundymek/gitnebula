# 1.4 — Performance spike: 2,000 nodes on canvas 2D

Does d3-force with Barnes–Hut, freeze-on-settle and viewport-scoped unfold
hold 60 fps at the DoD scale (100 modules / 2,000 files) on a canvas 2D
renderer? This spike measures it and records a verdict, because Epic 2/3 viz
specs are written against the answer.

**Verdict is at the bottom.** Raw measurements: `results-run-1.json` …
`results-run-3.json` in this folder — three full runs, so the numbers quoted
below can be checked against their evidence and the run-to-run spread is
visible rather than asserted.

## What was built

A self-running spike page under `packages/viz/perf-spike/`. The page is
throwaway; the measurement parts are meant to survive into story 3.5's CI
harness.

| file               | role                                                         |
| ------------------ | ------------------------------------------------------------ |
| `src/prng.ts`      | mulberry32 seeded by `hash(repo.name)` (AD-6)                  |
| `src/settle.ts`    | Settled detector — max displacement < 0.5 px/frame × 30 (AD-6) |
| `src/fps.ts`       | per-phase fps + per-frame work time aggregation                |
| `src/unfold.ts`    | viewport intersection test and unfold set (ADR-0006)           |
| `src/camera-script.ts` | deterministic camera keyframes (the scripted sequence)     |
| `src/fixture.ts`   | fixture loading, with a seeded generator fallback              |
| `src/main.ts`      | the three measured phases                                      |

A note on what the page renders in phase (c): the drawn link set is rebuilt
from everything currently unfolded, not from the live simulations. Deriving it
from live wakes instead means a module's import edges stop being drawn the
moment it settles, and the measured render cost drifts below the real one —
that bug was present in the first version of these numbers and is why the
rendered link count (5,546 at peak) is now reported alongside the node count.

## Methodology

- **Scripted, not hand-driven** (AC-2). The camera follows a fixed keyframe
  list interpolated on the rAF clock. No pointer input takes part in any
  measured phase. The keyframes are derived from the *measured* extent of the
  settled layout rather than a guessed world radius — an earlier version panned
  around the origin while the layout had settled around (−1173…989, −1223…1074)
  and unfolded nothing, producing a phase (c) number that measured an empty
  screen. Deriving the path from bounds is what makes the phase honest.
- **Frame counting.** Every rAF callback records its timestamp and the time its
  own work took. `avgFps` is frames ÷ wall duration. `worst1sFps` is the lowest
  frame count in any sliding 1-second window — that is the "sustained" number
  the verdict is judged on, because an average hides a stall.
- **Why work time as well as fps.** All three phases sit at the vsync ceiling,
  so fps alone proves the budget was met but not by how much. The per-frame
  work time (simulation ticks + render, excluding spike-only instrumentation)
  is what shows the remaining headroom against the 16.7 ms budget.
- **Simulation.** `forceManyBody` (Barnes–Hut quadtree, θ = 0.9 default),
  `forceLink` at distance 40, `alphaDecay` 0.02, ticked manually inside the rAF
  callback so measured frames include simulation *and* render.
- **Hardware.** Apple Silicon macOS (Darwin 25.5.0), Chrome 151, canvas
  1728 × 844 CSS px at `devicePixelRatio` 1, 60 Hz display. Numbers are from
  one machine; the ratios matter more than the absolute values.

### Fixture provenance — read this before trusting the numbers

`fixtureSource` in each results file records which graph produced the run.

All three recorded runs say **`generated-fallback`**: story 1.3's committed synthetic
document had not merged into the epic branch when this spike ran, so the page
used its own seeded generator producing the same shape — 100 modules, 2,000
files, 4,132 import edges, 80 % intra-module file imports. The topology is
equivalent for layout-cost purposes (node count, edge count and clustering are
what drive Barnes–Hut and render cost), but it is **not** the story's nominal
fixture. When 1.3 lands, `pnpm --filter @gitnebula/viz perf-spike` picks up
`fixture.json` automatically and the run re-records itself as
`contract-fixture`. The verdict below is not expected to move — the margins are
wide — but the re-run is the confirmation, and it is cheap.

## Results

100 modules, 2,000 files, 4,132 edges, seed `gitnebula-spike`. Ranges are
across the three committed runs.

| phase                             | sustained fps (worst 1 s) | mean frame work | p95           | worst frame     |
| --------------------------------- | ------------------------- | --------------- | ------------- | --------------- |
| (a) active simulation, all 2,100  | **59** (all runs)         | 5.27 – 5.28 ms  | 5.7 ms        | 15.4 – 16.8 ms  |
| (b) frozen + scripted pan/zoom    | **59** (all runs)         | 0.17 – 0.19 ms  | 0.3 ms        | 0.6 – 1.1 ms    |
| (c) viewport unfold while panning | **59** (all runs)         | 1.29 – 1.35 ms  | 3.0 – 3.1 ms  | 5.0 – 5.4 ms    |

Average fps was 59.9 – 60.0 in every phase of every run.

Supporting numbers:

- Phase (a) reached Settled in **243 frames** (~4.0 s) from the seeded scatter.
- Phase (b) module drift over the whole 10 s sweep: **0.0 px**. Frozen is
  actually frozen — the simulation is not ticked at all.
- Phase (c): **83–84 unfold events** over the 15 s pan. At peak, **1,820 file
  nodes and 5,546 links** were being rendered, while only **540 nodes** were
  being simulated — the rest had settled and been frozen. That gap is the
  mechanism working: render scales with what is on screen, simulation with what
  is still moving.
- Frames are vsync-capped at 60, so 59 sustained is the ceiling, not a
  shortfall. The headroom is in the work times: phase (c) uses **~1.3 ms of a
  16.7 ms budget on average and 5.4 ms at its worst observed frame** — roughly
  a 3× margin at the worst frame and 12× at the mean.

Phase (a) is deliberately the worst case ADR-0006 exists to avoid: every file
node simulated at once. It still holds 59 fps, at ~5.3 ms mean frame work —
about 4× the cost of phase (c). That is the cost the viewport-scoped rule buys
back, and it also means a full-graph settle remains affordable as a one-off on
load.

**One outlier worth recording.** An earlier run of the same code measured phase
(a) at 56.5 avg / 45 worst-1s fps with a single 107 ms frame, while phases (b)
and (c) were unaffected at 59. It did not reproduce in any of the three
committed runs. The most likely cause is machine noise rather than the
renderer — a single long frame during the initial settle, which is also where
JIT warm-up and the fixture build land. It is noted because phase (a) is the
phase with the least headroom, and because the verdict should not rest on a
number whose spread has been quietly filtered.

## AC-5 — is the wake actually local?

Yes, and the measured answer is exactly zero.

| measurement                                             | value      | bound            |
| ------------------------------------------------------- | ---------- | ---------------- |
| Non-member per-frame displacement (max over phase c)     | **0.0 px** | < 0.5 px/frame   |
| Non-member cumulative drift over the whole phase         | **0.0 px** | —                |
| Pinned module per-frame displacement                     | **0.0 px** | < 0.5 px/frame   |

"Non-member" here means every file node on screen that no live wake is
simulating — i.e. the members of modules unfolded earlier, which had already
settled. Module nodes are reported separately because pinning makes their zero
trivial; the interesting zero is the one for already-unfolded files.

Getting this to zero required two implementation details that are easy to get
wrong, and both belong in the Epic 3 spec that implements unfold:

1. **A wake must not include `forceCenter`.** Centering acts on every node in
   the simulation, so a wake that includes previously-settled files drags them
   across the map on each new unfold. The first working version of this spike
   measured **129 px/frame** of non-member displacement for precisely this
   reason — 258× over the Settled bound. Pinned modules anchor the layout; no
   centering force is needed or wanted during a local settle.
2. **A wake must contain only the newly woken members** plus their pinned
   modules as anchors. Previously unfolded files must not be simulation nodes
   at all — then they are untouchable by construction rather than by tuning.

Each wake runs its own short-lived simulation until Settled and is then dropped
(freeze-on-settle, addendum A4).

## Verdict

`VERDICT: canvas-2d viable (>= 55 fps sustained in phases b and c)`

Sustained fps is 59 in both phases (and in phase (a) as well) across three
runs, against a 55 fps bar; worst-frame work in phase (c) is 5.4 ms against a
16.7 ms budget.

Because the verdict is *not* escalation, AC-4 does not apply: **no Epic 2/3
story spec needs amending.** Stories 2.5, 3.3 and 3.5 launch as written, against
d3-force + canvas 2D. The cosmos.gl path stays where AD-5 put it — a reserved
escape hatch behind the GraphEngine seam, not a scheduled migration.

Two things the Epic 3 unfold story should inherit from this spike, both from
the AC-5 section above: no `forceCenter` inside a wake, and wakes scoped to
newly woken members only. They are the difference between a local settle and a
map that lurches on every pan.

## Caveats

- One machine, one browser, three runs. The margins are wide enough (3×–90×
  headroom depending on phase and statistic) that machine-to-machine variance
  is unlikely to reach the 55 fps bar, but this is a spike, not a benchmark
  suite — and the phase (a) outlier above shows a single frame can be an order
  of magnitude off. Story 3.5 turns the harness into the CI version with
  thresholds.
- `devicePixelRatio` was 1. A retina run rasterises 4× the pixels; phase (b)'s
  ~0.18 ms mean leaves room, but the DPR-2 case is worth one confirming run
  when story 2.5 has a real renderer.
- The fixture provenance caveat above.
- The spike's visual layer is deliberately crude (flat dots and lines). It is
  not evidence about the nebula aesthetic, only about frame cost.
