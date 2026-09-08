# Manual testing — story 6.4

Every box below was either **executed** in this worktree and marked `[x]` with
the observed result inline, or left `[ ]` **with the reason it could not be**.
An unchecked box with a reason is honest; a checked box nobody ran is a lie the
reviewer builds on.

Unless stated otherwise, steps ran through the `ui` Playwright suite against a
real Chromium, on the synthetic 45-partner document
(`ui/tests/support/long-cochange-document.ts`).

```bash
pnpm install
pnpm --filter @gitnebula/viz exec playwright install chromium   # first run only
UI_PORT=4323 pnpm --filter @gitnebula/viz ui
```

## 1. The suite

- [x] `UI_PORT=4323 pnpm --filter @gitnebula/viz ui` — **13 passed** in 22.7 s.
      Three are story 6.1's smoke spec, unchanged and still green; seven are
      `reachability.pw.ts`; three are `tooltip-edges.pw.ts`.
- [x] `pnpm --filter @gitnebula/viz test` — **827 passed across 56 files**.
      This is the run that matters for the cohort: 6.1's
      `ui/src/suite-conventions.test.ts` globs `ui/tests/*.pw.ts`, so both new
      specs are held to the handle-import, no-`page.goto` and
      prose-message-on-every-`expect` rules here, on a machine with no browser.
- [x] `pnpm lint` — clean, after formatting the three new files with Prettier.
- [x] `pnpm --filter @gitnebula/viz typecheck` — clean. It caught one real
      error: `noUncheckedIndexedAccess` makes the harness-handle lookup
      possibly `undefined`, which is now guarded like every other lookup in the
      suite.
- [x] `pnpm build` — clean (`viz` via vite, `cli` via tsup).
- [x] `git status` shows **three new paths and nothing else**. No file under
      `packages/viz/src/` is modified; `ui/playwright.config.ts`,
      `harness/page-helpers.ts`, `smoke.pw.ts` and
      `suite-conventions.test.ts` are byte-identical to the base branch.

## 2. Reachability at a real window size (AC-1)

- [x] At **1280×800**, panel open on `fp/proxy.py`: `show on map` (711→741) and
      `isolate` (755→785) are inside the window before anything is scrolled.
- [x] At **1280×600**: both controls sit **below the fold** before scrolling —
      `show on map` at 635→665 and `isolate` at 679→709, in a 600 px window.
      They become reachable only by scrolling `#panel`, which is exactly what
      its `overflow-y: auto` is for. **This is the story's whole case,
      reproduced.**
- [x] Every control passes an `elementFromPoint` hit test at its own centre —
      a correct box with something painted over it is not clickable, and the
      reader cannot tell those apart.
- [x] Both controls were **clicked**, at both window sizes, and the engine
      agreed: `getBlastRadius()` returned 45 ids and `getIsolated()` returned
      `fp/proxy.py`. A control that is reachable and inert is worse than one
      that is missing.
- [x] `document.body` still computes `overflow: hidden` — asserted, not
      assumed, because it is the premise the whole story reasons from.

## 3. The three bounded regions (AC-2)

At 1280×600, each region overflows, computes a scrolling `overflow-y`, moves
when asked to scroll to its own end, and keeps its own box inside the window.

- [x] `#panel` — 603 px of content in 459 px, `auto`, scrolls, box 121→582.
- [x] `#start-here` — 969 px in 305 px, `auto`, scrolls, box 219→526.
- [x] `.p-blast-list` — 1125 px in 228 px, `auto`, scrolls, box 399→627.
- [x] The spec fails loudly if a region does **not** overflow, rather than
      passing vacuously. `#start-here` only reaches its cap because the
      synthetic document fills all three start-here categories to
      `START_HERE_LIMIT`; without that the assertion would be green and empty.

## 4. Scrolling, in a browser, with a wheel (AC-2, and see §7)

- [x] A real 400 px `mouse.wheel` over `.p-blast-list` scrolls **the list**.
- [x] A real 400 px wheel over the panel's upper rows scrolls **`#panel`**.
- [x] Neither gesture moves the page. `document.scrollingElement.scrollTop`
      is unchanged, which is what `body { overflow: hidden }` promises: the map
      stays put under its overlays.
- [x] Two false reds on the way to this, both recorded in the README: a wheel
      is consumed by the *innermost* scroll container under the pointer, and
      Chromium applies wheel scrolling asynchronously so `scrollTop` read on
      the next line is stale.

## 5. Seen with eyes, at 1280×600 (screenshots)

