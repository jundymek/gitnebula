# Manual testing — 3.4 detail panel and view modes

Every step below was executed on 2026-08-13 in Chrome. Observed results are
recorded inline. Ticked boxes were run; unticked boxes state why not, or what
went wrong.

Two passes, because the branch was rebased onto story 3.3 mid-way:

1. **Against this repository's own `analysis.json`**, produced by the cli —
   the committed fixtures all carry `remoteUrl: null`, so the GitHub action
   (AC-3) cannot appear under any of them.
2. **Against the committed synthetic fixture** after the 3.3 rebase, to cover
   the two steps that needed unfold and search. The cli could not be re-run
   for this pass: the built `dist/gitnebula.js` aborts with
   `ENOENT … dist/web-tree-sitter.wasm`, a packaging gap in the merged Python
   deps work. Reported, not fixed here — it is another story's file, and the
   fixture covers what this pass needed.

## Setup

```bash
pnpm install
pnpm --filter @gitnebula/cli build
node packages/cli/dist/gitnebula.js . -o /tmp/analysis.json
GITNEBULA_FIXTURE=/tmp/analysis.json pnpm --filter @gitnebula/viz dev --port 3004
# open http://localhost:3004
```

- [x] The CLI writes a document with a real GitHub remote.
      → `remoteUrl: https://github.com/jundymek/gitnebula.git`,
      `defaultBranch: master`, 257 nodes.
- [x] The map loads and settles; the header shows the mode toggle in the slot
      2.5 left empty. → `structure` / `change heatmap` rendered left of
      `↻ replay`, `structure` pressed.

## AC-1 — the panel

- [x] Click the `docs/` module. The panel opens top-right with the mockup's
      layout. → name `docs/` + `HOT SPOT` badge, path `docs/`,
      `module · other`.
- [x] The metric rows read: files `56`, loc `6,754`, `churn 90d` `100%`,
      authors `1`, last change `29 minutes ago`, co-changes with
      `packages/ 9`. LOC is thousands-separated; the last-change row is
      relative, not an ISO timestamp.
- [x] The churn bar's width equals the churn row. → `style.width === "100%"`
      against a churn row of `100%`.
- [x] The selected node carries a light selection ring. → visible on `docs/`
      in the screenshot, and drawn at `radius + 5` by the 2.5 renderer.
- [x] The churn row names the document's own window, not a hardcoded 90.
      → this document's window is 90 days, so the row reads `churn 90d`; the
      synthetic fixture's 365-day window renders `churn 365d` in the unit
      tests.
- [x] A **file** node's panel. Re-run after rebasing onto 3.3, which made
      files selectable at all. Zoomed past 1.8× to unfold `mod-042/` on the
      synthetic fixture and clicked `file-03.ts` → heading `file-03.ts`
      (basename), path `mod-042/file-03.ts`, `file · infra`, files `—`, loc
      `225`, churn 365d `94%`, authors `1`, last change `10 months ago`,
      co-changes with `mod-042/file-16.ts 17 · mod-042/file-18.ts 3`, hot
      badge shown, selection ring on the node. Note the co-change partners
      are files, which is the AD-1 decision recorded in the story README.

## AC-2 — the inert description slot

- [x] The panel shows no description, no placeholder and no hint of one.
      → asserted in `panel.test.ts` by mounting with a description and
      checking both the text and the words `description|summary|coming
      soon|ai` are absent; visually confirmed there is no empty gap in the
      panel.

## AC-3 — GitHub link and isolate

- [x] `open on github` is present for this GitHub remote and points at the
      right page. → `href` =
      `https://github.com/jundymek/gitnebula/tree/master/docs`,
      `rel="noopener noreferrer"`, `target="_blank"`.
- [x] The action is **absent**, not disabled, when there is no GitHub remote.
      → serving a committed fixture (`remoteUrl: null`) renders no `#p-github`
      at all; same for a GitLab remote in the unit tests.
- [x] `isolate` dims everything outside the chain and the button reports its
      state. → the rest of the map dropped to the hover-dim level, `docs/`
      stayed full brightness, the button read `isolated` with
      `aria-pressed="true"`.
- [x] Toggling isolate off restores full opacity. → all six modules back to
      full brightness, button back to `isolate` / `aria-pressed="false"`.

## AC-4 — deselect and drag discrimination

- [x] A **drag** that starts on the selected node and ends over empty canvas
      does not deselect. → dragged (811,387) → (500,600); the panel stayed
      open on `docs/`.
- [x] A **click** on empty canvas closes the panel and clears isolate.
      → `#panel.hidden === true`, `#p-isolate` back to `aria-pressed="false"`.
- [x] The `×` closes the panel too. → covered in `chrome.test.ts`; it drives
      the same `setSelected(null)` path as the empty-canvas click.

## AC-5 — mode toggle

- [x] `change heatmap` recolours every node on the churn ramp.
      → low-churn modules went cold blue, `packages/` mid-ramp, `docs/` hot
      orange. `aria-pressed` moved to `mode-heat`.
- [x] The mode survives panel interactions. → selected, isolated, un-isolated
      and closed the panel while in heatmap; `mode-heat` stayed pressed
      throughout.
- [x] The mode survives unfold/collapse. Re-run after the 3.3 rebase: switched
      to heatmap, zoomed past 1.8× to unfold, zoomed back out to collapse —
      `mode-heat` stayed `aria-pressed="true"` and the ramp stayed applied to
      the file nodes as they appeared.
- [ ] **Search fly-to opens the panel — NOT satisfied end-to-end on this
      branch.** Activating a file result (Enter, ArrowDown+Enter, and a mouse
      click on the option all tried, on a fully settled map) starts a camera
      move that stops short of the file's 3.0× target, does not unfold the
      module, and emits no selection — so the panel does not open. The
      consumer half is verified working: a canvas click on the same fixture
      opens the panel immediately, and when the module is unfolded **by hand**
      afterwards, the pending selection lands and the panel opens on exactly
      the searched file. So this is the producing half — 3.3's fly-to arrival
      — not the panel. Reported to 3.3's author and to the supervisor with
      this evidence rather than patched here: the code is merged and belongs
      to another story's territory.

## Accessibility

- [x] The mode buttons are a labelled group with `aria-pressed` reflecting
      state. → `role="group"`, `aria-label="View mode"`.
- [x] The panel is `aria-live="polite"`, so a selection arriving from a search
      fly-to is announced.
- [x] The close button is labelled. → `aria-label="Close panel"`.
- [x] Closed means `hidden`, so the panel leaves the accessibility tree rather
      than merely going invisible.
- [ ] Screen-reader pass with VoiceOver. Not runnable headless; the attributes
      it depends on are asserted above and in the unit tests.

## Console

- [x] No console errors or exceptions during the whole session.
