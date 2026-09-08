# Story 6.4 — every control stays reachable at a real window size

Two new specs in the `ui` suite story 6.1 built, and the measurements behind
them. **No file under `packages/viz/src/` is modified** — this story tests
shipped behaviour and reports what it finds.

## The gap this closes

The panel's height caps were guarded by a **regex over the stylesheet**.
`packages/viz/src/chrome/blast-radius.test.ts:412-431` reads `styles.css` as
text and asserts that `max-height:` and `overflow-y: auto` appear in the
`.p-blast-list` and `#panel` rules. Its own comment calls this "a weaker check
than a rendered one, and still enough to catch the cap being deleted", which is
fair and also precise about what it cannot see:

| the guard would still pass if… | because |
| --- | --- |
| the cap were `max-height: 0` | the regex only asks that the property is present |
| a later rule overrode the cap | it reads one rule, not the cascade |
| a flex parent broke the bound | it reads text, and text has no layout |

That test is **not replaced**. It runs in `pnpm test` on a machine with no
browser, which is worth keeping. The specs here are the rendered check beside
it.

The defect being guarded is real and was measured, not imagined:
`styles.css:874-881` records one file on this repository with **44 co-change
partners**, and `body` is `overflow: hidden` (`styles.css:126`), so content
past the fold is *unreachable* rather than merely off-screen.

## Files

| file | NEW/UPDATE | why |
| --- | --- | --- |
| `packages/viz/ui/tests/reachability.pw.ts` | NEW | AC-1, AC-2, AC-3 — the panel's controls, the three bounded regions, and the negative control |
| `packages/viz/ui/tests/tooltip-edges.pw.ts` | NEW | AC-4 — the tooltip's flip against a box that was actually measured |
| `packages/viz/ui/tests/support/long-cochange-document.ts` | NEW | builds the 44-partner document from the `root-files` fixture and serves it over `page.route` |
| `docs/dev/epic-6/6.4-viz-reachability/README.md` | NEW | this file |
| `docs/dev/epic-6/6.4-viz-reachability/MANUAL_TESTING.md` | NEW | the steps, marked with what was actually run |
| `docs/implementation-artifacts/epic-6-assembled-viewer/6.4-viz-reachability.md` | UPDATE | tasks ticked, Dev Agent Record filled |

`ui/playwright.config.ts` is untouched — its `GITNEBULA_FIXTURE: "root-files"`
pin still means what `smoke.pw.ts` asserts it means. Nothing was added to
`packages/contract/fixtures/`. No dependency was added.

## The test material, and how to reproduce it

`root-files` has exactly **one** co-change pair, so it cannot produce a long
list. `support/long-cochange-document.ts` reads that fixture from disk — the
same path `vite.config.ts` resolves — and **adds to** it:

- 44 file nodes `partner-000.py` … `partner-043.py`, each paired with
  `fp/proxy.py` at a descending `count`, so the panel's own `count desc, id
  asc` sort is exercised;
- import edges over three contiguous bands (0–7 imported, 8–15 importing,
  16–23 in the `test` layer) so that `#start-here` fills all three of its
  categories to `START_HERE_LIMIT` and can actually reach its own cap —
  otherwise AC-2's assertion about that region would be vacuously green;
- one node with a deliberately long path, for the tooltip spec.

Two self-checks keep the material honest, and both throw rather than warn:

1. the built document is run through `validateAnalysis` — the same validator
   the cli uses on what it assembles;
2. the partner-row count is re-derived from the document and compared against
   `EXPECTED_PARTNER_ROWS`. **That count is 45, not 44**: `root-files` already
   pairs `fp/proxy.py` with `test_proxy.py`, and this builder adds rather than
   replaces. The first run of this story failed on exactly that off-by-one,
   usefully.

Reproduce with:

```bash
pnpm --filter @gitnebula/viz ui                 # the whole suite
UI_PORT=4323 pnpm --filter @gitnebula/viz ui    # when 4320 is taken
```

Everything below was measured at `deviceScaleFactor: 1` on the machine this
story was developed on (macOS, Chromium via Playwright 1.62). Absolute pixel
values depend on the system font; the **relations** the specs assert do not,
which is why no spec asserts an absolute width.

## AC-1 / AC-6 — the measurement

45 partner rows, measured row height **25 px**, list content **1125 px**. The
`styles.css` comment estimated "44 partners at ~23 px a row, over 1,000 px of
list"; measured, it is 45 rows at 25 px and 1125 px. The estimate was right.

Header height is **103 px** at 1280 wide (the header wraps), so the canvas
starts at y=103 and `main` is `viewport height − 103`.

