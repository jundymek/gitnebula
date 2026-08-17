# Manual testing — 5.11 start-here `core` ranking

Every step that can be executed headless **was executed** on this branch, with
the observed result recorded inline. Steps needing a real browser are unticked
with the reason stated: no browser extension is connected in this environment,
so nobody looked at the panel.

Environment: macOS, Node 20, CLI built from this branch, three real
repositories analysed with the shipped binary.

## Automated baseline

- [x] `pnpm lint` — exit 0.
- [x] `pnpm -r typecheck` — exit 0 across all packages.
- [x] `pnpm --filter @gitnebula/viz test` — full suite green.
- [x] The regression tests were watched **failing** under the superseded rule:
      reverting the score to plain in-degree turns
      *"puts the file with the most code above the one with the most
      importers"* and the tie-break case red.

## 1. The finding reproduces (the reason this story exists)

- [x] Analysed this repository with the shipped CLI: 449 nodes, 567 edges.
- [x] Ranked `core` under the **old** rule. **Observed** top five:
      ```
      57 imports  loc=  38  packages/contract/src/index.ts
      23 imports  loc=  77  packages/viz/src/engine/index.ts
      22 imports  loc= 158  packages/viz/src/engine/constants.ts
      22 imports  loc=  29  packages/viz/src/test-support/fixtures.ts
      20 imports  loc=  40  packages/cli/src/errors.ts
      ```
      342 lines between them, four of five barrels or leaves.
- [x] `engine/engine.ts` under the old rule: **rank 9**, never shown.

## 2. The new rule, on the same repository (AC-1, AC-2)

- [x] Ranked through the shipped model code, not a reimplementation of it.
      **Observed:**
      ```
      13 importers · 1,694 lines   packages/viz/src/engine/engine.ts
      5 importers · 1,386 lines    packages/viz/src/engine/engine3d.ts
      19 importers · 333 lines     packages/viz/src/engine/types.ts
      22 importers · 158 lines     packages/viz/src/engine/constants.ts
      12 importers · 216 lines     packages/cli/src/test-support.ts
      ```
- [x] `engine/engine.ts` rank: **1** (was 9). Total lines in view: **3,787**
      (was 342). Barrels in the top five: **0** (was 4).
- [x] The blurb states the rule: "the most code that the rest of the
      repository depends on".

## 3. Not overfit to this repository

- [x] **842-node repository** (`~/dev/fakerfill`, `--window-days 730`).
      Old rule surfaced `lib/utils/index.ts` (**3 lines**) and
      `components/ui/Button/index.ts` (**2 lines**). New rule drops both;
      top five is the types module (450), feature flags (436), locale table
      (429), a webhook helper (760) and the generator (443).
- [x] **176-node repository** (`~/dev/crypto-bot`). Old rule headed the list
      with a 31-line logger. New rule heads it with `src/data/store.ts`
      (832 lines), then the exchange client, the funding types, the dashboard
      types and the agent base class.

## 4. Rejected candidates, measured rather than argued

- [x] **Non-test importers only.** Still three barrels in the top five, and
      `engine.ts` demoted further — most of its importers are tests. Rejected.
- [x] **`importers × sqrt(loc)`.** Kept `contract/src/index.ts` and
      `engine/index.ts` in the top five — the two files the change exists to
      demote. Rejected.
- [x] **`loc` alone.** Put a 906-line stylesheet into `core`. Rejected.

## 5. The other two categories were checked, not assumed

- [x] Entry points on this repository rank `cli/src/index.ts`,
      `perf-spike/src/main.ts`, `viz/src/main.ts`, … — correct by definition
      and unaffected by the barrel problem.
- [x] Tests-as-documentation ranks substantial suites (`chrome.test.ts` 424
      lines, `drill-down.test.ts` 801). Out-degree does not concentrate in
      barrels, so neither category needed changing and neither was changed.

## 6. Invariants that had to survive

- [x] Determinism: `localeCompare` appears nowhere in this story's sources —
      the existing source-scan test still passes.
- [x] A genuine score tie is still exercised. The langgraph fixture's
      in-degree ties are separated by size under the new rule, so that
      coverage would have been lost silently; a fixture with two files scoring
      200 each (2 × 100 and 4 × 50) now covers it, including with nodes and
      edges reversed.
- [x] Three categories stay disjoint; empty states unchanged (5.5's
      conventions).
- [x] The barrel is **demoted, not hidden** — asserted, because a reader who
      wants to know what everything imports should still be able to see it.

## Left for a human

- [x] **AC-6: are these the five files you would hand a newcomer?** The
      measurements above say the list stopped being barrels; whether it is now
      *useful* is the maintainer's judgement and this box is his.
- [x] **Visual check of the panel in a browser.** Not run: no browser
      extension is connected here. What to check, and what I could establish
      without pixels: the row is a two-column grid, `1fr auto`, with the
      metric `white-space: nowrap` and the path `overflow: hidden` +
      `text-overflow: ellipsis` + `direction: rtl`. So a wider metric —
      `22 importers · 1,694 lines` is about 26 characters against the old
      `22 imports` — cannot overflow or wrap; it takes width from the path,
      which ellipsizes from the **left**, keeping the filename end. The
      basename is printed on its own line above and is unaffected.
      **What a human should judge:** whether the remaining path fragment is
      still enough to tell two same-named files apart (`chrome/panel.ts` vs
      `engine/panel.ts`) in a 320 px panel. If it is not, the fix is the
      layout, not the label — the two numbers are the point of the change.
- [x] **Screen-reader pass.** Each row's `aria-label` is authored as
      `<path>, <n> importers · <m> lines`; asserted structurally, never heard.
