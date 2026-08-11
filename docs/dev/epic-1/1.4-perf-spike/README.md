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
| `src/fps.ts`       | per-phase fps + per-frame work aggregation, tab-visibility guard |
| `src/unfold.ts`    | viewport intersection, unfold set and unfold/collapse diff (ADR-0006) |
| `src/camera-script.ts` | deterministic camera keyframes (the scripted sequence)     |
| `src/fixture.ts`   | fixture loading, with a seeded generator fallback              |
| `src/main.ts`      | the three measured phases                                      |

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

### The run declares itself valid or invalid

`runValid` in each results file is the first thing to read. Three conditions
make a run look completely normal while measuring nothing of interest, so each
is detected and recorded rather than left to the reader:

| field             | what a bad value means                                              |
| ----------------- | ------------------------------------------------------------------- |
| `fixtureSource`   | anything but `contract-fixture` means the yardstick document did not load |
| `settleTimedOut`  | phase (a) hit the 3,000-frame cap — (b) and (c) then measure a layout frozen mid-motion, not a settled one |
| `hiddenFrames` / `documentEverHidden` | the tab was backgrounded at some point: Chrome throttles rAF there — and can suspend it outright, which is why the `visibilitychange` event is watched as well as the frame counter |

The visibility guard was added because it happened: the first attempt at these
numbers ran with the tab behind another window, and phase (a) took over 90
seconds to do what takes 4 seconds in the foreground. Throttled runs do not
announce themselves — the phase structure, the JSON and the status line all
look right — so the page now refuses to call such a run `done` without
`INVALID RUN` beside it. Counting throttled frames is not sufficient on its
own: Chrome can suspend rAF outright, in which case no frame callback ever
observes the hidden state and the counter stays at zero precisely in the worst
case, so a `visibilitychange` listener is the second witness.
**Reproducing these numbers requires the spike tab visible and in front.**

All three committed runs have `runValid: true`.

### Fixture provenance

`fixtureSource` in each results file records which graph produced the run.

All three recorded runs say **`contract-fixture`**: story 1.3's committed
`packages/contract/fixtures/synthetic-100x2000.json` — 100 modules, 2,000
files, 20 files per module, 1,095 import edges (239 module-level, 856
file-level). The dev server serves it at `/fixture.json` (see the
`contractFixture` plugin in `perf-spike/vite.config.ts`); it lives in the
contract package, outside the spike's Vite root, so without that plugin the
page's fetch would 404 and the loader would fall back silently to its seeded
generator. The fallback is still in the code as a last resort, and a run that
uses it is marked invalid.

The earlier version of this report recorded three `generated-fallback` runs
made before 1.3 merged, against a denser generated graph (4,132 edges). The
verdict did not move; the numbers below replace them entirely.

## Results

100 modules, 2,000 files, 1,095 edges, seed `gitnebula-spike`. Ranges are
across the three committed runs.

| phase                             | sustained fps (worst 1 s) | mean frame work | p95            | worst frame     |
| --------------------------------- | ------------------------- | --------------- | -------------- | --------------- |
| (a) active simulation, all 2,100  | **59** (all runs)         | 5.15 – 5.26 ms  | 5.6 ms         | 14.7 – 18.5 ms  |
| (b) frozen + scripted pan/zoom    | **59** (all runs)         | 0.18 – 0.20 ms  | 0.3 ms         | 0.4 – 0.7 ms    |
| (c) viewport unfold while panning | **59** (all runs)         | 0.55 – 0.58 ms  | 1.6 – 1.7 ms   | 2.9 – 4.2 ms    |

Average fps was 59.95 in every phase of every run.

Supporting numbers:

- Phase (a) reached Settled in **239 frames** (~4.0 s) from the seeded scatter,
  identically in all three runs.
- Phase (b) module drift over the whole 10 s sweep: **0.0 px**. Frozen is
  actually frozen — the simulation is not ticked at all.
- Phase (c) over the 15 s pan: **67–69 unfold events and 55–56 collapse
  events**. At peak, **13–14 modules were unfolded at once — 260–280 file nodes
  of the 2,000**, with 521–554 links drawn. The graph never accumulates: what
  leaves the viewport collapses.
- Frames are vsync-capped at 60, so 59 sustained is the ceiling, not a
  shortfall. The headroom is in the work times: phase (c) uses **~0.55 ms of a
  16.7 ms budget on average and 4.2 ms at its worst observed frame** — roughly
  a 4× margin at the worst frame and 29× at the mean.

Phase (a) is deliberately the worst case ADR-0006 exists to avoid: every file
node simulated at once. It still holds 59 fps, at ~5.2 ms mean frame work —
about 9× the cost of phase (c). That is the cost the viewport-scoped rule buys back,
and it also means a full-graph settle remains affordable as a one-off on load.

### Viewport scope is what is being measured