| | 1280×800 | 1280×600 |
| --- | --- | --- |
| `#panel` content / visible | 679 / 659 px | 603 / 459 px |
| `#panel` box (top → bottom) | 121 → 782 | 121 → 582 |
| `.p-blast-list` content / visible | 1125 / 304 px | 1125 / 228 px |
| `#start-here` content / visible | 969 / 505 px | 969 / 305 px |
| `show on map`, before any scroll | 711 → 741 | **635 → 665** |
| `isolate`, before any scroll | 755 → 785 | **679 → 709** |
| **was any control unreachable before scrolling?** | no | **yes — both** |

**So yes, a control was found below the fold.** At 1280×600 both `show on map`
and `isolate` sit past the bottom of a 600 px window before anything is
scrolled. They are reachable only because `#panel` carries `overflow-y: auto`
and a reader can scroll *that region*; the page itself cannot scroll. That is
the cap doing exactly the job it was added for, and it is now asserted against
rendered boxes rather than against stylesheet text.

Both controls were also **pressed**, not merely measured: the specs click them
and require the engine to agree — `getBlastRadius()` returns 45 ids and
`getIsolated()` returns `fp/proxy.py`. A control that is visible and inert is
worse than one that is missing.

### What "reachable" had to mean, and a trap worth recording

The first version of the spec used Playwright's `scrollIntoViewIfNeeded()`, and
**AC-3's negative control caught it**: with the caps removed, every control was
still reported reachable. `overflow: hidden` stops a *reader* from scrolling;
it does not stop a *script*. `scrollIntoView` scrolls the document happily, so
the helper was rescuing the page in a way no mouse can — the check could not
tell a bounded panel from an unbounded one, which is the very weakness it was
written to replace.

The specs now model the reader's wheel: find the nearest ancestor that is
genuinely a scroll container (computed `overflow-y` of `auto`/`scroll` **and**
actually overflowing) and scroll that one element by the minimum needed. With
no such ancestor, nothing moves.

## AC-2 — the three bounded regions, at 1280×600

Each region is asserted to overflow, to compute a scrolling `overflow-y`, to
actually move when asked to scroll to its own end, and to keep its own box
inside the window.

| region | content | visible | `overflow-y` | scrolls | box inside window |
| --- | --- | --- | --- | --- | --- |
| `#panel` | 603 px | 459 px | `auto` | yes | yes (121 → 582) |
| `#start-here` | 969 px | 305 px | `auto` | yes | yes (219 → 526) |
| `.p-blast-list` | 1125 px | 228 px | `auto` | yes | yes (399 → 627) |

Measured at 600 px height deliberately: `#panel`'s bound is
`calc(100% - 36px)` and `#start-here`'s is `calc(100% - 190px)`, both against
`main`, so a short window is where all three are genuinely pushed past their
bounds. At 800 px `#start-here` and `.p-blast-list` still overflow, but the
panel's controls do not go below the fold, so a second identical assertion
there would mostly be measuring regions that are not under pressure.

### The reader's own wheel

Setting `scrollTop` proves a region *can* scroll; it does not prove the
reader's gesture reaches it. A second spec drives a real 400 px wheel and
asserts three things: over `.p-blast-list` the list moves, over the panel's
upper rows `#panel` moves, and **the page never moves** in either case.

Two things this turned up, both worth recording because both produced a false
red first:

- **A wheel is consumed by the innermost scroll container under the pointer.**
  Aimed at the panel's centre it scrolls `.p-blast-list`, not `#panel` — which
  is correct behaviour and is what the reader experiences, so the spec aims
  each gesture where it actually applies rather than asserting the wrong
  element moved.
- **Chromium scrolls off the main thread.** Reading `scrollTop` on the line
  after `mouse.wheel` reads the value from before the gesture, reporting a
  perfectly scrollable panel as unscrollable. The spec waits for the value to
  pass its starting point instead, resolving to a boolean so the assertion
  carries prose rather than a bare Playwright timeout.

## AC-3 — the negative control

The caps are defeated in-page with `page.addStyleTag` (nothing in
`packages/viz/src/` is touched, and the override dies with the page), and the
same reachability function is required to **fail**:

| | caps intact | caps defeated |
| --- | --- | --- |
| `#panel` rendered height | 461 px in a 600 px window | **1502 px** |
| `show on map` top | 635, scrolled into view | **1532** |
| `isolate` top | 679, scrolled into view | **1576** |
| a scrollable ancestor exists | yes (`#panel`) | **no** |
| every control reachable | **yes** | **no** |

The test also asserts, before falsifying anything, that the controls *were*
reachable with the caps in place — a control that is red either way proves
nothing — and asserts that the override actually took effect, so a stylesheet
that silently failed to apply cannot be mistaken for a passing cap.

## AC-4 — the tooltip, against a box that was actually measured

