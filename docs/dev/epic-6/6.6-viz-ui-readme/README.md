# 6.6 — the UI suite's own README

Story: `6.6-viz-ui-readme` · Owner module: `viz` · Base:
`epic/6-assembled-viewer` · Verified against the branch head at `c985bb6`, then
rebased onto the current tip.

**One new product file: `packages/viz/ui/README.md`.** No product code, no
dependency, no fixture, no change under `packages/viz/src/`, `.specwitness/` or
`scripts/specwitness/`, and no row touched in
`docs/implementation-artifacts/sprint-status.yaml`.

## What the contract asked for, and what was already true

The maintainer's frozen verification contract for this epic,
`.specwitness/contracts/epic-6.yaml`, reads `packages/viz/ui/README.md` by that
exact path — `scripts/specwitness/docs-presence.mjs:35`, under a comment at
`:34` naming the two criteria it serves. The file did not exist. No story spec
in Epic 6 ever commissioned it: story 6.1 was asked for, and delivered,
`docs/dev/epic-6/6.1-viz-ui-suite/README.md`. So the gap was between two
documents rather than inside either, and closing it needed a story rather than
a correction.

**Three criteria, not two.** The story spec names E6-06 and E6-17 while stating
that three of the run's eleven failures are this one file. The third is
**E6-02**, and it is not obvious from the contract alone — E6-02's statement is
about the strict-port server, but its plan attaches a `docs-presence` probe
asserting `$.uiReadmePresent` and `$.uiReadmeMentionsOnDemandSeparation`
(`.specwitness/plans/epic-6.yaml:206-226`), because the criterion also requires
that the epic "documents that server reuse is forbidden because of the prior
cross-worktree `lsof` incident" (`.specwitness/contracts/epic-6.yaml:11`).

Both of those probe fields would have gone green from the E6-06 material alone.
That is exactly the failure mode this epic exists to close, so the README
carries the prohibition and its reason in full — the port table, `--strictPort`,
`reuseExistingServer: false`, and the story 3.5 incident where a green 8-passed
run was traced by `lsof` to another checkout entirely.

## Where each claim was verified

Read from the tree, not from the spec and not from story 6.1's README. One row
per acceptance criterion.

| AC | claim | verified at |
| --- | --- | --- |
| AC-1 | the suite is run by `pnpm --filter @gitnebula/viz ui` | `packages/viz/package.json:17` |
| AC-1 | `pnpm test` is `vitest run` and reaches no Playwright suite | `packages/viz/package.json:13` |
| AC-1 | the reason: `pnpm test` must pass with no browser installed | `.specwitness/contracts/epic-6.yaml:26` (E6-05) |
| AC-2 | `boot()`'s only caller is the Vite entry point | `packages/viz/src/main.ts:9` |
| AC-2 | `src/index.ts` re-exports it and calls nothing | `packages/viz/src/index.ts:9` |
| AC-2 | the jsdom swap test says `boot()` is not exercised there | `packages/viz/src/app-view-swap.test.ts:23` |
| AC-2 | what executes it now | `packages/viz/ui/tests/boot.pw.ts:115`, `:183` |
| AC-3 | `captureState` / `restoreState` are closures inside `boot()` | `packages/viz/src/app.ts:208`, `:219` (in `boot()` at `:120`) |
| AC-3 | eight carried fields | `packages/viz/src/app.ts:180-206` |
| AC-3 | the spec that drives the real ones across a round trip | `packages/viz/ui/tests/view-swap.pw.ts:243` |
| AC-4 | the test-only duplicate, and its own coupling comment | `packages/viz/src/app-view-swap.test.ts:50`, comment at `:48` |
| AC-4 | it is used, not dead — seven call sites | `app-view-swap.test.ts:163`, `:187`, `:206`, `:237`, `:250`, `:412`, `:427` |
| AC-4 | it runs with no browser, on every `pnpm test` | measured: 827 tests, 56 files (see `MANUAL_TESTING.md`) |
| AC-5 | the fake canvas replaces the whole prototype with a fixed origin box | `packages/viz/src/test-support/fake-canvas.ts:113-123` |
| AC-5 | the subtraction it defeats | `packages/viz/src/engine/engine.ts:1790-1792` |
| AC-5 | in the real page the canvas is inside `<main>`, below a `<header>` | `packages/viz/src/chrome/chrome.ts:296`, `:312`, `:324` |
| AC-5 | the spec that covers it, and refuses a vacuous target | `packages/viz/ui/tests/pointer-hit.pw.ts:147`, guard at `:167-173` |
| AC-6 | the handle is republished inside `swapEngine` | `packages/viz/src/app.ts:267` (in `swapEngine` at `:244`) |
| AC-6 | a destroyed engine still answers every getter | `packages/viz/src/engine/engine.ts:377-395` |
| AC-6 | the spec that demonstrates the trap | `packages/viz/ui/tests/view-swap.pw.ts:390` |
| E6-02 | server isolation, and the check that keeps it | `packages/viz/ui/playwright.config.ts:88-100`; `packages/viz/ui/src/suite-conventions.test.ts:247` |

