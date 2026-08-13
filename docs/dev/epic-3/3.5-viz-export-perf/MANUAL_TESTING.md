# 3.5 — Manual testing

Executed on this branch before the PR was opened. Each box is ticked only if it
was actually run, with the observed result recorded beside it. Unticked boxes
carry the reason they could not be executed here.

**Environment.** Apple M4 Pro, macOS 26.5.2, Node 22.20.0, pnpm 10.34.5,
Playwright 1.62.1 / Chromium 151.0.7922.34. Branch rebased onto
`epic/3-deps-python` at `6f3b170` (alice's #21).

Start the Viewer for the interactive steps:

```bash
pnpm --filter @gitnebula/viz dev      # serves the 2,000-node fixture at /analysis.json
```

## Automated suites

- [x] `pnpm --filter @gitnebula/viz test` — **22 files, 195 tests, all passing.**
- [x] `pnpm --filter @gitnebula/viz typecheck` — clean.
- [x] `pnpm lint` — ESLint and Prettier clean across the workspace.
- [x] `pnpm --filter @gitnebula/viz perf` — **7 passed, 1 skipped** (the skip is
      the fly-to leg of AC-5; see below). Run report printed and written to
      `packages/viz/perf/report/`.
- [x] `PERF_HEADED=1 pnpm --filter @gitnebula/viz perf` — passes against a real
      display; 59 sustained fps in both phases. Numbers in
      [PERFORMANCE.md](PERFORMANCE.md).

## Export (FR-22, AC-1, AC-2)

- [x] **Export a PNG during isolate mode and inspect it** (the spec's own
      step). Isolated `mod-000/` (a hot spot), selected it, exported through
      the engine, wrote the file and opened it.
      **Result:** `2880 × 1690` px, 954 KB, 8-bit RGBA — exactly 2× the
      `1440 × 845` CSS canvas. The isolate state is in the image: `mod-000/`
      carries its selection ring, its four chain neighbours (`mod-006/`,
      `mod-040/`, `mod-060/`, `mod-070/`) are lit with their labels legible,
      the chain edges are drawn bright, and every other module is dimmed to the
      background. Labels and edge curves are crisp at 2×, not interpolated —
      which is the visible difference between a re-render and a scaled
      snapshot.
- [x] The exported image matches the *current camera*, not a reset view: the
      export was taken after `fit()` and frames the same region the canvas
      showed.
- [x] Filename is `gitnebula-<repo-name>.png`. Verified through a real browser
      download in `export.pw.ts` (`download.suggestedFilename()` compared
      against the repo name the header displays), not only in a unit test.
- [x] A second click while an export is in flight does not start a second
      re-render (unit-tested; the button is disabled for the duration).
- [ ] **Click the `↓ png` button by hand in a desktop browser and open the file
      from the Downloads folder.** Not executed: this worktree runs headless,
      and the button path was instead exercised through Playwright's real
      download event. The remaining human value is the feel of the control and
      the OS-level save, which a screenshot cannot settle.

## Performance harness (FR-14, SM-2, AC-3, AC-4)

- [x] The run declares itself valid before reporting numbers — fixture is the
      2,100-node yardstick, page never hidden, layout reached Settled.
- [x] The run counts renders as well as frames: 1231 renders / 1200 measured
      frames (phase b), 1832 / 1800 (phase c). A renderer that had stopped
      drawing would show a healthy fps and a render count near zero.
- [x] Three consecutive headless runs for variance — identical sustained fps
      (119 / 119 / 119), ≤ 0.1 ms spread at p95 and worst frame.
- [x] The readable report is written to `packages/viz/perf/report/` and printed
      to the console at the end of the run.
- [ ] **The CI job actually running on GitHub.** Not executed: this repository's
      workflows are `workflow_dispatch`-only by the maintainer's standing
      decision, and an agent does not dispatch them. The workflow file is
      committed and its YAML shape mirrors the existing `ci.yml`, which does
      run. Reasoning and variance numbers are recorded in
      [README.md](README.md), as AC-4 requires.

## Reduced-motion audit (NFR-7, AC-5)

- [x] Under `prefers-reduced-motion: reduce`, the first frame is already
      settled: `settled.durationMs === 0`, and the camera is byte-identical
      across 20 consecutive frames (no fit flight).
- [x] No hot-spot pulse: two canvas screenshots 700 ms apart with no input are
      byte-identical.
- [x] The control passes too — with animation enabled the same two screenshots
      **differ**, so the stillness check above is not vacuous.
- [x] The emulation itself is asserted before anything else, after Playwright's
      `test.use({ reducedMotion })` was found not to reach `matchMedia` on this
      version. Without that assertion the audit would have run green against an
      unemulated browser.
- [ ] **Search fly-to is instant.** Not audited: `flyTo` is story 3.3's and
      still throws its `notYet` error on this branch. The test probes for it,
      records an annotation naming 3.3, and skips with that reason. It becomes
      live with no edit once 3.3 merges into the epic branch — re-run
      `pnpm --filter @gitnebula/viz perf` then.
- [ ] **Screen-reader and keyboard review of the export control.** Not
      executed: no assistive technology in this environment. The button is a
      real `<button>` with a `title`, focusable and activatable by keyboard,
      matching the existing `replay` control it sits beside.

## Summary

Ran 17 of 22 checks. The five left for a human are: the by-hand button click
and OS download, the CI job on GitHub, the fly-to leg of the audit (blocked on
story 3.3, by design), and a screen-reader pass — none of which can be
executed headlessly in this worktree, and each stated above with its reason.
