# 3.5 — PNG export and the performance harness

Two deliverables that share one purpose: getting evidence out of the map. The
export gets a picture out; the harness gets a number out.

- **Export** (FR-22, AD-5): the current view as a ≥ 2× PNG, re-rendered through
  the engine rather than scaled from the canvas.
- **Harness** (FR-14, SM-2, NFR-7): Playwright over the committed 2,000-node
  fixture — sustained fps against the 55 floor, export pixel parity, and the
  `prefers-reduced-motion` audit.

Measured numbers and the verdict live in [PERFORMANCE.md](PERFORMANCE.md).
Human verification steps and their results are in
[MANUAL_TESTING.md](MANUAL_TESTING.md).

## Export: why it is a re-render

AD-5 bans canvas-snapshot scaling in as many words, and the ban is the design.
Enlarging the on-screen bitmap would interpolate pixels that were rasterised
for a smaller surface — every glow gradient, curved edge and module label would
come out soft. Instead the **scene** (the object the live frame is drawn from)
goes to the same `renderFrame` against a context whose transform is `scale`×
larger. Text and vectors are rasterised at the export's own resolution, and the
result is sharp because it was never a smaller image.

That choice also settles state parity for free. Camera, view mode, hover and
isolate chain, selection and label visibility all live in the scene, so the
export cannot drift from the screen without the screen drifting too. There is
no second code path to keep in step.

Two details that are not obvious:

- **The clock is the last drawn frame's, not `now`.** The hot-spot pulse is a
  function of time; exporting at a fresh timestamp would catch it at a
  different phase than the pixels on screen, and AC-1's pixel comparison would
  have nothing well-defined to compare.
- **Density lives in the context transform, never in the viewport.** Scaling
  the viewport instead would show *more of the map* at the same density — a
  bigger file that is not a higher-resolution version of the same view.

`scale < 2` is rejected rather than clamped: a silent clamp turns a caller's
mistake into a file that looks like a satisfied FR-22 and is not.

## Harness: what makes a run evidence

Story 1.4 built the methodology and, in the course of building it, found three
ways a perf run can look completely normal while measuring nothing. All three
guards are carried over, and a fourth was added for this harness:

| guard | the failure it prevents |
| ----- | ----------------------- |
| page-hidden watch (frame check **and** `visibilitychange`) | a backgrounded tab throttles or suspends rAF; the run then reports the throttle in the shape of a result |
| fixture assertion (2,100 nodes / 100 modules) | measuring something that is not the yardstick |
| Settled reached | the pan phases would measure a map still in motion |
| **render counting** (new) | rAF keeps firing at full rate for a renderer that has stopped drawing — frames alone would report a healthy fps for a blank canvas |

The camera script is derived from the graph's **measured** extent — the camera
the engine chose when it framed the graph — never a guessed world radius. 1.4
shipped a version that panned around the origin while the layout sat a thousand
units away, at a perfectly respectable frame rate, over an empty screen.

The harness drives the real Viewer through one published handle
(`src/harness-handle.ts`), not a stand-in simulation. That is the whole point
of productionising 1.4: the number now describes what ships.

### Pixel parity without a golden image

AC-1's check compares the export against the live canvas **of the same
instant**, downsampled back to CSS resolution, with a per-channel tolerance and
a required agreement share. No golden PNG, deliberately: a golden would need
regenerating whenever the map legitimately changes — stories 3.3 and 3.4 are
about to do that twice — and a regenerated golden only proves the export equals
itself.

A second test is the negative control: the same PNG, compared against the
canvas *after* the highlight is cleared, must **fail** to match. A parity
assertion that cannot fail is decoration.

### The reduced-motion audit, and one thing it does not audit

Under `prefers-reduced-motion: reduce` the audit asserts the first frame is
already settled (`durationMs === 0`, camera identical across 20 frames) and
that the canvas is byte-identical over 700 ms — no pulse, nothing animating. A
control test with animation enabled asserts the canvas **does** change, so the
stillness check cannot pass vacuously.

The preference is emulated with an explicit `page.emulateMedia` and then
checked. Playwright's `test.use({ reducedMotion })` did not reach `matchMedia`
in the page on this version: the audit ran green against an unemulated browser,
which is exactly the failure AC-5 exists to catch.

**Search fly-to is not audited on this branch.** `flyTo` belongs to story 3.3
and still throws its `notYet` error here, so the test probes for it, records an
annotation naming 3.3, and skips with that reason rather than asserting
nothing. It becomes live the moment 3.3 merges — no edit needed.

## CI: the decision, with the numbers behind it (AC-4)

