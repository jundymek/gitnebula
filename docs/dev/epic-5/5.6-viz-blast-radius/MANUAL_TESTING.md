# Manual testing — 5.6 blast radius from co-change

Every step below that can be executed headless **was executed** on this branch
before the PR was opened, and the observed result is recorded inline. Steps
needing a real browser are left unticked with the reason stated — this
environment has no browser extension connected, so nobody looked at the pixels.

Environment: macOS, Node 20, `pnpm --filter @gitnebula/viz test`, CLI built from
this branch (`pnpm build`).

## Automated baseline

- [x] `pnpm lint` — exit 0, ESLint and Prettier clean.
- [x] `pnpm -r typecheck` — exit 0 across all five packages. Added to this list
      after a Codex review caught a fixture in the new test file missing the
      contract's `descriptionSource`: `vitest` does not typecheck, so lint,
      test and build were all green while `tsc --noEmit` was not. Fixed, and
      the whole workspace now type-checks.
- [x] `pnpm test` (viz) — **666 passed, 47 files**, up from 620/45 on the base.
- [x] `pnpm build` — tsup + vite succeed; `dist/bin/gitnebula.js` 425.73 KB.
- [x] Both central assertions watched failing before being relied on:
      removing the `setLineDash` call turned the two dash tests red; making
      `buildScene` push edges between marked partners turned
      *"adds no edge to the scene, and removes none"* red. Both restored.

## 1. The section on a real repository (AC-1, AC-6 evidence)

- [x] `gitnebula . --no-serve -o self.json` on this repository.
      **Observed:** 384 nodes, 468 edges, **159 co-change pairs**, 90-day window.
- [x] Feed the real document to `buildPanelModel` and read the section for
      `packages/viz/src/chrome/chrome.ts`.
      **Observed:**
      ```
      blast radius · files · last 90 days
         packages/viz/src/styles.css                      9
         docs/implementation-artifacts/sprint-status.yaml  8
         packages/viz/src/engine/engine.ts                 8
         packages/viz/src/chrome/chrome.test.ts            6
         packages/viz/src/chrome/store.ts                  6
      ```
- [x] Confirm the list is not something the import graph already said.
      **Observed:** of the 44 co-change partners of
      `docs/implementation-artifacts/sprint-status.yaml`, **0** are import
      neighbours — a `.yaml` file imports nothing and is imported by nothing.
      The `chrome.ts` ↔ `styles.css` pairing (9 of 83 commits) is likewise
      invisible to `deps`: a stylesheet is not an import edge. This is the
      concrete evidence for AC-6, which stays a human-review item below.
- [x] Ordering is count-descending, ties by id — asserted over a fixture and
      visible in the run above.

## 2. The empty state, both of its causes (AC-3)

- [x] A node in no pair. **Observed** for
      `packages/viz/src/engine/prng.ts` and `packages/contract/src/validate.ts`:
      ```
      nothing changed with it in 3 or more commits of the last 90 days
      re-run with --window-days to look further back than 90 days
      ```
- [x] It is the majority case, not an edge case.
      **Observed:** **330 of 384** nodes in this repository's map appear in no
      pair (86%). The spec's langgraph measurement was 610 of 662 (92%).
- [x] The window is never hardcoded. Re-run at `--window-days 14` in the suite:
      copy reads `last 14 days` and the string `365` appears nowhere in it.
- [x] The `--window-days` exit is real, not decorative. Run on an older
      repository (`~/dev/fakerfill`, first commit 2025-10-04):
      | window | commits in window | pairs | nodes in a pair |
      | --- | --- | --- | --- |
      | 90 | 0 | 0 | 0 of 842 |
      | 730 | 179 | 231 | 89 of 842 |
      Widening the window turns an empty blast radius into 231 pairs. The exit
      the copy offers does what it says.
- [x] A repository quiet inside the window states its cause **once**.
      **Observed** on `fakerfill` at `--window-days 90`:
      ```
      suppressed: true
      panel notice: repo-zero-history | no commits in the last 90 days
      ```
      The section renders nothing; the panel-level notice from story 5.5 speaks
      for it. Asserted in the suite too: exactly one `.p-notice` in the panel.

