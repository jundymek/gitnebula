# Story 6.2 — `boot()` and the real view swap, end to end

Three new spec files in the `ui` suite story 6.1 built. **No product code**:
`packages/viz/src/` is byte-identical to the branch base, and this story adds no
dependency and no fixture.

## What was uncovered before this story

`boot()` (`packages/viz/src/app.ts`) — roughly 120 lines that fetch the
document, render the error screen on failure, mount the chrome, parse
`?view=3d`, build the engine and wire the search box and tooltip — **was
executed by no test in the repository.** Verified rather than repeated: the only
importers of `app.js` in the whole workspace are

| importer | what it takes |
| --- | --- |
| `src/main.ts:9` | calls `boot(root)` — the entry point's side effect |
| `src/index.ts:9` | re-exports `boot`, calls nothing |
| `src/app-view-swap.test.ts:5-8` | imports **only** `swapWithFallback`, `unavailabilityAfterSwap`, `failedSwitchReason` — the three pure helpers |

and that test says so itself at line 23: "`boot()` itself is not exercised here
— it fetches `analysis.json`".

The reason it went untested is structural rather than an oversight.
`swapEngine`, `captureState` and `restoreState` are **closures inside
`boot()`** — nothing exports them and nothing can reach them — and `boot()`
fetches `analysis.json` before any of them exists. There is no seam to inject
and no function to call. A browser with a server in front of it is the only way
in, which is exactly what story 6.1 built.

The sharp consequence, and the reason this story exists: `app-view-swap.test.ts`
declares a local `carry()` helper (lines 50-69) that re-implements the
capture/restore logic by hand, with a comment saying it must be "kept in step
with" `app.ts`. So **deleting a field from `restoreState` in `app.ts` failed no
test.** `carry()` would still have copied it, 827 jsdom tests would still have
passed, and a reader would have silently lost part of their frame on every view
change.

## What is authoritative now

| behaviour | authoritative test | runs under |
| --- | --- | --- |
| `boot()` assembles the viewer over the fetched document | `ui/tests/boot.pw.ts` | `pnpm --filter @gitnebula/viz ui` |
| `?view=3d` selects the engine at boot | `ui/tests/boot.pw.ts` | same |
| the eight `CarriedState` fields survive a swap | `ui/tests/view-swap.pw.ts` | same |
| the handle is republished on every swap | `ui/tests/view-swap.pw.ts` | same |
| the switch shows the view that was **built** | `ui/tests/view-swap.pw.ts` | same |
| a click at real screen coordinates hits the aimed node | `ui/tests/pointer-hit.pw.ts` | same |
| `swapWithFallback` / `unavailabilityAfterSwap` / `failedSwitchReason` as **pure functions** | `src/app-view-swap.test.ts` (unchanged) | `pnpm --filter @gitnebula/viz test` |

**For the capture/restore behaviour, `restoreState` in `app.ts` is now the thing
under test, and `ui/tests/view-swap.pw.ts` is what tests it.**

## Is `carry()` still needed? Yes — keep it.

AC-3 asks for the answer, not for the deletion, and the answer is that
`carry()` is duplicated but **not dead**.

- It is *duplicated*: it copies the same eight fields `restoreState` copies, by
  hand, and its own comment admits the coupling.