`.github/workflows/perf.yml` runs the harness on **`workflow_dispatch` only**,
with `continue-on-error: true`, uploading the report as an artefact. AC-4
allows non-blocking but forbids silence, so here is the reasoning and the
evidence.

**Why manual rather than on push.** This repository's CI is deliberately
`workflow_dispatch`-only until story 4.2 revisits the recipe — `ci.yml` says so
in its own header. A perf workflow triggering on push would make it the only
automatic workflow in the repo, which is not this story's decision to make.

**Why non-blocking.** GitHub's hosted runners have no GPU and rasterise canvas
2D in software on shared hardware. The frame rate there measures the runner,
not the renderer, and a hard threshold would fail for reasons unrelated to the
code under review.

**The variance numbers this rests on.** Locally the harness is extremely
stable — three consecutive headless runs produced *identical* sustained fps
(119 / 119 / 119), identical medians, and ≤ 0.1 ms spread at p95 and worst
frame. So the instability that would justify a non-blocking job is not in the
harness; it is in the environment. That is the honest statement, and it is why
the job is manual rather than merely tolerant: a threshold that is meaningful
locally and meaningless on a hosted runner should not be dressed up as a gate.

The headed configuration reads 59 sustained fps against the same script — the
vsync ceiling of a 60 Hz display, and the number a person actually sees. Both
clear the 55 floor.

**Revisit in story 4.2** with a runner-calibrated floor, or keep the job manual
and treat `PERFORMANCE.md` as the record.

## Files

**NEW**

| file | why |
| ---- | --- |
| `packages/viz/src/engine/export.ts` | the re-render: offscreen surface at `scale`×, same `renderFrame`, PNG encode |
| `packages/viz/src/engine/export.test.ts` | scale, transform-not-viewport, state carry-through, the rejection cases |
| `packages/viz/src/engine/engine-export.test.ts` | the export issues the *same draw calls* as the live frame |
| `packages/viz/src/chrome/export-button.ts` | the mockup's `↓ png` control and the filename rule |
| `packages/viz/src/chrome/export-button.test.ts` | filename cases, double-click guard, failure path |
| `packages/viz/src/harness-handle.ts` | the one seam the harness needs to drive the real engine |
| `packages/viz/perf/playwright.config.ts` | dev-only harness config; single worker, fixed viewport, `PERF_HEADED` |
| `packages/viz/perf/src/measure.ts` (+ test) | fps aggregation and the run-validity verdict |
| `packages/viz/perf/src/camera-script.ts` (+ test) | keyframes derived from the measured extent |
| `packages/viz/perf/src/driver.ts` (+ test) | the self-contained in-page loop; unit-tested because `page.evaluate` serialises it |
| `packages/viz/perf/src/instrument.ts` | render counting — proof the frames were not empty |
| `packages/viz/perf/src/page-helpers.ts` | waits for the handle; `goto` resolves before the Viewer has booted |
| `packages/viz/perf/src/report.ts` | JSON plus a readable table |
| `packages/viz/perf/tests/fps.pw.ts` | AC-3: the 55 fps floor |
| `packages/viz/perf/tests/export.pw.ts` | AC-1 pixel parity, its negative control, AC-2 filename |
| `packages/viz/perf/tests/reduced-motion.pw.ts` | AC-5 audit plus the animation control |
| `.github/workflows/perf.yml` | AC-4 |

**UPDATE**

| file | why |
| ---- | --- |
| `packages/viz/src/engine/engine.ts` | `buildScene` extracted from `draw()`; `lastFrameMs`; `exportPNG` implemented |
| `packages/viz/src/engine/engine.test.ts` | `exportPNG` is no longer on the "not implemented" list |
| `packages/viz/src/chrome/chrome.ts` | mounts the button into the existing `EXPORT_SLOT_ID` |
| `packages/viz/src/app.ts` | publishes the harness handle before `load()` |
| `packages/viz/package.json`, `tsconfig.json` | `perf` script, Playwright devDependency, `perf/` in the project |
| `.gitignore` | harness run output is regenerated, not committed |

## A note for the cohort

`buildScene` is **pamela's** method (story 3.3). It is written here only
because this story has no blocking dependency and the export needed a scene
before her PR could land. The resolution rule, agreed with her in writing and
deliberately order-independent: on any conflict take **pamela's `buildScene`
body** and **rambo's `exportPNG` body**, whoever is rebasing onto whom. Her
version is a superset — member file nodes, `member: true` edges, the search
pulse target — and resolving by "take the epic branch's side" would silently
drop unfold from the render path in a way that still compiles and still type
checks.

The export inherits all of it for free: it re-renders the scene, so unfolded
members appear in exported PNGs the moment her work merges, with no change
here.
