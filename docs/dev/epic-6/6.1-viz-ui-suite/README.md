# Story 6.1 — the `ui` suite skeleton

The `viz` package gains a third Playwright suite, `packages/viz/ui/`. This
story delivers **the harness and a proof that it can fail** — not coverage.
Stories 6.2, 6.3 and 6.4 write their specs into the directory created here.

## What already existed, stated plainly

An earlier framing of this epic said "nothing drives the chrome through a real
browser". That is false, and repeating it would misdescribe the repository to
anyone reading this folder later. Before this story:

| harness | location | tests |
| --- | --- | --- |
| `perf` | `packages/viz/perf/tests/` | 10 (fps, fps-3d, degradation-3d, export, reduced-motion) |
| `bundle` | `packages/viz/bundle/tests/bundle.pw.ts` | 4 |
| jsdom | `packages/viz/src/chrome/` | ~318 across 21 files, driving components with fake engines |

What none of them cover is the **assembled** page: `boot()` — the ~120 lines
that fetch the document, mount the chrome, parse `?view=3d` and build the
engine — is executed by no test in the repository, and its only caller is
`main.ts:9`. That gap is what the `ui` suite exists to close, and closing it is
wave B's work, not this story's.

## Running it

```bash
pnpm --filter @gitnebula/viz ui          # the suite
UI_PORT=4330 pnpm --filter @gitnebula/viz ui   # when 4320 is taken
UI_HEADED=1 pnpm --filter @gitnebula/viz ui    # against a real window
```

The first run on a machine needs a browser:
`pnpm --filter @gitnebula/viz exec playwright install chromium`.

## Why it is not in `pnpm test`

Decided at planning time with the maintainer and recorded in `epics.md`; not a
choice this story re-made. `perf` and `bundle-check` are both explicit scripts
for the same reason, and `ui` is wired identically.

`pnpm test` must keep passing on a machine with no browser installed. A unit
test run that silently downloads and launches Chromium is a different contract
from the one this workspace offers — slower, network-dependent, and a surprise
in CI. **This was verified rather than assumed:** with
`PLAYWRIGHT_BROWSERS_PATH` pointed at an empty directory,
`pnpm --filter @gitnebula/viz test` passes all 814 tests, while
`pnpm --filter @gitnebula/viz ui` fails loudly with
`browserType.launch: Executable doesn't exist`. Both runs are transcribed in
`MANUAL_TESTING.md`.

The `test` script in `packages/viz/package.json` is **unchanged** by this
story.

## The port convention

| suite | env var | default |
| --- | --- | --- |
| `perf` | `PERF_PORT` | 4318 |
| `bundle` | `BUNDLE_PORT` | 4319 |
| `ui` | `UI_PORT` | **4320** |

`reuseExistingServer: false` and `--strictPort` are **load-bearing, not
tidiness**. The comment in `perf/playwright.config.ts:69-70` records why: with
several agent worktrees on one machine, whoever holds the port owns the server,
and an attaching run reports a clean pass over a working tree that is not the
one under test. During review of story 3.5 a green 8-passed run was traced by
`lsof` to another checkout entirely. The `ui` config carries the same comment
so neither setting is removed as noise later, and
`ui/src/suite-conventions.test.ts` fails if either is.

## What wave B inherits

Everything 6.2, 6.3 and 6.4 need already exists and is enforced:

1. **`openViewer`**, now at `packages/viz/harness/page-helpers.ts` — promoted
   out of `perf/src/`, behaviour unchanged. Use it instead of `page.goto`:
   `page.goto` resolves on the load event, but the Viewer boots asynchronously
   (it fetches `analysis.json` before it can build an engine), so the harness
   handle appears *after* navigation resolves. Navigating directly is a race
   that fails intermittently, in whichever spec won the scheduler that run.
2. **`HARNESS_HANDLE_KEY`**, imported from `src/harness-handle.js`. Never write
   `"__gitnebula"` out — a forked constant leaves the suite green against a
   handle that no longer exists.
3. **The fixture**: `root-files` (6 nodes, 3 layers, 3 cross-layer file edges,
   one co-change pair), pinned in `webServer.env` rather than inherited. The
   dev server's own default is `synthetic-100x2000`, the 2,000-file perf
   yardstick; a suite that inherited it would assert against the wrong document
   while looking entirely normal.
