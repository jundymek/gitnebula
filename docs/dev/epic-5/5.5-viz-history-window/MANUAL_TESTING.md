# Manual testing — 5.5 analysis window made legible

Steps marked `- [x]` were **executed** on this branch and their observed result
is recorded inline. Steps left `- [ ]` could not be run in this environment and
say why; they are for the owner.

## Setup (executed)

The repository's own deterministic fixture supplies a repo whose history
(2024–2025) falls outside a default window measured from the 2026-01-01
anchor — the real-world case in miniature.

```sh
sh test-fixtures/build-fixture-repo.sh
pnpm build

# 1. zero-history: window 90d, nothing inside it
node packages/cli/dist/bin/gitnebula.js build test-fixtures/.generated/history-repo \
  --window-anchor 2026-01-01T00:00:00Z --out /tmp/bundle-zero

# 2. mixed: window 400d — most nodes have history, legacy/old.ts does not
node packages/cli/dist/bin/gitnebula.js build test-fixtures/.generated/history-repo \
  --window-days 400 --window-anchor 2026-01-01T00:00:00Z --out /tmp/bundle-mixed

# 3. full history: window 1000d — every node has history
node packages/cli/dist/bin/gitnebula.js build test-fixtures/.generated/history-repo \
  --window-days 1000 --window-anchor 2026-01-01T00:00:00Z --out /tmp/bundle-hist
```

- [x] **All three bundles build.** Observed: each wrote `index.html` +
      `analysis.json`; viewer assets 60.1 KB gzipped of the 2.00 MB budget
      (2.9%).
- [x] **The zero-history case is real, not contrived.** Observed on bundle 1:
      `repo.stats.commits: 0`, and all 6 nodes `churn 0`, `commits 0`,
      `lastChangedAt: null`. This is a healthy repository that the old panel
      would have rendered as six bare zeroes.
- [x] **The mixed case isolates AC-2.** Observed on bundle 2: repo has 5
      commits; `core/` and `web/` carry real churn and timestamps;
      `legacy/old.ts` and `legacy/` are `churn 0`, `lastChangedAt: null`.

## AC-5 — the terminal summary names its window (executed)

```sh
node packages/cli/dist/bin/gitnebula.js test-fixtures/.generated/history-repo \
  --no-serve --window-anchor 2026-01-01T00:00:00Z --out /tmp/a.json
node packages/cli/dist/bin/gitnebula.js test-fixtures/.generated/history-repo \
  --no-serve --window-days 30 --window-anchor 2026-01-01T00:00:00Z --out /tmp/b.json
```

- [x] **Default run states the window.** Observed:
      `… 6 nodes, 0 edges, 0 co-change pairs, history over the last 90 days (--window-days), in 0.07s`
- [x] **`--window-days 30` is reflected in the wording.** Observed the same
      line with `history over the last 30 days`. The value follows the flag;
      nothing is hardcoded.
- [x] **The cli suite passes unchanged.** Observed 145 passed, 15 files. No
      cli test asserts the summary line, so the wording change breaks nothing.

## Panel behaviour, rendered against real pipeline output (executed)

Rendered through jsdom using the shipped `renderPanel` / `renderLegend`
against the three `analysis.json` files produced above — real pipeline output,
not fixtures.

- [x] **AC-1 — the caption names the document's window, at three different
      windows.** Observed `history · last 400 days`, `history · last 90 days`
      and `history · last 1000 days` on bundles 2, 1 and 3 respectively, with
      the churn row reading `churn 400d` / `churn 90d` / `churn 1000d`. No
      value appeared that was not the document's own.
- [x] **AC-1 — only the history rows are grouped.** Observed `files` and `loc`
      outside the group; `churn`, `authors`, `last change`, `co-changes with`
      inside it.
- [x] **AC-2 — an out-of-window node reads as quiet, and is marked.** Observed
      on `legacy/old.ts` (bundle 2): `last change → no change in last 400 days`
      carrying `[EMPTY]` (the `is-empty` class), while `core/scoring.py` in the
      same document showed `last change → 6 months ago` with no marker. The two
      are distinguishable without reading the words.
- [x] **AC-2 — the exit is offered.** Observed notice
      `[node-out-of-window]: no change in last 400 days · re-run with
      --window-days to look further back than 400 days`.
- [x] **AC-3 — a zero-history repository states its case once, in repository
      terms.** Observed on bundle 1: notice `[repo-zero-history]: no commits in
      the last 90 days · re-run with --window-days …`. The per-node sentence
      did **not** also appear as a second notice.
- [x] **AC-4 — the near-uniform heatmap says so, in heat mode only.** Observed
      on bundle 1: heat mode → `3 of 3 files unchanged in the last 90 days ·
      re-run with --window-days …`; structure mode → hidden. On bundles 2 and 3
      the notice was **absent entirely** (not merely hidden), which is correct:
      those repositories are not mostly cold.
- [x] **No notice on a healthy repository.** Observed on bundle 3: no panel
      notice, no empty rows, no legend notice.

## Automated verification (executed)

- [x] `pnpm lint` — exit 0 (eslint + prettier).
- [x] `pnpm --filter @gitnebula/viz test` — 455 passed, 37 files.
- [x] `pnpm --filter gitnebula test` — 145 passed, 15 files. **Note:** the
      spec's command `pnpm --filter @gitnebula/cli test` matches no project and
      exits 0 without running anything; the package is named `gitnebula`.
- [x] `pnpm build` — viz + cli both build.
- [x] **New assertions were watched fail.** Hardcoding the caption to 90,
      reverting the empty-state copy to the em dash and dropping the legend's
      mode check produced 6 failures across 3 files; restored, all 455 pass.
- [x] `chrome/boundary.test.ts` byte-unchanged and passing (AC-6).

## For the owner — not executable here

- [ ] **Visual check in a real browser** — palette, spacing, and that the
      history caption reads as a group heading rather than as another metric
      row. *Not run: the Chrome extension is not connected in this environment,
      so no real browser was available. jsdom confirms structure and copy but
      renders no pixels.* Serve any bundle above with a static server, click a
      node, and compare against `reference/mockup.html`.
- [ ] **The `is-empty` row is distinguishable at a glance** — the class pairs
      a muted colour with italics so the distinction survives greyscale and
      colour-vision deficiency. *Not run: needs human visual judgement.*
- [ ] **Screen-reader pass** — confirm that reaching any history metric
      announces the group label `history · last N days`. *Not run: no screen
      reader in this environment.* The `role="group"` + `aria-label` are
      asserted by `panel.test.ts`; only the announcement itself is unverified.
- [ ] **The legend notice does not collide with the layer keys on a narrow
      window** — it is capped at `30ch` with a rule above it. *Not run: needs a
      real viewport.*
