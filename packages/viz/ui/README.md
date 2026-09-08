# The `ui` suite — the assembled Viewer, in a real browser

This directory holds the Playwright suite that opens the Viewer the way a reader
opens it: a real page, served by a real dev server, booted from a real fetch of
`analysis.json`. It exists for the assertions that no other harness in this
repository can make, and it is deliberately **not** part of `pnpm test`.

Run it on demand:

```bash
pnpm --filter @gitnebula/viz ui                 # the suite
UI_PORT=4330 pnpm --filter @gitnebula/viz ui    # when 4320 is taken
UI_HEADED=1 pnpm --filter @gitnebula/viz ui     # against a real window
```

The first run on a machine needs a browser:

```bash
pnpm --filter @gitnebula/viz exec playwright install chromium
```

## Why it is not in `pnpm test`

`packages/viz/package.json` declares the two commands separately —
`test` is `vitest run` (`package.json:13`) and `ui` is
`playwright test -c ui/playwright.config.ts` (`package.json:17`). No script
reaches from the first to the second, and that is the point: **`pnpm test` has
to keep passing on a machine with no browser installed.** A unit-test run that
silently downloaded and launched Chromium would be a slower, network-dependent,
differently-shaped contract from the one this workspace offers. `perf` and
`bundle-check` are explicit scripts for the same reason; `ui` is wired
identically.

That was verified rather than assumed when the suite was built: with
`PLAYWRIGHT_BROWSERS_PATH` pointed at an empty directory,
`pnpm --filter @gitnebula/viz test` passed in full while
`pnpm --filter @gitnebula/viz ui` failed loudly with
`browserType.launch: Executable doesn't exist`
(`docs/dev/epic-6/6.1-viz-ui-suite/MANUAL_TESTING.md`).

**The boundary is the spec files, not this directory.** `ui/tests/*.pw.ts` runs
only when you ask for it. `ui/src/suite-conventions.test.ts` is a vitest file
and _does_ run on every `pnpm test`, by design: it is the check that the
conventions below are actually followed, and a convention check that only ran
inside an on-demand suite would only run when somebody remembered to run the
suite — which is the gap it exists to close.

## The port, and why the server is never reused

| suite    | env var       | default  |
| -------- | ------------- | -------- |
| `perf`   | `PERF_PORT`   | 4318     |
| `bundle` | `BUNDLE_PORT` | 4319     |
| `ui`     | `UI_PORT`     | **4320** |

The suite starts its own Vite server on that port with `--strictPort`, and
`reuseExistingServer: false` (`playwright.config.ts:88-100`). Both settings are
load-bearing.

**Server reuse is forbidden here.** The convenient setting is
`!process.env.CI`, and it is also how a suite ends up reporting a clean pass
over a working tree that is not the one under test: this repository is
developed in several agent worktrees on one machine, whoever holds the port owns
the server, and an attaching run measures somebody else's code. That happened
during review of story 3.5 — a green 8-passed run traced by `lsof` to another
checkout entirely. So a port collision fails loudly instead of quietly producing
the wrong answer, and `UI_PORT` is how concurrent worktrees coexist. Do not
relax either setting; `ui/src/suite-conventions.test.ts:247` fails if you do.

The suite also pins its own document — `GITNEBULA_FIXTURE: "root-files"`, six
nodes across three layers — rather than inheriting the dev server's default of
`synthetic-100x2000`, the 2,000-file perf yardstick. A suite that inherited it
would assert against the wrong document while looking entirely normal.

## What is in here

Eight spec files, 44 tests, measured with
`playwright test -c ui/playwright.config.ts --list`:

| spec                         | tests | what it covers                                                                                                                   |
| ---------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tests/smoke.pw.ts`          | 3     | the harness reaches a booted Viewer, the layout settles, the pinned fixture is the one served — plus the negative control        |
| `tests/boot.pw.ts`           | 2     | `boot()` assembles the viewer over the document it fetched; `?view=3d` picks the engine at boot                                  |
| `tests/view-swap.pw.ts`      | 5     | the real `swapEngine`: the eight carried fields across a 2D→3D→2D round trip, the republished handle, the 3D fallback            |
| `tests/pointer-hit.pw.ts`    | 2     | a click at real screen coordinates selects the node it was aimed at, and empty space clears the selection                        |
| `tests/load-failure.pw.ts`   | 11    | the first screen of a failed load, across all three failure kinds, including `file://` and markup-in-a-detail                    |
| `tests/validator-seam.pw.ts` | 11    | the gap between the fields the schema requires and the fields the loader checks, and what the Viewer does with each              |
| `tests/reachability.pw.ts`   | 7     | every panel control stays inside the window and pressable at 1280×800 and 1280×600; the bounded regions scroll their own content |
| `tests/tooltip-edges.pw.ts`  | 3     | the tooltip flips against a box that was actually measured in a laid-out page                                                    |

`tests/support/` holds the two fixtures the specs build for themselves: a
load-failure page driver and a 44-partner co-change document.

## What only a browser can reach

Four facts about this codebase decide what belongs here rather than in a jsdom
test. Each is why one of the specs above exists.

### `boot()` used to be executed by nothing

This is history, and worth knowing because the shape that caused it is still
there. `boot()` (`src/app.ts:120`) is roughly 120 lines — it fetches the
document, renders the error screen on failure, mounts the chrome, parses
`?view=3d`, builds the engine and wires the search box and the tooltip. Its only
caller is the Vite entry point, `src/main.ts:9`; `src/index.ts:9` re-exports it
and calls nothing; and `src/app-view-swap.test.ts` imports only the three _pure_
helpers beside it, saying so in its own header at line 23: "`boot()` itself is
not exercised here — it fetches `analysis.json`."

The reason was structural, not an oversight. `swapEngine`, `captureState` and
`restoreState` are closures **inside** `boot()` (`src/app.ts:208`, `:219`,
`:244`) — nothing exports them, nothing can reach them — and `boot()` fetches
`analysis.json` before any of them exists. There is no seam to inject and no
function to call. A browser with a server in front of it is the only way in.

It is executed now, by `tests/boot.pw.ts` and `tests/view-swap.pw.ts`.

### Production capture/restore is authoritative for view-state carryover

When the reader switches between the 2D and 3D views, what survives the switch
is decided by `captureState` and `restoreState` in `app.ts` — the eight
`CarriedState` fields at `src/app.ts:180-206`: mode, layer filter, scope,
connected-only, selection, isolate, blast radius and the pending return-scope
offer. Those two closures are the behaviour; `tests/view-swap.pw.ts` drives them
by clicking the real control and reading the result back through the harness
handle, over a full 2D→3D→2D round trip.

So a field dropped from `restoreState` is a red run here. Before this suite it
was not: nothing executed those closures at all.

**The jsdom `carry()` helper stays.** `src/app-view-swap.test.ts:50`
re-implements the same eight-field copy by hand, with a comment saying it must
be kept in step with `app.ts`. It is duplicated but not dead — it exercises
state transfer between a real 2D and a real 3D engine, in milliseconds, on every
`pnpm test`, with no browser installed, and it is used at seven call sites in
that file. Deleting it would trade a fast always-on check for a slow on-demand
one. What changed is that the duplication is no longer _load-bearing_: if
`carry()` drifts out of step with `app.ts`, `view-swap.pw.ts` is where that now
shows up.

### The jsdom fake canvas cannot represent real-coordinate picking

The engine converts a pointer event to a canvas point the same way in five
places — `event.clientX - rect.left, event.clientY - rect.top`, with `rect` from
`canvas.getBoundingClientRect()` (`src/engine/engine.ts:1790-1792` is the
clearest of them).

