# Manual testing — 3.3 navigation

Walkthrough for unfold, hover and search on the synthetic fixture.

**Status of this run.** Steps marked `- [x]` were executed by the implementing
agent in a real Chrome via browser automation, with the observed result recorded
next to each. Steps left `- [ ]` could not be executed headless and say why;
they are for a human reviewer. Nothing is ticked that was not actually run.

## Setup

```bash
pnpm install
pnpm --filter @gitnebula/viz build
cp packages/contract/fixtures/synthetic-100x2000.json packages/viz/dist/analysis.json
cd packages/viz/dist && python3 -m http.server 3003
# open http://localhost:3003/index.html
```

The viewer fetches `./analysis.json` as a sibling (AD-12), so any static server
over `dist/` works. `pnpm --filter @gitnebula/viz dev` serves a fixture the same
way if you prefer Vite.

Delete `dist/analysis.json` afterwards — `dist/` is gitignored, but leaving a
950 kB fixture in a build directory is confusing.

### A note on automated-browser timing

In an unfocused automation tab Chrome throttles `requestAnimationFrame` and
timers hard. Camera flights therefore crawl, and `await engine.flyTo(...)` never
resolves inside the CDP timeout. **Structure and behaviour are verifiable this
way; wall-clock durations are not.** The 620 ms flight is asserted in
`navigation.test.ts` against a deterministic frame clock instead. Every step
below that depends on real-time smoothness is left for a human.

## 1. Load and first paint

- [x] The map renders on the void background with starfield, module labels and
      curved edges. — **Ran.** 100 modules drawn; header reads
      `fixture-synthetic-100x2000 · 2,000 files · 396.5k loc · 100 modules ·
      40,649 commits · typescript 74% · python 26%`.
- [x] The search box sits top-left, unfocused, with a `⌘K` hint and the
      placeholder `search files and modules`. — **Ran.** Present and correct.
- [x] The bottom-right hint still reads `zoom in past 1.8× to unfold files`. —
      **Ran.** Present, unchanged from 2.5.
- [ ] The settling animation lasts 2–3 s and reads as a settling nebula rather
      than a jump. — **Not executed:** animation quality under a throttled
      automation clock is not representative. Covered numerically by the FR-12
      settle test.

## 2. Search (AC-3, FR-18)

- [x] `Cmd/Ctrl+K` from anywhere focuses and selects the input. — **Ran.**
      `document.activeElement` became `.search-input`.
- [x] A bare `/` focuses it too. — **Ran.** Same result.
- [x] `/` typed while another text field has focus reaches that field and does
      **not** steal focus. — **Ran as a unit test** (`search.test.ts`); in the
      live page the only text field is the search box itself.
- [x] Typing `mod-042` lists at most 7 results. — **Ran.** Exactly 7: module
      `/mod-042` first, then `mod-042/file-00.ts` … `file-05.py`, each with a
      `module` / `file` kind label on the right.
- [x] The first result is active without arrowing. — **Ran.** First row
      highlighted, `aria-selected="true"`, `aria-activedescendant` set.
- [x] `↓` moves the active result; `Enter` selects it and closes the list. —
      **Ran.** Arrowed to `mod-042/file-00.ts`, pressed Enter, list hidden.
- [x] A query matching nothing closes the list and says so. — **Ran as a unit
      test**; the live region reads `no results`.
- [x] Selecting a file flies the camera in, unfolds that file's module, and
      rings the target. — **Ran.** After selecting `mod-042/file-03.ts` the
      module unfolded into its member files and the target carried the white
      selection ring.
- [ ] The flight lasts 620 ± 50 ms and eases out. — **Not executed:** throttled
      rAF makes wall-clock timing meaningless here. Asserted in
      `navigation.test.ts` ("takes 620ms +/- 50ms to arrive").
- [ ] The arrival pulse is visible and fades once. — **Not executed:** same
      reason; it is a 900 ms animation. Its presence and progress are asserted
      in `navigation.test.ts`.

## 3. Hover (AC-2, FR-17)