`tooltip.ts:104-107` measures the live element with `offsetWidth` /
`offsetHeight`. **In jsdom both are permanently 0**, which is why
`tooltip.test.ts:116-122` passes. The pure `tooltipPosition` is already swept
exhaustively over a viewport grid at `tooltip.test.ts:46-86` and is **not**
re-tested here (AC-5); what had never run is the chain *real font renders →
real text width → correct flip*, because its inputs were never real.

Measured at 1280×800, cursor 40 px inside the right edge:

| | value |
| --- | --- |
| rendered label | `services/…/normalise-inbound-webhook-payloads.py · churn 20%` |
| measured box | **643.125 × 26 px** (jsdom reports 0 × 0) |
| cursor (client) | x = 1240 |
| unflipped right edge would be | 1240 + 14 + 643 = **1897 px**, in a 1280 px window |
| rendered box | x 583 → 1226 |
| a *clamp* would have put it at | x 636.9 |

So the tooltip **flipped** rather than being clamped — it landed strictly left
of where a clamp would leave it — and its rendered rectangle stayed inside the
window. That is the first time the flip has been decided on a box with a real
width.

Both assertions were watched failing. With `.tooltip { font-size: 0 }` injected
so the box measures 0 × 0 — precisely the jsdom condition — the "real box"
check goes red (`measured a 0x0 box`) and the right-edge check goes red on its
own premise guard (`would have ended at 1254px in a 1280px window, which does
not overflow — so this position does not exercise the flip`).

## Finding: the tooltip is positioned in the wrong coordinate space

**Reported, not fixed.** This is `packages/viz/src/`, which AC-5 and AC-7
forbid this story from touching, and 6.5 already owns the chrome in this epic.

`.tooltip` is `position: fixed` (`styles.css:315`), so the `left` / `top` that
`tooltip.ts:117-118` writes are **viewport** coordinates. But the `screen`
point the hover event carries is **canvas**-relative: `engine.ts:1789-1791`
computes `event.clientY - rect.top`, and the canvas sits below the header. The
two spaces are never reconciled.

Measured at 1280×800, header 103 px:

| | value |
| --- | --- |
| cursor, client y | 794 (6 px from the bottom of the window) |
| cursor, canvas y | 691 |
| tooltip rendered top | **705** |
| gap the code intends | +14 px, *below* the cursor |
| gap actually rendered | **−89 px** — the tooltip sits 89 px *above* the cursor |

89 px is `103 − 14`: the header's height, less the intended offset. Two
consequences:

1. **The tooltip does not sit where the cursor is.** Horizontally it is
   correct, because the canvas' `rect.left` is 0; vertically it is a header's
   height too high, everywhere on the map.
2. **The bottom-edge flip cannot be reached by a real pointer.** The flip fires
   when `y + 14 + height + 8 > viewport.height`, i.e. above a canvas y of 752 at
   this window size — but the canvas is only 697 px tall, so the largest canvas
   y a pointer can produce is 697. It is short by 55 px. The branch is
   unreachable in the assembled page, and only reachable in the unit test
   because that test calls the pure function directly.

Neither of these makes the tooltip overflow the window — it errs *upward*, into
the page — so AC-4's stated requirement holds and the spec asserts it. The spec
deliberately asserts **nothing** about the offset in either direction: a
correct implementation would flip and stay inside the window, so the existing
assertions survive a fix and none has to be deleted to land one.

A story that fixes this would either pass the client point to the tooltip, or
make `.tooltip` `position: absolute` inside `main` so its containing block and
its coordinate source agree. That is a decision about shipped behaviour and
belongs to whoever takes it.

## Also reported, and deliberately unfixed

`pnpm lint` (`prettier --check .`) fails on `intent.md`. `.prettierignore`
lists `plan.md`, `DECISIONS.md` and `PR_SUMMARY.md` under "terminal-agents
worktree scratch files (never committed)", but not `intent.md`, which is a
newer convention. The file is gitignored and never reaches a commit, so the
lint failure is spurious. Working around it locally costs one command
(`pnpm exec prettier --write intent.md`).

It is one line in a shared file that all three wave-B agents hit within the
same hour, so patching it from three branches is worse than reporting it once.
Both peers were told; the maintainer's call.

## What was verified

| command | result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm --filter @gitnebula/viz test` | **827 passed, 56 files** — includes 6.1's `suite-conventions`, which globs `ui/tests/*.pw.ts` and polices both new specs |
| `pnpm --filter @gitnebula/viz typecheck` | pass |
| `pnpm --filter @gitnebula/viz ui` | **13 passed** (3 from 6.1's smoke spec, 7 reachability, 3 tooltip) |
| `pnpm build` | pass |

The `ui` suite is not part of `pnpm test`, by a decision recorded in `epics.md`
and re-stated in 6.1's README: `pnpm test` must keep passing on a machine with
no browser installed.