Under jsdom that rect is a fixture. `src/test-support/fake-canvas.ts:113-123`
replaces `HTMLElement.prototype.getBoundingClientRect` — the whole prototype,
every element — with a fixed box at `x: 0, y: 0`, and `devicePixelRatio` is
always 1 there. So in every jsdom test the canvas sits exactly at the viewport
origin, `rect.left` and `rect.top` are both zero, and **the subtraction under
test subtracts nothing.** A bug in that arithmetic is not merely untested; it is
unobservable. `src/engine/engine.test.ts` scans a grid with `pick()` and is a
good test of the picking _geometry_, but it runs against a canvas that cannot
have an offset.

In the real page the canvas lives inside `<main>`, below a `<header>`, so
`rect.top` is tens of pixels and the subtraction decides the answer.
`tests/pointer-hit.pw.ts` is the one place it is exercised for real — and it
refuses to run against a target where the offset would not change which node is
picked, so a passing click means something.

### Reacquire the harness handle after every swap

`publishHarnessHandle(engine)` is called **inside** `swapEngine`
(`src/app.ts:267`), so the value at `HARNESS_HANDLE_KEY` is replaced whenever
the view changes. A spec that reads the handle once and keeps the reference is
holding a **destroyed** engine from that point on.

That fails quietly rather than loudly: `destroy()`
(`src/engine/engine.ts:377-395`) cancels the frame, removes the canvas
listeners and clears the emitter, but every getter still answers. A stale handle
does not throw — it reports the past, plausibly. Re-read the handle after any
action that can swap the engine. `tests/view-swap.pw.ts:390` demonstrates the
trap deliberately rather than merely avoiding it, so the rule has a test behind
it.

## Writing a spec here

Three conventions, all enforced by `ui/src/suite-conventions.test.ts` on every
`pnpm test`, so a new spec is covered the moment it lands:

1. **Navigate with `openViewer`** (`packages/viz/harness/page-helpers.ts:27`),
   never `page.goto`. `page.goto` resolves on the load event, but the Viewer
   boots asynchronously — it fetches `analysis.json` before it can build an
   engine — so the harness handle appears _after_ navigation resolves.
   Navigating directly is a race that fails intermittently, in whichever spec
   won the scheduler that run.
2. **Import `HARNESS_HANDLE_KEY`** from `src/harness-handle.js`; never write
   `"__gitnebula"` out. The check tests provenance, not spelling: a locally
   declared constant is rejected, because a forked key leaves a suite green
   against a handle that no longer exists.
3. **Give every `expect` a prose failure message.** A red run in this suite is
   read by someone who was not there when it was written.

And one convention the checker cannot enforce: **show the assertion failing.**
The pattern is `perf/tests/export.pw.ts` — take the positive assertion's own
machinery, feed it one deliberately falsified input, and require it not to pass.
`smoke.pw.ts` gives the harness wait a key that is not the handle and requires a
timeout, then confirms the real key resolves on that same page, so the control
is shown to discriminate rather than merely to be broken. A control asserting
`expect(1).toBe(2)` would prove Playwright can fail and nothing about this
harness.

## Where the rest of the browser coverage lives

This is not "the browser tests". Two Playwright suites sit beside it and cover
different things, and 323 jsdom tests across 21 files under `src/chrome/` already assert
the readouts by driving components with fake engines.

| harness  | location                        | run with                                    |
| -------- | ------------------------------- | ------------------------------------------- |
| `perf`   | `packages/viz/perf/`            | `pnpm --filter @gitnebula/viz perf`         |
| `bundle` | `packages/viz/bundle/`          | `pnpm --filter @gitnebula/viz bundle-check` |
| jsdom    | `packages/viz/src/**/*.test.ts` | `pnpm --filter @gitnebula/viz test`         |

Anything a fake engine can prove belongs in a jsdom test, which is faster, runs
on every commit, and needs no browser. This suite covers only what those
structurally cannot reach: the assembled page, booted the way a reader boots it.

Each story's own record — what it found, what it measured, what it left alone —
is under `docs/dev/epic-6/`.
