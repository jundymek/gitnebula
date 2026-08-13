# 4.1 — the bundle's size budget

The performance property this story owns is ADR-0004's ceiling: **viewer assets
≤ 2 MB gzipped, data excluded**. Nothing here concerns frame rate or pipeline
runtime; those belong to stories 1.4 and 3.5, whose numbers are recorded in
their own folders.

## Method

Gzip level 9 over every file in `packages/viz/dist` except `analysis.json` —
level 9 because that is what a CDN or `gzip_static` serves, so the number is
the one a reader measuring it themselves would get.

Reproduce:

```bash
pnpm build
pnpm --filter @gitnebula/cli test          # prints the line below
# or, on any repository:
node packages/cli/dist/bin/gitnebula.js build -o .gitnebula-site
```

Machine: MacBook (darwin 25.5.0, arm64), Node 22.20.0, pnpm 10.34.5. The
measurement is a compression ratio over committed bytes, so it does not vary
with the machine — only with what the build emits.

## Measured

Units below are binary (1 KB = 1024 B), matching what the command prints.

| artefact                         |      raw |    gzipped | note                                  |
| -------------------------------- | -------: | ---------: | ------------------------------------- |
| `dist/index.html` (whole viewer) | 187.3 KB | **57.6 KB** | JS and CSS inlined; the entire bundle |
| ADR-0004 budget                  |        — |    2.00 MB | viewer assets, data excluded          |
| **headroom**                     |          | **97.2 %** | 57.6 KB is 2.8 % of the budget        |

For context, the same viewer before this story built as three files. Vite
reported them (in decimal kB) as `index.html` 0.39 kB + `index-*.css` 5.99 kB +
`index-*.js` 185.79 kB — 59.75 kB gzipped in total. Inlining lands at 57.6 KB:
slightly *smaller*, because one gzip stream over the whole document compresses
better than three separate ones, and two `<link>`/`<script>` references
disappear.

The data half, for completeness — not part of this budget, ADR-0005 bounds it:
gitnebula's own `analysis.json` is 183.2 KB raw at 310 nodes / 373 edges / 60
co-change pairs, against ADR-0004's 5 MB allowance for a 2,000-file repository.

## Verdict

**Within budget by a factor of 35.** The budget is doing its intended job as a
ceiling, not as a target: at this margin the thing it protects against is a
webfont, an inlined fixture, or a heavyweight dependency arriving in a later
story, and the gate fails the build the moment one does.

`gitnebula build` prints the measurement on every run and exits non-zero over
budget, so the number reaches a person without anyone remembering to look; the
cli test suite asserts the same thing while CI stays `workflow_dispatch`-only
(story 4.2 turns the triggers on).
