# 2.5 — GraphEngine core: the nebula renders

The Viewer now loads a contract document from `./analysis.json`, lays it out
with a seeded d3-force simulation, settles it in 2–3 s, frames it, and responds
to pan and zoom — at the mockup's encoding. Everything the map does goes
through one interface (AD-5); the DOM chrome never touches the canvas.

Run it:

```bash
pnpm --filter @gitnebula/viz dev            # serves synthetic-100x2000
pnpm --filter @gitnebula/viz test           # 134 tests
```

## How the fixture reaches `./analysis.json` (AC-1)

AD-12 says the Viewer fetches `./analysis.json` — a same-directory sibling —
in **every** mode, and nothing else. In dev there is no pipeline to produce one,
so `vite.config.ts` carries a serve-only plugin that answers that exact URL with
a committed contract fixture:

| `GITNEBULA_FIXTURE`            | serves                                              |
| ------------------------------ | --------------------------------------------------- |
| unset                          | `packages/contract/fixtures/synthetic-100x2000.json` |
| `zero-history`                 | that fixture from the same directory                 |
| `/abs/path/to/analysis.json`   | the file as given — point it at cli output           |

A bare name resolves inside the contract's fixtures directory; anything with a
separator or a `.json` suffix is used as a path. A missing file answers **404
and logs an error** rather than falling back to something plausible — story 1.4
learned what a silent fallback costs.

The fixture is read through the dev server, never imported, so the ~950 KB
synthetic document stays out of the bundle and `viz` keeps no build-time reach
into the contract package's internals (AD-2).

`loadAnalysis()` fetches that URL once, then `checkVersion()` compares the
document's `schemaVersion` major against the contract's
`SUPPORTED_SCHEMA_MAJOR`. A mismatch renders the FR-6 screen, which names
**both** versions — "unsupported" without the numbers tells the reader nothing
they can act on. Unreachable and unparsable documents get their own screens for
the same reason.

## The seam (AC-6, AC-7)

```
src/
  app.ts            bootstrap: load → mount chrome → hand the stage to the engine
  loader.ts         ./analysis.json + the version gate
  error-screen.ts   FR-6
  engine/           layout AND render, behind one interface
    index.ts        the barrel — the ONLY engine module chrome may import
    types.ts        GraphEngine, declared in full (AC-7)
    engine.ts       the one place with a canvas, a context and pointer events
    layout.ts       the one place that imports d3-force
    render.ts       the one place encoding rules live
    camera.ts prng.ts settle.ts graph.ts starfield.ts emitter.ts constants.ts
  chrome/           header, legend, hint, store — DOM only
```

