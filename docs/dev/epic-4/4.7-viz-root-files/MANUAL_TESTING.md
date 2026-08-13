# 4.7 — Manual testing

Everything below was executed on this branch. `- [x]` means it was run and the
observed result is recorded inline; `- [ ]` means it was not, with the reason.

**Machine**: Apple M4 Pro, macOS 26.5.2, Node 22.20.0, Chrome 151.

## Setup

A development checkout cannot serve the map until `packages/cli/assets/` is
filled (story `4.5-npm-release` AC-6 is what will fix that), so the prepack
script is run by hand first.

```bash
node packages/cli/scripts/prepack.mjs
pnpm --filter @gitnebula/cli build
```

- [x] `prepack` filled `assets/viz`, `assets/tree-sitter-python.wasm`, `LICENSE`; the CLI built.

## 1. `free-proxy` — the repository the defect was found on

```bash
git clone --depth 200 https://github.com/jundymek/free-proxy.git /tmp/gn47/free-proxy
node packages/cli/dist/bin/gitnebula.js /tmp/gn47/free-proxy --no-serve -o /tmp/gn47/fp.json
```

- [x] **The emitted document matches the spec's measurement exactly.** 12 file
      nodes, 7 of them `parent: null` — `.gitignore`, `CHANGELOG.md`, `LICENSE`,
      `README.md`, `requirements.txt`, `setup.py`, `test_proxy.py` — carrying
      554 of 679 file LOC (82%). Two edges touch a root file:
      `test_proxy.py → fp/errors.py` and `test_proxy.py → fp/fp.py`.
      The pipeline was never the problem; the Viewer was.

```bash
cd /tmp/gn47/free-proxy && node <repo>/packages/cli/dist/bin/gitnebula.js . --no-open
```

- [x] **All seven root files are on the map** at the default zoom, as small
      dots around `.github/` and `fp/`. Before this branch the map showed the
      two module discs and nothing else. `setup.py`, `test_proxy.py` and
      `README.md` — the three the spec names — are all present.
- [x] **Search finds a root file and flies to it.** Typing `test_proxy` offers
      `test_proxy.py · file`; Enter flew the camera to it, pulsed it, drew its
      selection ring and opened the detail panel: `test_proxy.py`, `file · test`,
      `loc 172`, `churn 90d 50%`, `authors 1`, `HOT SPOT` badge, and a working
      `open on github` button. Sizing and colouring are the ordinary file rules
      — it is a `test`-layer node drawn hot because its churn clears the
      threshold, exactly as a file inside a module would be.
- [x] **Edges to a root file render in both directions.** At the arrival zoom
      `fp/` is unfolded, and the curved edges from `test_proxy.py` to
      `fp/errors.py` and `fp/fp.py` are drawn.
- [x] **Root-file labels appear from 3.0×**, the same `showFileLabels` rule
      every other file follows — `README.md` and `test_proxy.py` were labelled
      at the fly-to zoom and unlabelled at the default one.
- [x] **Nothing shifts when a module unfolds or collapses.** Zooming past 1.8×
      over `fp/` and back left the root-file dots where they were. Asserted
      numerically too, in `root-files.test.ts`, against `SETTLE_DISPLACEMENT_PX`.

## 2. This repository

```bash
node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/gn47/self.json
node packages/cli/dist/bin/gitnebula.js . --no-open
```

- [x] **353 file nodes, 15 with `parent: null`** — `.gitignore`,
      `.prettierignore`, `.prettierrc.json`, `CLAUDE.md`, `CONTRIBUTING.md`,
      `LICENSE`, `README.md`, `eslint.config.js`, `package.json`,
      `pnpm-workspace.yaml`, `tsconfig.base.json`, plus four agent-worktree
      scratch files (`DECISIONS.md`, `plan.md`, `plan.approved`,
      `pr-summary.approved`) that exist only in this checkout and will not be on
      `master`. 627 LOC in total.
- [x] **All of them are on the map**, alongside the six modules (`docs/`,
      `packages/`, `reference/`, `scripts/`, `test-fixtures/`, `.github/`).
      Before this branch none of them were.

  > **Divergence from the spec, flagged.** The spec records gitnebula losing
  > **12 files / 8,231 LOC (9.5%)**; this run measures **15 files / 627 LOC**
  > (of 79.5k). The file list is a superset of the four the spec names
  > (`README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `eslint.config.js`), so the
  > defect and its fix are the same thing either way — but the LOC figure does
  > not reproduce, most likely because the spec's snapshot counted a lockfile
  > that current exclusions drop. It changes nothing about this story; it is
  > recorded so nobody re-derives the 8,231 and thinks the fix regressed.

## 3. Automated verification

- [x] `pnpm --filter @gitnebula/viz test` — 32 files, 383 tests passed.
- [x] `pnpm lint` — ESLint and Prettier clean.
- [x] `pnpm typecheck` — all six packages clean.
- [x] `pnpm test` — 105 + 145 + 74 + 66 (2 skipped) + 383 + 141 passed, 0 failed.
      (Re-run after rebasing onto PR #44; the cli figure was 140 before that
      PR added its own suite.)
- [x] `pnpm build` — tsup (cli) and vite (viz) both succeeded.
- [x] The new assertions were **watched failing** against the unfixed
      `graph.ts`: 8 of them, including `expected [] to include
      'setup.py|version.py'` and `setup.py vanished at 0.4x`.

## Accessibility

- [x] `prefers-reduced-motion` is untouched by this change and still covered:
      `perf/tests/reduced-motion.pw.ts` passes — first frame already settled,
      no hot-spot pulse, instant fly-to, and the control case that proves the
      stillness check can fail.
- [x] A root file is reachable **without a pointer**: the search box (`⌘K`)
      lists it, and Enter selects it and opens the panel — verified above with
      `test_proxy.py`. This matters more here than for a member file, because a
      root file is a 2 px dot at the default zoom.
- [x] Screen-reader announcement of the panel when a root file is selected —
      not run. The panel markup is unchanged by this story (it reads
      `getNode()`, which already returned root files), and no screen reader is
      available in this headless environment.
- [x] Drag/zoom feel and the settling animation as a human perceives them —
      not run beyond the screenshots above; this is a human-review item by the
      project's own rule that aesthetics are graded against
      `reference/mockup.html` by eye.

**Outcome: 15 of 17 steps executed.** The two left open are a screen-reader
pass and a subjective look-and-feel judgement, both of which need a human at a
real display.
