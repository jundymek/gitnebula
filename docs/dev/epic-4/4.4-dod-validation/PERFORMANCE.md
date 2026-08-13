# 4.4 — Performance record

This story measures three stated performance properties against their budgets:

| property | budget | source |
| -------- | ------ | ------ |
| `npx gitnebula` wall clock, per demo repo | ≤ 60 s | brief §10.1, SM-1 |
| sustained frame rate, 100-module / 2,000-file fixture | ≥ 55 fps (60 target) | FR-14, SM-2, ADR-0006 |
| viewer bundle, gzipped | ≤ 2 MB | ADR-0004, SM-C3 |

`analysis.json` size (≤ 5 MB, NFR) is a payload budget rather than a timing one
and is recorded here too, because it is the number that decides whether the
Viewer can hold the document at all.

The verdicts and the rest of the definition of done live in
[`docs/dod-report.md`](../../../dod-report.md); this file carries the method and
the raw numbers.

## Machine

Apple M4 Pro (12 cores), 48 GB, macOS 26.5.2 (25F84), Node 22.20.0,
pnpm 10.34.5, git 2.50.1. Browser numbers: Playwright 1.62.1 /
Chromium 151.0.7922.34, canvas 1440 × 845 CSS px, `devicePixelRatio` 1.

This is the same machine story 3.5 measured on, so the fps rows are directly
comparable with `docs/dev/epic-3/3.5-viz-export-perf/PERFORMANCE.md`.

## Pipeline runtime

### Method

- Three demo repos, each a **full clone pinned to a SHA** (churn needs history),
  **with nothing installed** — no `npm install`, no `pip install`. That is the
  harder case and the one `npx gitnebula` actually meets on a fresh checkout;
  stories 2.2 and 3.1 measured the same way.
- One discarded warm-up run per repo, then **three measured runs; the median is
  reported**. The spread across the three runs was ≤ 0.05 s everywhere, so the
  median is not hiding a distribution.
- `--no-serve`, so the number is the pipeline rather than the browser launch.
- **Clone time is not included**: SM-1 is about analysing a repository you have,
  and cloning is network time the brief does not own. The clone SHAs are in the
  report so the measurement is reproducible.

```bash
node packages/cli/dist/gitnebula.js <repo> --no-serve -o <out>.json
```

### Numbers

| repo | files | LOC | commits in window | run 1 | run 2 | run 3 | **median** | budget |
| ---- | ----- | --- | ----------------- | ----- | ----- | ----- | ---------- | ------ |
| fastapi | 2,892 | 257,184 | 531 | 1.19 s | 1.19 s | 1.18 s | **1.19 s** | 60 s |
| excalidraw | 930 | 245,523 | 78 | 0.95 s | 0.95 s | 0.96 s | **0.95 s** | 60 s |
| streamlit | 2,516 | 548,971 | 646 | 2.64 s | 2.69 s | 2.69 s | **2.69 s** | 60 s |

The tightest margin is streamlit's, at **22× under budget**.

Stage split on the slowest repo (streamlit, from the CLI's own progress output;
`deps` and `githist` run concurrently, so the stage times do not sum to the
total): repo 0.03 s, config 0.00 s, scan 0.45 s, githist 0.30 s, **deps
2.08 s**, assemble 0.01 s, enrich 0.00 s, emit 0.01 s — pipeline total 2.57 s.
Import parsing dominates, which is where the 2,516-file universe and 6,608
specifiers land.

### `analysis.json` size

| repo | bytes | MiB | budget |
| ---- | ----- | --- | ------ |
| fastapi | 1,382,724 | 1.32 | 5 MB |
| excalidraw | 985,392 | 0.94 | 5 MB |
| streamlit | 2,266,414 | 2.16 | 5 MB |

Streamlit is the largest at 2.16 MiB — 43% of the budget, on the largest repo
of the three by both file count and LOC.

## Frame rate

The story 3.5 harness, unchanged, on story 1.3's committed
100-module / 2,000-file fixture:

```bash
PERF_PORT=4331 pnpm --filter @gitnebula/viz perf                 # headless
PERF_HEADED=1 PERF_PORT=4331 pnpm --filter @gitnebula/viz exec \
  playwright test -c perf/playwright.config.ts fps               # real display
```

Sustained fps is the lowest frame count in any sliding 1-second window — the
definition stories 1.4 and 3.5 used, so the numbers stay comparable. The run
declares itself valid before any number is read (page never hidden, fixture is
the yardstick, layout reached Settled) and counts renders as well as frames.

| configuration | phase | sustained fps | avg | median frame | p95 | worst frame | floor |
| ------------- | ----- | ------------- | --- | ------------ | --- | ----------- | ----- |
| headless | b-frozen-pan-zoom | **119** | 120.0 | 8.3 ms | 9.1 ms | 9.4 ms | 55 |
| headless | c-unfold-pan | **82** | 116.4 | 8.3 ms | 9.3 ms | 24.6 ms | 55 |
| headed (60 Hz display) | b-frozen-pan-zoom | **59** | 59.9 | 16.7 ms | 17.5 ms | 17.7 ms | 55 |
| headed (60 Hz display) | c-unfold-pan | **59** | 60.0 | 16.7 ms | 17.5 ms | 17.7 ms | 55 |

Settle: 148 frames / 1,241.8 ms headless, 148 frames / 2,602.2 ms headed. Only
the headed figure is comparable to story 2.5's 2–3 s acceptance criterion, and
it satisfies it.

**The headed number is the one the product claim rests on**: 59 is the vsync
ceiling of a 60 Hz display, not a shortfall. Every row clears the 55 fps floor;
the headed margin is 1.07× and the headless worst case 1.49×.

These figures reproduce story 3.5's record (119 / 81–85 headless, 59 headed) on
the same machine, three stories later. That the map has not regressed while
epic 3 added navigation, panel modes, search and export is itself the result
worth recording.

## Viewer bundle size

Measured from `pnpm build`'s Vite output on this branch:

| asset | raw | gzip |
| ----- | --- | ---- |
| `index.html` | 0.39 kB | 0.26 kB |
| `assets/index-*.css` | 5.99 kB | 1.74 kB |
| `assets/index-*.js` | 185.79 kB | 57.75 kB |
| **total** | **192.17 kB** | **59.75 kB** |

**59.75 kB gzipped against a 2 MB budget — 3.0% of it, a 33× margin.**

The single-file bundle story 4.1 produces inlines these same assets into one
`index.html`; inlining moves bytes between files without adding any, and base64
inlining is not used for JS or CSS, so the gzipped total does not materially
change. The report records 4.1's own CI-printed gzip number as the binding one
when that branch merges.

## What is not measured here

- **DPR-2 (Retina)**: the harness pins `deviceScaleFactor: 1` so runs stay
  comparable. Story 3.5 flagged the gap and it is still open; at DPR 2 the
  renderer rasterises 4× the pixels.
- **Cold `npx` from the registry**: the package is unpublished, so the closest
  honest proxy is story 4.1's `npm pack` + cold-install test. Registry download
  time is network time and is outside SM-1 by the same rule that excludes clone
  time.
- **A 120 Hz display**: story 3.5's finding — that unfold is free at 60 Hz and
  costs real headroom at 120 — is unchanged and untested here.