The suite inventory in the README is measured, not transcribed: eight files and
44 tests from `playwright test -c ui/playwright.config.ts --list`, and the
per-file counts from the same listing.

## Two things the tree corrects

1. **`ui/` is not wholly outside `pnpm test`.** `packages/viz` has no vitest
   config, so vitest's default include picks up
   `ui/src/suite-conventions.test.ts`; `pnpm exec vitest list --filesOnly`
   confirms it among the 56 files. A README claiming flatly that "the `ui`
   directory is not in `pnpm test`" would be false of the directory it sits in,
   so the separation is stated at the level it actually holds:
   `ui/tests/*.pw.ts` is on demand, `ui/src/*.test.ts` is not.
2. **The jsdom count under `src/chrome/` is 323, not ~318.** Story 6.1's README
   records ~318 across 21 files, which was true when it was written; three
   stories have landed since. Re-measured here rather than carried forward.

Neither is a defect in anything shipped — both are the drift the spec warned
about when it said 6.1's README is "a source to draw on, not to copy".

## What this story did not touch

- **The tooltip coordinate-space defect** measured by story 6.4. Out of scope
  by the spec; the maintainer is scheduling it as its own story. The README's
  inventory names what `tooltip-edges.pw.ts` covers and stops there.
- **`.specwitness/` and `scripts/specwitness/`**, including the two probe
  defects the closure review reported (`findReport` not recursing — visible in
  this run as `validatorReportPath: null` — and E6-09's literal count). The
  probe was **run**, never edited.
- **`packages/viz/src/`** — `git diff` against the base is empty for that tree.
- **`docs/implementation-artifacts/sprint-status.yaml`** — this is a supervised
  cohort; the supervisor writes every row at closure from the merges GitHub
  records. The `6.6-viz-ui-readme` row is deliberately left as it stands.
- **The per-story READMEs under `docs/dev/`.** Nothing moved, merged or
  deleted. This file is a sixth story record; `packages/viz/ui/README.md` is the
  suite's entry point, and they are not the same document.

## Files

| file | NEW/UPDATE | why |
| --- | --- | --- |
| `packages/viz/ui/README.md` | NEW | the deliverable — AC-1 … AC-6, and E6-02's documentation half |
| `docs/dev/epic-6/6.6-viz-ui-readme/README.md` | NEW | this file |
| `docs/dev/epic-6/6.6-viz-ui-readme/MANUAL_TESTING.md` | NEW | the steps, marked with what was actually run |
| `docs/implementation-artifacts/epic-6-assembled-viewer/6.6-viz-ui-readme.md` | UPDATE | tasks ticked, Dev Agent Record filled |