Captured with a throwaway spec, inspected, then deleted — the images are run
evidence, not repository artefacts, so they are not committed.

- [x] **Panel open, nothing scrolled.** The co-change list runs off the bottom
      of the window. Neither `show on map` nor `isolate` is visible anywhere on
      screen. `#start-here` is clipped by the window edge too.
- [x] **After scrolling `#panel` to its end.** `show on map` and `isolate` are
      both fully visible, inside the window, with clear separation from the
      last partner row. Nothing is clipped or overlapped.
- [x] **With the caps defeated.** The panel runs off the bottom with no
      scrollbar and no way down: the controls are simply not on screen and
      cannot be brought there. This is the pre-5.6 state, and it looks exactly
      as bad as the story says it was.

## 6. The tooltip (AC-4)

- [x] Hovering the long-path node with a **real pointer** renders a tooltip
      measuring **643.125 × 26 px**. In jsdom the same element measures 0 × 0,
      which is why every prior assertion about the flip proved nothing.
- [x] **Right edge**: cursor 40 px inside it, the tooltip flips to the far side
      of the cursor (box 583→1226, cursor at 1240) and stays inside the window.
      It landed strictly left of where a clamp would have put it (636.9), so it
      flipped rather than being clamped — the distinction `tooltip.ts`'s own
      header says matters.
- [x] The spec refuses to pass if the flip was not *necessary*: it asserts that
      an unflipped box would have ended at 1897 px in a 1280 px window.
- [x] **Bottom edge**: cursor 6 px from the bottom, the tooltip's rendered
      rectangle stays inside the window.
- [x] Both assertions **watched failing**. With `.tooltip { font-size: 0 }`
      injected so the box measures 0 × 0 — precisely the jsdom condition — the
      "real box" check goes red and the right-edge check goes red on its own
      premise guard. Reverted; the suite is green as committed.
- [ ] **The tooltip's vertical placement is wrong, and is not fixed here.** It
      renders 89 px above the cursor because the hover point is canvas-relative
      while `.tooltip` is `position: fixed`. Measured and written up in the
      README; a fix means editing `packages/viz/src/`, which AC-5 and AC-7
      forbid this story. Left unchecked deliberately: the behaviour is
      verified, and verified wrong.

## 7. AC-8 — revisiting what story 5.6 left open

Story 5.6's `MANUAL_TESTING.md:96` carries this, unticked:

> - [ ] **Scrolling felt in a browser.** Not run, same reason as below: no
>   pixels were rendered here. The assertion above is over the stylesheet
>   text, which is strictly weaker than seeing it scroll.

**That file is not edited.** It is the shipped record of a completed story, and
this project's artifacts grow by appending rather than by rewriting. The
revisit lands here instead, and splits the item in two:

- [x] **The mechanism — now covered, and no longer subjective.** Pixels *were*
      rendered here. The regions are measured in a real browser, a real wheel
      scrolls them, the page does not move, and the controls are clicked at
      both window sizes. 5.6 could only assert stylesheet text; §3, §4 and §5
      above are the "seeing it scroll" that sentence was asking for. The
      stylesheet-text guard in `blast-radius.test.ts:412-431` stays where it
      is — it is cheap, it runs without a browser, and it is now backed by a
      rendered check rather than standing in for one.
- [ ] **The feel — still genuinely a human's call, and now the only part that
      is.** Whether the wheel has the right momentum, whether the scrollbar is
      visible enough against `--panel`, whether 228 px of list in a 600 px
      window is a comfortable amount to read through, whether the panel
      scrolling *under* a fixed close button reads as intended. None of that is
      a measurement, and an agent that ticked it would be inventing a
      judgement. **For the maintainer**, at 1280×600 with the panel open on a
      file with a long co-change list.

That is the whole of AC-8: the item is not silently ticked, and it is not left
as it was. The half a browser can answer is answered; the half that is a
judgement is stated as one and handed over.

## 8. What a reviewer should re-run

```bash
pnpm install
pnpm --filter @gitnebula/viz exec playwright install chromium
pnpm lint
pnpm --filter @gitnebula/viz test          # 827, includes the convention check
UI_PORT=4323 pnpm --filter @gitnebula/viz ui   # 13
pnpm build
```

To see the case by hand rather than through the suite, the fastest route is
`UI_HEADED=1 UI_PORT=4323 pnpm --filter @gitnebula/viz ui` and watching the
1280×600 reachability tests, which open the panel on the 45-partner document.