## 3. A long partner list stays usable

- [x] Every partner is rendered — no silent top-N. Asserted over a 40-partner
      document; a cap the reader cannot detect would be a truncation, not a
      design.
- [x] The list is bounded and scrolls, and the panel cannot outgrow the window.
      **This was a real defect, found in review, not by me.** `body` is
      `overflow: hidden` and the panel had no height bound, so the file
      measured above with **44 partners** — at ~23 px a row, over 1,000 px of
      list — pushed `show on map` and the panel's own actions below the fold
      where they could not be reached at all. Before this story the panel's
      height was a fixed row count, so this was mine to introduce and mine to
      fix. Both the list and the panel now carry the bound story 5.1's
      start-here panel already used, and a test asserts the stylesheet keeps
      them; that test was watched failing with the cap removed.
- [ ] **Scrolling felt in a browser.** Not run, same reason as below: no
      pixels were rendered here. The assertion above is over the stylesheet
      text, which is strictly weaker than seeing it scroll.

## 4. Level disambiguation (AC-5)

- [x] Over a fixture carrying both levels: a module gets only module partners,
      a file gets only file partners, and a file never shows its module's pair.
      The caption names the level (`blast radius · files · …` /
      `· modules ·`), so the reader is not left inferring it.

## 5. Navigation (AC-2)

- [x] Clicking a partner row calls `onSelectPartner` with that partner's id and
      does nothing else itself; chrome answers with the existing
      `engine.flyTo(id)`, which selects on arrival. Asserted in
      `blast-radius.test.ts`.
- [x] `chrome/boundary.test.ts` passes **unchanged** — no chrome file names a
      canvas, a 2D context or an engine internal.

## 6. The map mark (AC-4)

- [x] A marked node draws a dashed ring; an unmarked node draws nothing extra.
- [x] The ring sits at +9 px, outside both the selection ring (+5) and the
      chain ring (+3), so the three marks never coincide.
- [x] The dash pattern is restored immediately, so nothing else in the frame is
      drawn dashed.
- [x] The colour is in neither `LAYER_COLOR` nor `HOT_COLOR`.
- [x] **No edge is added and none removed** when a set is marked; nodes,
      positions, chain, chain mode, selection, camera and mode are all
      unchanged. This is the assertion that holds the story's central claim.
- [x] Marking survives nothing it should not: a new document clears the set, a
      stale id marks less rather than throwing, and the engine keeps its own
      copy of the caller's array.

## 7. End-to-end through the shipped bundle

- [x] `gitnebula . --no-open` serves on `127.0.0.1:4141`; `analysis.json` is
      served with its 159 pairs.
- [x] The served bundle carries the feature, not just the source tree —
      counted in the served HTML: `p-blast-row` ×5, `p-blast-show` ×4,
      `show on map` ×2, `blast radius` ×1, the empty-state copy ×1,
      `setLineDash` ×2, `#ff5fa2` ×2, `--cochange` ×5.

## Left for a human

- [ ] **Visual check of the mark in a browser.** Not run: no browser extension
      is connected in this environment, so nothing was rendered to pixels. What
      to check: select a busy node (`packages/viz/src/chrome/chrome.ts` on this
      repo), press `show on map`, and confirm the dashed magenta rings are
      legible against the layer colours, are distinguishable from the solid
      selection ring at a glance, and do not read as lines or edges. Then hover
      a node to bring up a dependency chain at the same time and confirm the two
      encodings can be told apart.
- [ ] **AC-6 (human-review): on a real repository, the blast-radius section
      tells the maintainer something the import graph did not.** The measurement
      supporting it is in step 1 above — `chrome.ts` ↔ `styles.css`, 9 shared
      commits, zero import edges — but whether that is *useful to the
      maintainer* is the maintainer's call, and this box is theirs to tick.
- [ ] **Keyboard and screen-reader pass.** The partner rows are buttons in tab
      order with a `focus-visible` outline, the count is in each row's
      `aria-label`, and the section is named by its caption via
      `aria-labelledby` — all asserted structurally, none of it heard through
      an actual screen reader.
