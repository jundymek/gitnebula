# Manual testing — 1.4 performance spike

The spike's evidence is the numbers in `README.md`. These steps let a human
reproduce the run and eyeball the three phases; the eyeball checks are
deliberately left unticked for the story owner.

## Reproducing the measured run

```bash
pnpm install
pnpm --filter @gitnebula/viz perf-spike     # vite dev server for the spike page
```

Open the printed URL in Chrome (a Chromium-based browser is what the recorded
numbers were taken on — record yours if it differs). The page runs the whole
sequence by itself: no clicking, no dragging. Nothing to configure.

**Keep the tab visible and in front for the whole run.** Chrome throttles
`requestAnimationFrame` on a background tab, which turns a 4-second phase into
a 90-second one and makes every fps figure a measurement of the throttle. The
page detects this and says so, but the run is then wasted.

The run takes roughly 30 s:

1. phase (a) — active simulation of all 2,100 nodes until Settled,
2. phase (b) — frozen layout, 10 s scripted pan/zoom sweep below 1.8×,
3. phase (c) — 15 s scripted pan at 2.2× with viewport-scoped unfold.

When `#status` reads `done`, the results JSON is in the page (`#results`), in
the console as a single `SPIKE_RESULTS {...}` line, and written to
`packages/viz/perf-spike/results.json` by the dev server. Compare its
`phases[].worst1sFps` against the verdict in `README.md`.

If `#status` reads `done — INVALID RUN, see console`, the numbers are not
evidence. Check `runValid`, `fixtureSource`, `settleTimedOut` and
`hiddenFrames` in the results and the `SPIKE_INVALID` line in the console.

## What to look at while it runs

- [ ] Phase (a): the layout visibly expands and comes to rest — it stops on
      its own, no manual freeze.
- [ ] Phase (b): panning and zooming is smooth and the layout does **not**
      drift; frozen means frozen (module positions identical at the start and
      end of the sweep).
- [ ] Phase (c): as the camera pans, modules entering the viewport pop open
      into their file nodes, and modules leaving the viewport stay collapsed —
      file nodes never appear across the whole map at once (ADR-0006).
- [ ] Phase (c): when a module unfolds, the rest of the map stays still. Its
      members fan out from the module's position; nothing outside it jumps.
- [ ] No visible stutter that the numbers do not already account for; if you
      see one the numbers miss, that is a finding worth reporting.

## Owner gate

- [ ] The maintainer accepts the verdict recorded in `README.md`.

This box is the story's acceptance gate and is **not** the implementing
agent's to tick — superman reports the verdict, the owner closes it at the M1
merge.