**AC-6 is enforced by `src/chrome/boundary.test.ts`, not by a lint plugin.** The
spec allowed either and asked which; a boundary lint rule expresses the import
half ("don't reach past the barrel") but not the other half ("never acquire a
rendering context"), and it would add a dependency for one rule. The test checks
both, plus two rules a plugin would not have caught: the engine never imports
chrome, and `d3-force` is imported by exactly one engine module. It has been
watched fail — adding an `../engine/constants.js` import to a chrome file turns
it red with the reason named.

The interface is declared **complete**, including what 2.5 does not build:
`flyTo` and `exportPNG` return promises that reject naming
`3.3-viz-navigation` / `3.5-viz-export-perf`; `unfoldedModules()` and
`isUnfolded()` answer truthfully, because "nothing is unfolded" is the correct
answer in 2.5, not a stub. 3.3/3.4/3.5 are frozen against this shape.

## Settle, seed and camera (AC-2)

`ModuleLayout` creates the d3-force simulation **stopped** and ticks it once per
rendered frame, so a frame's cost is simulation *plus* render — the way story
1.4 measured it. On Settled the simulation stops being ticked at all
(freeze-on-settle); the loop keeps running for the hot pulse and camera
flights, which the spike measured at ~0.2 ms/frame.

**Settled** is AD-6's definition and only AD-6's: max displacement
< `SETTLE_DISPLACEMENT_PX` (0.5) for `SETTLE_FRAMES` (30) consecutive frames.
On `synthetic-100x2000` that lands at **148 frames ≈ 2.47 s**, asserted by
`layout.test.ts` against the 2–3 s band.

Determinism (AD-6) needs two seeded things, not one: the initial scatter *and*
d3's own `jiggle`, which pulls `Math.random()` for coincident nodes unless
`simulation.randomSource(rng)` is set. Both come from `mulberry32(hash(repo.
name))`. `replay()` re-derives the stream from the same seed rather than
continuing it, so a replay reproduces the load layout exactly — the test
asserts the camera lands identically.

The camera holds a **world point at the viewport centre** plus a zoom factor,
rather than the mockup's accumulated pan offset. Fit and fly-to become "put
this point in the middle at this zoom", and every number stays in CSS pixels
with the device-pixel-ratio transform living only on the context — the
correction the spike recommends for a Retina run.

Camera flights start their clock on their **first animated frame**, not at
creation. A flight created outside the loop and timed against a second clock
gets a negative or already-elapsed `t`; this cost one red test to find.

Reduced motion runs the identical ticks synchronously and renders the settled
map with the camera already fitted. Determinism is untouched — only the
animation is skipped.

**Layout spread is bounded by the zoom clamp, not just by taste.** An earlier
tuning settled over ≈1500 × 1620 world px, which a 1200 × 800 viewport cannot
frame without dropping below FR-15's 0.4 floor: `fit()` clamped and the graph
ran off the screen. The committed constants settle to ≈1080 × 1086, which fits
at ≈0.57×.

## Encoding (AC-3, AC-4)

`engine/constants.ts` holds every value the look depends on and the tests assert
against those exports, so a change is a change the suite sees. Palette hexes,
`HOT_THRESHOLD` 0.5, `HOT_PULSE_MS` 380, `UNFOLD_ZOOM` 1.8, the [0.4, 6.0]
clamp, 220 stars in two sizes, the 0.13 edge-curve offset — all the mockup's.

In structure mode the hot colour **replaces** the layer colour rather than
tinting it (UX-DR2). Radius is `base + √LOC / 11` for both kinds; where the
mockup jittered file radii randomly, the contract gives every file a real LOC,
so the same term drives both and nothing is random outside the seeded stream.

Chrome derives the module count from the node set (AC-4) — `repo.stats` carries
no module count, and a second count would be a second truth.

**Note on the synthetic fixture:** all 100 of its modules have churn ≥ 0.797, so
in structure mode the whole map renders `--hot` orange and the layer palette
never appears on screen. That is the encoding working, not a defect — verified
by serving a locally modified mixed-churn copy, which produced the full palette.
No committed fixture exercises layer colours *and* hot spots together; that is
worth a fixture-side follow-up for 3.3/3.4, and belongs to story 1.3's
territory rather than this one.

## Pan and zoom (AC-5)

Pointer events on the canvas: drag pans, wheel zooms about the cursor so the
world point under it stays put, clamped to [0.4, 6.0]. The cursor is `grab`,
`grabbing` while dragging. The clamp is applied *before* the recentring, so
scrolling at the zoom limit does not drift the map sideways.

## Files

### New

| file                                | why                                                        |
| ----------------------------------- | ---------------------------------------------------------- |
| `src/app.ts`                        | bootstrap wiring, kept out of the side-effecting entry      |
| `src/loader.ts`                     | AD-12 fetch + FR-6 version gate                             |
| `src/error-screen.ts`               | the refusal screen, built with `textContent`                |
| `src/styles.css`                    | chrome styling, the mockup's custom properties              |
| `src/engine/types.ts`               | the GraphEngine interface, in full (AC-7)                   |
| `src/engine/index.ts`               | the barrel chrome imports — the AD-5 boundary               |
| `src/engine/engine.ts`              | canvas 2D implementation, frame loop, pointer input         |
| `src/engine/layout.ts`              | d3-force, seeded, hand-ticked, freeze-on-settle             |
| `src/engine/render.ts`              | the encoding rules, context-in so they are testable         |
| `src/engine/camera.ts`              | pure camera maths in CSS px                                 |
| `src/engine/graph.ts`               | contract document → engine graph                            |
| `src/engine/settle.ts`              | AD-6's Settled definition and its constants                 |
| `src/engine/prng.ts`                | mulberry32 over FNV-1a, seeded by `hash(repo.name)`         |
| `src/engine/starfield.ts`           | UX-DR3, seeded, normalized to the viewport                  |
| `src/engine/constants.ts`           | every tunable the look depends on                           |
| `src/engine/emitter.ts`             | typed events, ~40 lines instead of a dependency             |
| `src/chrome/chrome.ts`              | mounts the chrome, subscribes it to the engine              |
| `src/chrome/header.ts`              | brand, repo, stats, replay, 3.4/3.5 slots                   |
| `src/chrome/legend.ts` `hint.ts`    | UX-DR2 / UX-DR9 overlays                                    |
| `src/chrome/store.ts` `format.ts`   | the small emitter store; stats formatting                   |
| `src/test-support/fixtures.ts`      | test-only loader for the committed contract fixtures        |
| `src/test-support/fake-canvas.ts`   | recording 2D context — jsdom has none, and calls beat pixels |
| 8 `*.test.ts` files                 | settle timing, determinism, version gate, encoding, camera, engine, chrome, boundary |

### Updated

| file                          | why                                                     |
| ----------------------------- | -------------------------------------------------------- |
| `src/main.ts`                 | now the entry that boots the app instead of a placeholder |
| `src/index.ts`                | exports the engine, the loader and `boot`                 |
| `vite.config.ts`              | the dev fixture plugin (AC-1)                             |
| `package.json`                | `jsdom` + `@types/node` dev dependencies                  |
| `docs/implementation-artifacts/sprint-status.yaml` | 2.5 → review                       |

## Not in this story

Unfold, collapse, hover chains, tooltip, search, fly-to (3.3); the panel,
isolate, heatmap toggle (3.4); PNG export and the Playwright perf harness
(3.5). The interface declares all of them.