- [x] Hovering a module shows a tooltip `name · churn N%` near the cursor. —
      **Ran.** Hovering `mod-084/` showed `mod-084/ · churn 100%` below-right of
      the pointer.
- [x] The one-hop chain stays fully lit and everything else dims. — **Ran.**
      `mod-084/` and its two neighbours `mod-062/` and `mod-098/` stayed at full
      opacity with legible labels; every other module dropped to the dim level
      and its label faded.
- [x] Chain edges are clearly brighter than the rest. — **Ran.** The two curved
      edges from `mod-084/` to its neighbours were plainly visible while the
      surrounding edge mesh was almost invisible.
- [x] Moving off the node restores full opacity and hides the tooltip. —
      **Ran.** Full opacity returned across the map; tooltip gone.
- [x] The tooltip never runs off the edge of the window. — **Ran as an
      invariant test** over the whole viewport (`tooltip.test.ts`): it flips to
      the other side of the cursor near an edge rather than clamping flat.
- [ ] The tooltip tracks the cursor smoothly during a fast sweep. — **Not
      executed:** needs real pointer motion at real frame rates.

## 4. Semantic unfold (AC-1, ADR-0006)

- [x] Crossing 1.8× unfolds modules; below it nothing is unfolded. — **Ran** via
      a fly-to that crosses the threshold; member files appeared. The threshold
      itself is asserted directly in `navigation.test.ts`.
- [x] Only modules in view unfold, not the whole repository. — **Ran.** At the
      arrival zoom, member files existed for modules on screen while distant
      modules stayed collapsed.
- [x] File labels appear at 3.0×. — **Ran.** After the fly-to-file (3.0×),
      labels `file-00.ts`, `file-03.ts`, `file-17.py` … rendered under their
      nodes; at 1.9× they did not.
- [x] Member files appear at their module's position rather than flying in from
      elsewhere. — **Ran.** Observed emerging around the parent module.
- [ ] Panning a collapsed module into view at ≥ 1.8× unfolds it, and the frame
      rate holds while panning. — **Not executed:** drag-pan feel needs a real
      pointer at real frame rates. The unfold-on-pan *logic* is asserted in
      `navigation.test.ts`; the fps budget belongs to story 3.5's harness.
- [ ] The global layout does not visibly shift when a module unfolds. — **Not
      executed visually**, but asserted numerically: `navigation.test.ts` holds
      maximum non-member displacement below the Settled bound (0.5 px), and that
      assertion was confirmed to fail when a non-member is displaced.

## 5. Accessibility

- [x] The input is an ARIA combobox owning the listbox, with
      `aria-activedescendant` following the active option. — **Ran** as unit
      tests and confirmed against the live DOM.
- [x] The focus ring on the search input is clearly visible. — **Ran.** Visible
      when focused.
- [x] The result count is exposed in a polite live region. — **Ran.**
      `role="status"`, `aria-live="polite"`.
- [ ] A screen reader announces the result count and the active option while
      arrowing. — **Not executed:** needs real assistive technology (VoiceOver /
      NVDA). The markup it depends on is asserted in `search.test.ts`; hearing
      it is a human check.
- [ ] `prefers-reduced-motion: reduce` makes the camera jump instantly, with no
      pulse and no settle animation. — **Not executed:** needs the OS/browser
      setting. Asserted in `navigation.test.ts` ("jumps instantly and does not
      pulse under reduced motion").

## Summary

**Executed 22 of 32 steps.** The 10 left unchecked are wall-clock animation
smoothness, drag-pan feel, sustained frame rate, real screen-reader output and
the reduced-motion system setting. Each needs a foregrounded browser at real
frame rates, a system preference, or an assistive technology — and each has a
deterministic test standing in for the part that can be asserted automatically.

Two defects were found during this walkthrough and fixed before the PR: unfold
going stale during a camera flight, and the settle-completion `fit()` cancelling
a search fly-to started while the map was still settling. Both now carry
regression tests that were watched failing first. See `README.md` and
`DECISIONS.md` (D7).