- It is *not dead*: the tests around it assert state transfer between a real 2D
  and a real 3D engine in jsdom, in milliseconds, **on every `pnpm test`, with
  no browser installed**. My specs run only under
  `pnpm --filter @gitnebula/viz ui`, which is deliberately not part of
  `pnpm test` (story 6.1's decision, recorded in `epics.md`).

Deleting it would trade a fast always-on check for a slow on-demand one. That is
a worse position than the mild duplication, so it stays. What has changed is
that the duplication is no longer *load-bearing*: before this story `carry()`
drifting out of step with `app.ts` was undetectable; now `restoreState` has its
own test and drift shows up there.

`app.ts` and `app-view-swap.test.ts` are untouched by this story either way —
AC-7 forbids it.

## Why the pointer test had to be a browser test (AC-6)

`src/test-support/fake-canvas.ts:113-123` monkeypatches
`HTMLElement.prototype.getBoundingClientRect` — the whole prototype, every
element — to a fixed box:

```ts
HTMLElement.prototype.getBoundingClientRect = (() => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: width,
  bottom: height,
  width,
  height,
  toJSON: () => ({}),
})) as HTMLElement["getBoundingClientRect"];
```

`installFakeCanvas(1200, 800)` is how every jsdom engine test gets a measurable
canvas, and `devicePixelRatio` is always 1 there. The engine converts a pointer
event to a canvas point in five places, always as
`event.clientX - rect.left, event.clientY - rect.top` (`engine.ts:366`, `:1139`,
`:1791`, `:1812`, `:1841`, and `engine3d.ts:307`, `:1610`, `:1618`, `:1647`,
`:1655`).

So under jsdom the canvas is always at the viewport origin, `rect.top` is
always 0, and **the subtraction under test subtracts nothing.**
`engine.test.ts:290-305` scans a grid with `pick()` and is a good test of the
picking geometry, but it cannot see a rect-offset bug. In the real page the
canvas is inside `<main>`, below a `<header>` — measured at **103 px** in this
suite's 1440x900 viewport.

That is not a theoretical gap. It was measured — see below.

## Each assertion was seen red

The stack brief's rule: an assertion that has never been seen fail proves
nothing. Four defects were introduced into `packages/viz/src/` one at a time,
the suites run, and the change reverted. **Nothing from these experiments is
committed** — `git diff` against the base for `packages/viz/src/` is empty.

| # | defect introduced | `ui` suite | `pnpm test` (827 jsdom tests) |
| --- | --- | --- | --- |
| 1 | delete `to.setBlastRadius(state.blastRadius)` from `restoreState` | **1 failed** — "the three carried fields AC-3 does not name" | 827 passed |
| 2 | `onPointerUp` reads `event.clientY` instead of `event.clientY - rect.top` | **1 failed** — the AC-6 click test | 827 passed |
| 3 | `setUnavailable(probe3D(stage))` instead of `unavailabilityAfterSwap(...)` | **1 failed** — the AC-5 constructor-throws test | 827 passed |
| 4 | `viewSwitch.setCurrent(view)` instead of `setCurrent(built.view)` | **1 failed** — the AC-5 constructor-throws test | not run |

In each case exactly one test failed, and it was the intended one.

**Rows 2 and 3 are the story's justification in one line each.** Both are real
defects in shipped behaviour — row 3 is precisely the regression story 5.7's
code review found, the one the ordering comment in `app.ts:265-270` exists to
prevent — and both are **completely invisible to all 827 jsdom tests.**

Row 2's failure message, quoted because it is the shape a future reader wants:

```
Error: clicking setup.py at real screen coordinates selected something else.
The engine converts clientY to a canvas point by subtracting rect.top (103 px
here); had it not, this click would have landed on empty space
```

## The two techniques worth knowing about

### Telling the two engines apart

`engine.getOrientation !== undefined`. It is a `Nebula3DEngine` class member
kept deliberately **off** the `GraphEngine` interface (`engine3d.ts:19`,
decision D2), so it separates the implementations without either growing a
`whichAmI()` for a test's benefit. `perf/tests/degradation-3d.pw.ts:71` already
uses exactly this; following it beats inventing a second convention, and beats
`constructor.name`, which a minifier would silently break.

### Making the 3D constructor throw while the probe passes (AC-5)

This case cannot be reached by choosing a browser. `probe3D` (`view.ts:78`) and
the `Nebula3DEngine` constructor (`engine3d.ts:212`) ask the **same canvas the
same question** — both call `getContext("2d")`, because this 3D view is a
perspective projection onto a 2D canvas and there is no WebGL anywhere in it. So
any environment that fails the constructor fails the probe first, and the probe
short-circuits.

It is nonetheless the exact case story 5.7's AC-5 exists for: probe passes,
constructor throws, fall back to 2D, and the reader is shown an *enabled* 3D
button and no explanation.

The way in is to fail the **second** `getContext("2d")` call on the stage
canvas, via `page.addInitScript`. Within one `swapEngine` the sequence is
exactly three calls:

| # | caller | result |
| --- | --- | --- |
| 1 | `probe3D` (`view.ts:78`) | real context — the probe passes |
| 2 | `Nebula3DEngine` constructor (`engine3d.ts:212`) | **null → throws** `viz: canvas 2D context unavailable` |
| 3 | `createGraphEngine` (`engine.ts:246`), the fallback | real context — the 2D map works |

Nothing else touches that canvas' context: chrome may not acquire one at all
(`chrome/boundary.test.ts:27` bans it), and `export.ts`'s two calls are on
offscreen canvases during `exportPNG`, which the test never invokes. **The test
asserts it saw exactly three calls** rather than assuming it, so if that
sequence ever changes the spec fails loudly instead of quietly measuring
something else.

The payoff is a built-in negative control. Under defect #3 above the probe runs
as a fourth call against a canvas that answers normally, returns null, and
re-enables the button with an empty reason — which is why that experiment goes
red here and nowhere else.

## Files

| file | NEW/UPDATE | why |
| --- | --- | --- |
| `packages/viz/ui/tests/boot.pw.ts` | NEW | AC-1, AC-2 — the real `boot()`, and `?view=3d` with its control |
| `packages/viz/ui/tests/view-swap.pw.ts` | NEW | AC-3, AC-4, AC-5 — the real `swapEngine()` |
| `packages/viz/ui/tests/pointer-hit.pw.ts` | NEW | AC-6 — a click at real screen coordinates |
| `docs/dev/epic-6/6.2-viz-boot-e2e/README.md` | NEW | this file |
| `docs/dev/epic-6/6.2-viz-boot-e2e/MANUAL_TESTING.md` | NEW | executed steps, and AC-8 left for the owner |
| `docs/implementation-artifacts/6.2-viz-boot-e2e.md` | UPDATE | tasks ticked, Dev Agent Record filled |

New files only, and none of them shared with a peer: bob (6.3) and pamela (6.4)
write into the same directory this wave, and all five filenames were exchanged
and confirmed distinct during intent-sync. Nothing was written into
`ui/tests/support/`, which is bob's.

No `PERFORMANCE.md`: this story states no performance property, and the project
rules say not to invent budgets to test against. `pnpm --filter @gitnebula/viz
perf` was run and stays green — 10 passed, 119 fps sustained on the frozen
pan/zoom phase against a 55 fps floor.

## Running it

```bash
UI_PORT=4321 pnpm --filter @gitnebula/viz ui
```

`UI_PORT` matters: 6.1's config sets `--strictPort` and
`reuseExistingServer: false` on purpose, so two worktrees running the suite at
once fail loudly rather than one of them silently measuring the other's code
(the `lsof` incident from story 3.5). Wave B allocated 4321 / 4322 / 4323.

## Two things reported rather than fixed

1. **`intent.md` is missing from `.prettierignore`.** `plan.md`, `DECISIONS.md`
   and `PR_SUMMARY.md` are all listed there as "terminal-agents worktree scratch
   files (never committed)"; `intent.md` is the same kind of file — gitignored,
   agent-local, produced by every agent that has a cohort — but is not listed,
   so `pnpm lint` fails in any worktree that has one until the file happens to
   be Prettier-clean. Not fixed here: it is a shared config file, three agents
   in this wave hit it, and three branches patching it three ways is worse than
   the gap. Reported to bob and pamela directly.

2. **The `sprint-status.yaml` contradiction.** `config/projects/gitnebula/
   rules.md` says "flip only your own story's row"; the supervisor contract says
   the file has exactly one writer. Superman instructed all three of wave B to
   leave it alone and writes every row at closure. Our three rows are adjacent
   lines, so two of us flipping our own cannot merge — which already cost a
   rebase and a full re-review in wave A. This branch does not touch the file.
   See `DECISIONS.md` D1.
