# 4.7 — Performance record

AC-6: measured against the 2,000-node fixture, the frame rate must stay within
story 3.5's recorded floor.

## Method

Story 3.5's harness, unchanged, on this branch:

```bash
PERF_PORT=3002 pnpm --filter @gitnebula/viz perf   # headless
```

- **Fixture**: `packages/contract/fixtures/synthetic-100x2000.json` — 100
  modules, 2,000 files, 2,100 nodes (ADR-0006 / FR-14's yardstick).
- **Sustained fps** = the lowest frame count in any sliding 1-second window,
  3.5's definition unchanged so the numbers are comparable.
- **Two phases**: `b-frozen-pan-zoom` (below `UNFOLD_ZOOM`, the control) and
  `c-unfold-pan` (perimeter pan held at 2.2×, modules unfolding as they enter).
- The run declares itself valid before any fps number is read, and counts
  renders as well as frames.
- Its own dev server on `PERF_PORT=3002` (this worktree's assigned port) — 3.5's
  rule about never attaching to a peer worktree's server.

**Machine**: Apple M4 Pro, macOS 26.5.2, Node 22.20.0, Playwright/Chromium
151.0.7922.34. Canvas 1440 × 845 CSS px, `devicePixelRatio` 1. Headless only —
see "Not re-measured" below.

## Numbers — three consecutive headless runs on this branch

| phase | sustained fps | avg fps | median frame | p95 frame | worst frame | verdict |
| ----- | ------------- | ------- | ------------ | --------- | ----------- | ------- |
| b-frozen-pan-zoom | **119 / 119 / 119** | 120 | 8.3 ms | 9.8 – 10 ms | 10.4 ms | pass |
| c-unfold-pan | **87 / 87 / 85** | 117.1 | 8.3 ms | 10.1 – 10.2 ms | 18.4 – 25.4 ms | pass |

Settle: **148 frames, 1241.6 / 1241.8 / 1242.0 ms** — byte-identical to 3.5's
recorded 148 frames / 1241–1242 ms.

## Against story 3.5's floor

| phase | 3.5 (headless, 3 runs) | 4.7 (headless, 3 runs) | SM-2 floor |
| ----- | ---------------------- | ---------------------- | ---------- |
| b-frozen-pan-zoom | 119 / 119 / 119 | 119 / 119 / 119 | 55 |
| c-unfold-pan | 81 / 85 / 82 | 87 / 87 / 85 | 55 |

**Verdict: PASS — no regression.** Phase `b` is identical. Phase `c` reads 3–6
fps *above* 3.5's spread; that is run-to-run variance in the same direction, not
an improvement this story earned, and it is recorded as "within the floor"
rather than claimed as a win.

## Why the yardstick cannot show this story's cost

`synthetic-100x2000.json` contains **no** `parent: null` file node — that is the
gap story 4.7 exists to close. So the identical settle (148 frames) and the
unchanged phase `b` are the expected result and serve as a **control**: they
prove the change did not perturb documents that have no root files, which is
every fixture and most of the measured surface.

The cost the story does add is bounded by construction rather than by this
measurement: each root file is one extra node in the module-level simulation,
permanently. Real repositories carry a handful — 7 in `free-proxy`, 15 in this
one — against 100 module nodes already simulated. The 2,000 file nodes ADR-0006
bounds are unaffected: root files never enter a member wake, because they have
no module to wake inside.

`root-files.json`, the new fixture, has 6 nodes. It is a correctness fixture,
not a performance one, and no budget is invented for it.

## Not re-measured

- **The headed (vsync-locked, 60 Hz) configuration.** 3.5 recorded 59 sustained
  in both phases there. It was not re-run for this story: the headless control
  shows no perturbation, and this branch's change to the shipped render path is
  nil — a root file goes through the same `RenderableNode` path as any other
  file. If a reviewer wants it, `PERF_HEADED=1 pnpm --filter @gitnebula/viz perf`
  is the command.
- **A repository-scale run with many root files.** No such repository exists in
  the fixture set, and inventing a 200-root-file document to measure against
  would be testing a shape the scanner does not produce.
- **DPR 2.** Still open, still 3.5's and 1.4's flag, untouched here.
