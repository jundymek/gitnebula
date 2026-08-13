# 3.5 — Performance record

The story's stated performance property is FR-14 / SM-2: **≥ 55 fps sustained
during a scripted pan+zoom on the 100-module / 2,000-file fixture** (ADR-0006's
yardstick). This file records the method, the numbers measured on this branch,
and the verdict.

Story 1.4 asked whether canvas 2D *could* hold the budget, against a stand-in
simulation. This measures the shipped engine, so the two sets of numbers are
about different code and only the methodology is shared.

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
  `UNFOLD_ZOOM`) and `c-unfold-pan` (15 s, perimeter pan held at 2.2×).
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

**Machine**: Apple M4 Pro, macOS 26.5.2, Node 22.20.0, Playwright 1.62.1 /
Chromium 151.0.7922.34. Canvas 1440 × 845 CSS px, `devicePixelRatio` 1.

## Numbers

### Headless — three consecutive runs

| phase | sustained fps | avg fps | median frame | p95 frame | worst frame |
| ----- | ------------- | ------- | ------------ | --------- | ----------- |
| b-frozen-pan-zoom | **119 / 119 / 119** | 120 | 8.3 ms | 9.1 ms | 9.4 – 9.5 ms |
| c-unfold-pan | **119 / 119 / 119** | 120 | 8.3 ms | 9.1 ms | 9.4 ms |

Settle: 148 frames, 1233 / 1233 / 1234 ms. Renders per phase: 1231–1233 of
1200 measured (b), 1832–1833 of 1800–1801 (c) — the surplus is the frames drawn
during the unmeasured warm-up.

**Run-to-run variance across the three runs is ≈ 0**: identical sustained fps,
identical median, ≤ 0.1 ms spread at p95 and worst frame, ≤ 1 ms on settle.

### Headed, on the real display — one run

| phase | sustained fps | avg fps | median frame | p95 frame | worst frame |
| ----- | ------------- | ------- | ------------ | --------- | ----------- |
| b-frozen-pan-zoom | **59** | 60 | 16.7 ms | 17.4 ms | 17.7 ms |
| c-unfold-pan | **59** | 60 | 16.7 ms | 17.4 ms | 17.7 ms |

Settle: 148 frames, 2436 ms.

### Reading the two together

Headless Chromium's frame clock is not tied to a display: it produced a steady
8.3 ms cadence (~120 fps), so the headless numbers measure a **cap that is not
a monitor**. The headed run is vsync-locked at 60 Hz and reads 59 sustained /
16.7 ms median — exactly story 1.4's figures, on a real engine rather than a
spike.

Both are ceilings rather than costs: in each case the frame interval sits *on*
the cap, which says the budget was met but not by how much. What bounds the
work is the **worst frame**, and it never exceeds the cap interval by more than
1.1 ms (headless) or 1.0 ms (headed) — i.e. the renderer never missed a
deadline in 45 s of scripted animation across the two configurations.

Settle duration differs between the two (1233 ms vs 2436 ms) because the settle
runs one simulation tick per rendered frame: at twice the frame rate it reaches
Settled in the same 148 frames and half the wall time. Only the headed figure
is comparable to story 2.5's 2–3 s acceptance criterion, and it satisfies it.

## Difference from 1.4's report: no per-frame work times

1.4 reported `meanWorkMs` — simulation + render time inside each frame — and
that is the number that showed 29× headroom. This harness does not, because the
shipped engine owns its frame loop behind the AD-5 seam: timing its internals
would mean editing `engine.ts` to instrument itself, in a method two cohort
peers are editing concurrently, for a number no acceptance criterion asks for.
Frame-interval p95 and worst-frame carry the stutter signal from outside.

This is a real reduction in detail against 1.4 and is recorded rather than
glossed. If a future story wants the headroom number back, the cheap version is
a build-flag-gated timer around `frame()`.

## Verdict

**PASS — ≥ 55 fps sustained in both phases, in both configurations.**

| configuration | worst sustained fps | floor | margin |
| ------------- | ------------------- | ----- | ------ |
| headless (3 runs) | 119 | 55 | 2.16× |
| headed, 60 Hz display | 59 | 55 | 1.07× |

The headed margin is the honest one: 59 against 55 looks slim, but 59 is the
vsync ceiling, not a shortfall — the map cannot go faster than the display.
Worst-frame 17.7 ms against a 16.7 ms budget is one late frame in 900, and the
p95 of 17.4 ms says the distribution is flat.

## What will move these numbers

**Story 3.3 (unfold) has not merged into the epic branch at the time of
measurement.** These figures are therefore *pre-unfold*: `c-unfold-pan` pans at
2.2× but nothing unfolds yet, so it currently measures the same work as phase
`b` at a higher zoom — which is why the two rows are identical. pamela's own
warning stands: unfolded modules add file nodes and member edges to both the
simulation and the draw path, bounded by ADR-0006 to modules in the viewport
(1.4 measured 13–14 modules, 260–280 files at peak).

**Re-measure after 3.3 merges and replace the `c-unfold-pan` row.** The phase
is already written for that case, so this needs a run, not an edit. Story 3.4
adds no render passes and no simulation work (arnold, by message), so it should
not move anything.

A DPR-2 (Retina) run is also unmeasured here: the harness pins
`deviceScaleFactor: 1` so runs stay comparable. At DPR 2 the renderer
rasterises 4× the pixels; 1.4 flagged the same gap and it is still open.