4. **The negative-control pattern** — see below.
5. **A conventions check that enforces 1–3 automatically.**
   `ui/src/suite-conventions.test.ts` globs `ui/tests/*.pw.ts`, so a spec added
   by 6.2 is covered the moment it lands; nobody has to remember to extend a
   list.

## The negative control (AC-5)

> A suite that cannot be shown to fail is not evidence.

The pattern comes from `perf/tests/export.pw.ts:165` ("the parity check can
fail: a stale export stops matching a changed screen"): take the positive
assertion's **own machinery**, feed it one deliberately falsified input, and
require it not to pass.

Here the positive claim is "the harness handle appears and `settled` resolves".
The control gives that identical wait a key that is not `HARNESS_HANDLE_KEY`,
requires it to time out, and then confirms the real key *does* resolve on that
same page — so the control is shown to be discriminating rather than merely
broken.

Wave B should follow the shape rather than the letter. A control asserting
`expect(1).toBe(2)` would prove Playwright can fail; it would prove nothing
about this harness, which is the claim AC-5 actually makes.

## Files

**NEW**

| file | why |
| --- | --- |
| `packages/viz/ui/playwright.config.ts` | the suite: house style, port 4320, server isolation, pinned fixture |
| `packages/viz/ui/tests/smoke.pw.ts` | the minimum that proves the harness reaches a booted Viewer, plus the negative control |
| `packages/viz/ui/src/suite-conventions.test.ts` | AC-1/AC-6 as vitest — source-text claims asserted against the source, and run on every commit rather than on demand |
| `packages/viz/harness/page-helpers.ts` | `openViewer`, promoted so `perf` and `ui` share it and neither depends on the other |

**UPDATE**

| file | why |
| --- | --- |
| `packages/viz/package.json` | one added script, `ui`; `test` untouched |
| `packages/viz/tsconfig.json` | `harness` and `ui` added to `include` so the new code is typechecked as `perf` already is |
| `packages/viz/perf/tests/*.pw.ts` (5 files) | one import line each, following the promoted helper |

**DELETE**

| file | why |
| --- | --- |
| `packages/viz/perf/src/page-helpers.ts` | moved, not forked — recorded as a rename so the docstring's history survives |

## Decisions worth knowing

- **The helper lives in `packages/viz/harness/`**, outside every suite, so no
  suite depends on another. Putting it in `ui/` would make `perf` — which
  predates this story — depend on it. The name matches
  `src/harness-handle.ts`, the seam `openViewer` waits on.
- **The conventions check is vitest, not Playwright.** A convention check that
  lived inside an on-demand suite would only run when someone remembered to run
  the suite, which is the enforcement gap it exists to close.
- **`outputDir` points at `../test-results/ui`.** Playwright's default,
  `ui/test-results`, is not covered by `.gitignore`, so the first red run would
  leave untracked artefacts inside a source directory.
  `packages/viz/test-results/` is already ignored.
- **No `PERFORMANCE.md`.** This story states no performance property and
  measures nothing; inventing a budget to test against is not in scope.
- **No new dependency, no new fixture, no edit under `packages/viz/src/`.**

## Two findings, reported rather than fixed

Neither is this story's scope; both are recorded so they are not rediscovered.

1. **`perf/tests/fps-3d.pw.ts` sits ~1 fps above its own assertion floor.** The
   `c-unfold-pan` phase asserts a 20 fps usability floor and measures 21–22 fps
   on this machine. Story 5.7 already recorded it at **22 fps**
   (`docs/dev/epic-5/5.7-viz-3d-view/PERFORMANCE.md:47`, marked *below* the
   55 fps target). Under load from a second agent it dipped under 20 and the
   test went red; re-run alone it passed at 21. This is a pre-existing margin,
   not a regression from this story — the whole `perf` diff here is five import
   lines, none of which the 3D renderer loads. Left alone deliberately:
   retuning a perf assertion belongs to whoever owns that measurement.
2. **`.prettierignore` omits `intent.md`.** It already lists the other
   terminal-agents worktree scratch files (`plan.md`, `DECISIONS.md`,
   `PR_SUMMARY.md`), so `pnpm lint` goes red for any agent in a cohort until
   the file happens to be Prettier-clean. Not edited here — it is shared config
   and every cohort agent would race to add the same line.

Separately, `packages/viz/tsconfig.json` still omits `bundle` from `include`,
so `bundle/tests/bundle.pw.ts` is never typechecked. `harness` and `ui` were
added rather than copying that omission, but `bundle` was left alone: fixing it
is not this story's ask.