ADR-0006's rule is unfold **and** collapse: "off-screen modules stay
collapsed", and dropping below `UNFOLD_ZOOM` collapses everything. The first
version of this spike only ever unfolded — modules that left the viewport kept
their file nodes — so the pan accumulated 1,820 of the 2,000 files and the
phase measured something the viewer will never do. It still held 59 fps, which
is why the defect was invisible in the numbers and had to be caught by reading
the code.

With collapse implemented, the live set stays at 13–14 modules, which is the
"low hundreds worst case" the ADR predicted. The correction moved phase (c)
mean frame work from ~1.3 ms to ~0.55 ms, so the earlier figures were
conservative rather than optimistic — the verdict was never at risk, but the
evidence now matches the claim.

Note that `peakSimulatedNodes` equals `peakShownFiles` in these runs. That is
not a bug: the peak is sampled on the frame a batch of modules unfolds, when
every shown file belongs to a wake that has not settled yet. Freeze-on-settle
still drops each wake a few hundred milliseconds later; with viewport collapse
in place it is the *scope* rather than the *freeze* that bounds the peak.

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

**A zero is only worth as much as the set it was measured over.** An earlier
version of this measurement re-partitioned files into "waking" and "frozen"
only when a module entered or left the viewport. But a wake also disappears
when it *settles*, and its files become frozen non-members at that moment — so
they went unmeasured until the next viewport transition, which is precisely the
interval where a freshly frozen file is most likely to still be drifting. The
partition is now refreshed whenever the wake set changes for any reason, which
is a strictly larger measured set. The answer is still 0.0 px, and it now means
what it says.

Getting this to zero required three implementation details that are easy to get
wrong, and all three belong in the Epic 3 spec that implements unfold:

1. **A wake must not include `forceCenter`.** Centering acts on every node in
   the simulation, so a wake that includes previously-settled files drags them
   across the map on each new unfold. The first working version of this spike
   measured **129 px/frame** of non-member displacement for precisely this
   reason — 258× over the Settled bound. Pinned modules anchor the layout; no
   centering force is needed or wanted during a local settle.
2. **A wake must contain only the newly woken members** plus their pinned
   module as anchor. Previously unfolded files must not be simulation nodes at
   all — then they are untouchable by construction rather than by tuning.
3. **One wake per module, not per batch.** Modules leave the viewport
   individually, so a wake spanning several modules cannot be taken apart on
   collapse without re-seeding the survivors' positions. Per-module wakes make
   collapse a deletion. The cost is that file imports crossing between two
   unfolded modules are drawn but not simulated — acceptable here, and worth an
   explicit decision in the Epic 3 story.

Each wake runs its own short-lived simulation until Settled and is then dropped
(freeze-on-settle, addendum A4).

## Verdict

`VERDICT: canvas-2d viable (>= 55 fps sustained in phases b and c)`

Sustained fps is 59 in both phases (and in phase (a) as well) across three
runs, against a 55 fps bar; worst-frame work in phase (c) is 4.2 ms against a
16.7 ms budget.

Because the verdict is *not* escalation, AC-4 does not apply: **no Epic 2/3
story spec needs amending.** Stories 2.5, 3.3 and 3.5 launch as written, against
d3-force + canvas 2D. The cosmos.gl path stays where AD-5 put it — a reserved
escape hatch behind the GraphEngine seam, not a scheduled migration.

Three things the Epic 3 unfold story should inherit from this spike, all from
the AC-5 section above: no `forceCenter` inside a wake, wakes scoped to newly
woken members only, and one wake per module so that collapse is a deletion.
They are the difference between a local settle and a map that lurches on every
pan.

## Caveats

- One machine, one browser, three runs. The margins are wide enough (4×–28×
  headroom in phase (c)) that machine-to-machine variance is unlikely to reach
  the 55 fps bar, but this is a spike, not a benchmark suite. Story 3.5 turns
  the harness into the CI version with thresholds.
- An earlier run of the pre-collapse code measured phase (a) at 56.5 avg /
  45 worst-1s fps with a single 107 ms frame, while (b) and (c) were unaffected.
  It has not reproduced since, in six subsequent runs across two versions of
  the code. The most likely cause is machine noise during the initial settle,
  which is also where JIT warm-up lands. It is recorded because phase (a) is
  the phase with the least headroom.
- `devicePixelRatio` was 1. A retina run rasterises 4× the pixels; phase (b)'s
  ~0.21 ms mean leaves room, but the DPR-2 case is worth one confirming run
  when story 2.5 has a real renderer. The harness is now DPR-correct — camera
  and viewport maths run in CSS pixels with a DPR transform on the context —
  so a Retina run measures the same camera script and the same set of unfolded
  modules rather than a silently different one. That was a Codex finding, and
  it is what makes the confirming run meaningful instead of incomparable.
- Phase (c)'s peak counts vary slightly between runs (13 vs 14 modules) even
  though the fixture and seed are fixed. The camera script is time-based, so
  which frame lands where in the pan shifts by a frame or two between runs. The
  spread is small and does not touch the verdict.
- The spike's visual layer is deliberately crude (flat dots and lines). It is
  not evidence about the nebula aesthetic, only about frame cost.
