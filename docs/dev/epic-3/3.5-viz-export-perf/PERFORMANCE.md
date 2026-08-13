# 3.5 — Performance record

The story's stated performance property is FR-14 / SM-2: **≥ 55 fps sustained
during a scripted pan+zoom on the 100-module / 2,000-file fixture** (ADR-0006's
yardstick). This file records the method, the numbers measured on this branch,
and the verdict.

Story 1.4 asked whether canvas 2D *could* hold the budget, against a stand-in
simulation. This measures the shipped engine, so the two sets of numbers are
about different code and only the methodology is shared.

**These figures are post-unfold.** They were re-measured after story 3.3
(`viewport-scoped semantic unfold`, PR #24) merged into `epic/3-deps-python`,
so `c-unfold-pan` measures what it is named after. The pre-unfold figures it
replaces are kept at the bottom, because the difference between them is the
cost of the ADR-0006 mechanism and that is worth being able to see.

## Method

```bash
pnpm --filter @gitnebula/viz perf                 # headless (the CI shape)
PERF_HEADED=1 pnpm --filter @gitnebula/viz perf   # against a real display
```

- **Fixture**: `packages/contract/fixtures/synthetic-100x2000.json`, story
  1.3's committed document — 100 modules, 2,000 files, 2,100 nodes. Served at
  `/analysis.json` by the package's own Vite dev server, so the Viewer loads it
  the same way it loads a real one. The run asserts the node and module counts
  rather than assuming them.
- **Scripted, never hand-driven**: a fixed keyframe list interpolated on the
  rAF clock (`perf/src/camera-script.ts`). No pointer input takes part.
- **Extent from measurement, not assumption**: keyframes are derived from the
  camera the engine itself chose when it framed the graph. 1.4 shipped a
  version that panned around the origin while the layout sat a thousand units
  away and reported a healthy frame rate for an empty screen.
- **Two phases**: `b-frozen-pan-zoom` (10 s, wide pan plus a zoom cycle below
  `UNFOLD_ZOOM`) and `c-unfold-pan` (15 s, perimeter pan held at 2.2×, so
  collapsed modules keep entering the viewport and unfolding while the camera
  is still moving).
- **Sustained fps** is the lowest frame count in any sliding 1-second window —
  1.4's definition unchanged, so the numbers are comparable. An average hides a
  stall; 59 is what a vsync-capped 60 Hz stream reads under this definition.
- **30 warm-up frames** per phase are driven but not measured (JIT, first
  repaint).
- **The run declares itself valid or invalid** before any fps number is read:
  page never hidden, fixture is the yardstick, layout reached Settled.
- **Renders are counted, not just frames.** An init script wraps
  `getContext("2d")` and counts full-viewport background fills; the run asserts
  renders ≈ measured frames. `requestAnimationFrame` keeps firing at full rate
  for a renderer that has stopped drawing, and 1.4's hardest-won lesson is that
  such a run looks entirely normal.

- **The run starts its own dev server and never reuses one.** With several
  agent worktrees on one machine, attaching to a server someone else started
  measures their checkout and reports a clean pass for this one. A port
  collision therefore fails loudly; `PERF_PORT` is how concurrent worktrees
  coexist. Every number below was re-confirmed under that rule and did not
  move, and the supervisor's independent run (83 sustained in phase `c`) lands
  inside the spread recorded here.

**Machine**: Apple M4 Pro, macOS 26.5.2, Node 22.20.0, Playwright 1.62.1 /
Chromium 151.0.7922.34. Canvas 1440 × 845 CSS px, `devicePixelRatio` 1.

## Numbers — post-unfold (3.3 merged)

### Headless — three consecutive runs

| phase | sustained fps | avg fps | median frame | p95 frame | worst frame |
| ----- | ------------- | ------- | ------------ | --------- | ----------- |
| b-frozen-pan-zoom | **119 / 119 / 119** | 120 | 8.3 ms | 9.2 ms | 9.4 – 9.5 ms |
| c-unfold-pan | **81 / 85 / 82** | 115.8 – 116.6 | 8.3 ms | 9.3 ms | 17.6 – 25.1 ms |

Settle: 148 frames, 1241–1242 ms. Renders: 1231–1232 of 1200–1201 measured
frames (b), 1772–1782 of 1740–1750 (c) — the surplus is the unmeasured warm-up.

### Headed, on the real display — one run

| phase | sustained fps | avg fps | median frame | p95 frame | worst frame |
| ----- | ------------- | ------- | ------------ | --------- | ----------- |
| b-frozen-pan-zoom | **59** | 60 | 16.7 ms | 17.5 ms | 17.7 ms |
| c-unfold-pan | **59** | 60 | 16.7 ms | 17.6 ms | 17.7 ms |

Settle: 148 frames, 2452 ms.

### Reading the two together

Headless Chromium's frame clock is not tied to a display: it produces a steady
8.3 ms cadence (~120 fps), so a headless number measures a **cap that is not a
monitor**. The headed run is vsync-locked at 60 Hz.

The interesting result is that **unfold is invisible at 60 Hz and visible at
120**. Headed, phase `c` is indistinguishable from phase `b`: 59 sustained,
16.7 ms median, 17.7 ms worst — the unfold work fits inside the ~8 ms of slack
a 60 Hz frame leaves over. Headless, where a frame is due every 8.3 ms, the
same work costs sustained fps (119 → 81–85) and produces occasional 17–25 ms
frames when a batch of modules enters the viewport at once and their wakes are
seeded on one frame.

So the honest statement is: **on the 60 Hz reference hardware the ADR-0006
mechanism is free; the headroom it consumes is real and would show as an
occasional hitch on a 120 Hz display.** That is a finding for a later story,
not a failure here — FR-14's target is 60 fps and SM-2's floor is 55, and both
phases clear both in both configurations.

Settle duration differs between the configurations (1242 ms vs 2452 ms) because
the settle runs one simulation tick per rendered frame: at twice the frame rate
it reaches Settled in the same 148 frames and half the wall time. Only the
headed figure is comparable to story 2.5's 2–3 s acceptance criterion, and it
satisfies it.

## Verdict

**PASS — ≥ 55 fps sustained in both phases, in both configurations, with
unfold merged.**

| configuration | worst sustained fps | floor | margin |
| ------------- | ------------------- | ----- | ------ |
| headless, phase b (3 runs) | 119 | 55 | 2.16× |
| headless, phase c (3 runs) | 81 | 55 | 1.47× |
| headed, both phases | 59 | 55 | 1.07× |

The headed margin is the honest one for the product claim: 59 against 55 looks
slim, but 59 is the vsync ceiling, not a shortfall — the map cannot go faster
than the display. Worst-frame 17.7 ms against a 16.7 ms budget is one late
frame, and a p95 of 17.6 ms says the distribution is flat.

## What unfold cost, measured

The same harness, same machine, same script, before and after 3.3 merged:

| phase | pre-unfold sustained | post-unfold sustained | pre worst frame | post worst frame |
| ----- | -------------------- | --------------------- | --------------- | ---------------- |
| b-frozen-pan-zoom (headless) | 119 | 119 | 9.4 ms | 9.4 ms |
| c-unfold-pan (headless) | 119 | 81 – 85 | 9.4 ms | 17.6 – 25.1 ms |
| both phases (headed) | 59 | 59 | 17.7 ms | 17.7 ms |

Phase `b` is unchanged, which is the control: it never crosses `UNFOLD_ZOOM`,
so nothing unfolds in it and nothing should have moved. Phase `c` is where the
mechanism lives, and it is the only row that moved.

Before 3.3 merged, `c-unfold-pan` panned at 2.2× with nothing to unfold, so it
measured the same work as `b` at a higher zoom — the two rows were identical,
which is exactly what that meant. Those numbers are superseded and are recorded
here only as the baseline for the row above.

## Difference from 1.4's report: no per-frame work times

1.4 reported `meanWorkMs` — simulation + render time inside each frame — and
that is the number that showed 29× headroom. This harness does not, because the
shipped engine owns its frame loop behind the AD-5 seam: timing its internals
would mean editing `engine.ts` to instrument itself, in a method the cohort was
editing concurrently, for a number no acceptance criterion asks for.
Frame-interval p95 and worst-frame carry the stutter signal from outside.

This is a real reduction in detail against 1.4 and is recorded rather than
glossed. If a future story wants the headroom number back — and the 120 Hz
observation above is a reason to want it — the cheap version is a
build-flag-gated timer around `frame()`.

## Still unmeasured

A DPR-2 (Retina) run: the harness pins `deviceScaleFactor: 1` so runs stay
comparable, and at DPR 2 the renderer rasterises 4× the pixels. 1.4 flagged the
same gap and it is still open. Given that unfold now consumes real headroom,
the DPR-2 × unfold combination is the one worth measuring next.
