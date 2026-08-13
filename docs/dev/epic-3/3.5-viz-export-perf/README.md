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

**A failed export says so on the button.** Export is the one action in the
Viewer whose result lives outside the page — the map still looks exactly as it
did, so a user whose 2× encode ran out of memory has no way to tell that no
file was written. On failure the button reads `✕ png failed`, its `title`
carries the reason, and `aria-live="polite"` means the change is announced
rather than merely drawn. It resets after six seconds or on the next click, so
a later success never has to argue with a stale error. (Codex caught this: the
first version had the console line and the comment claiming a visible signal,
without the signal.)

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
| **exclusive dev server** (new) | attaching to a server another worktree already started measures *that* checkout and reports a clean pass for the code under review here |

The camera script is derived from the graph's **measured** extent — the camera
the engine chose when it framed the graph — never a guessed world radius. 1.4
shipped a version that panned around the origin while the layout sat a thousand
units away, at a perfectly respectable frame rate, over an empty screen.

The harness drives the real Viewer through one published handle
(`src/harness-handle.ts`), not a stand-in simulation. That is the whole point
of productionising 1.4: the number now describes what ships.

**Which server the run measures is part of that.** Playwright's convenient
setting is `reuseExistingServer: !process.env.CI`, and it is how this config was
first written. With several agent worktrees on one machine it is also a way to
measure someone else's code and call it evidence: whoever holds the port owns
the server, and an attaching run reports a clean pass over a checkout that is
not the one under test. That happened during review of this branch — a green
8-passed run traced to another worktree entirely. It is the render-counter
failure one level up, so the fix has the same shape: the run starts its own
server and never reuses one, a port collision fails loudly through
`--strictPort` instead of quietly producing the wrong number, and concurrent
worktrees coexist by picking a port:

```bash
PERF_PORT=4319 pnpm --filter @gitnebula/viz perf
```

Both halves are verified: with a server already on 4318 the run now fails with
`http://localhost:4318 is already used`, and the same run on `PERF_PORT=4322`
passes 8/8.

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

**Search fly-to is audited, as of 3.3 merging.** The test was written to probe
for `flyTo` and skip with a recorded reason while story 3.3 still owed it. 3.3
merged into the epic branch during this story, the probe found a real
implementation, and the assertion went live with no edit: under reduced motion
the camera is at its destination one frame after `flyTo` is called, rather than
easing into place. All three legs of AC-5 are now asserted, and the suite runs
8 passed / 0 skipped.

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

**The variance numbers this rests on.** Three consecutive headless runs, with
unfold merged: phase `b` produced *identical* sustained fps (119 / 119 / 119)
with ≤ 0.1 ms spread at p95 and worst frame; phase `c`, where unfold actually
runs, produced 81 / 85 / 82 sustained — a 4 fps spread, all of it well clear of
the 55 floor, arising from which frame a batch of modules happens to enter the
viewport on. The headed configuration reads 59 sustained in both phases across
runs.

So the harness itself is stable to within a few frames per second; the
instability that would justify a non-blocking job is in the environment, not
the measurement. That is the honest statement, and it is why the job is manual
rather than merely tolerant: a threshold that is meaningful locally and
meaningless on a software-rasterised hosted runner should not be dressed up as
a gate.

The headed configuration reads 59 sustained fps against the same script — the
vsync ceiling of a 60 Hz display, and the number a person actually sees. Every
configuration clears the 55 floor.

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

`buildScene` is **pamela's** method (story 3.3), and the rule agreed with her
in writing was applied for real: her PR #24 merged into the epic branch while
this story was in flight, and the rebase kept **her `buildScene` body** and
**this story's `exportPNG` body**, exactly as both PR bodies said it would. Her
version is a superset — member file nodes, `member: true` edges, the search
pulse target — so resolving the other way, or by "take the epic branch's side"
without reading it, would have silently dropped unfold from the render path in
a way that still compiles and still type checks.

Two consequences of that merge landed here with no code change:

- **The export inherits unfold for free.** It re-renders the scene, so exported
  PNGs now include unfolded member nodes, member edges and the search-arrival
  pulse without a line changing in `export.ts`.
- **The perf numbers moved, and were re-measured.** See PERFORMANCE.md — phase
  `c` fell from 119 to 81–85 sustained fps headless, and is unchanged at 59 on
  a 60 Hz display.

`notYet()` — story 2.5's helper for members that were declared but unowned —
was removed in the same rebase. `flyTo` and `exportPNG` were its last two
callers, so it had none left.
