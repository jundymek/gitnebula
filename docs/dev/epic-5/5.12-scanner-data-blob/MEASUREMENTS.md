# Measurements — one generated fixture swallows the whole map

Method, so a reviewer can reproduce every number:

```bash
pnpm install && pnpm build
node packages/cli/dist/bin/gitnebula.js --no-serve --no-open -o /tmp/map.json
```

Drawn radius is the engine's own formula, `base + √loc / 11` with
`base = 7` for modules and `1.5` for files
(`packages/viz/src/engine/graph.ts`, `constants.ts`). "Drawn area" is `r²`
summed over the nodes of that kind — the share is what a reader's eye is
actually spending on one disc. Machine: macOS 25.5, Node 22, this worktree.

## Before → after, this repository

| kind | metric | before | after |
| ---- | ------ | -----: | ----: |
| module | largest ÷ median drawn radius | **3.41×** | **2.60×** |
| module | largest ÷ median drawn **area** | 11.6× | 6.8× |
| module | share of all drawn module area held by the largest | **60.5%** | **47.2%** |
| module | layer of `packages/` | **`test`** | **`backend`** |
| module | loc of `packages/` | 79,068 | 38,544 |
| file | largest ÷ median drawn radius | **8.08×** | **2.14×** |
| file | largest ÷ median drawn **area** | 65.3× | 4.6× |
| file | share of all drawn file area held by the largest | **12.8%** | **1.0%** |
| file | largest node | `…/synthetic-100x2000.json`, 40,655 loc | `…/engine/engine.ts`, 1,694 loc |
| — | nodes in the document | 442 | 441 |

The file-level change is the one that matters most to the eye: the largest
file went from holding an eighth of all drawn file area to a hundredth, and
the biggest node on the map is now the biggest source file in the product.

The module-level residue is honest. `packages/` still holds 47.2% of drawn
module area after the fix, because gitnebula genuinely *is* mostly
`packages/` — 38,544 of its lines against 17,542 in `docs/`. What changed is
that the figure is now a fact about the source rather than about one fixture,
and the module is no longer labelled `test`.

## Why the other candidate was rejected — simulated, not argued

A radius cap at 4× the median radius of its kind, run against the same
document:

| kind | median r | cap at 4× | largest r | nodes clamped |
| ---- | -------: | --------: | --------: | ------------: |
| module | 9.55 | 38.22 | **32.56** | **0 of 6** |
| file | 2.45 | 9.81 | 19.83 | 1 of 436 |

**The cap does not bind on the module node at all.** The disc the maintainer
saw is the `packages/` module, at 3.41× the median — under any cap loose
enough to preserve genuine size differences between modules, it is drawn
exactly as before. And no view-side rule can address the second half of the
defect: `packages/` was labelled layer `test`, which is a claim about what
that code *is*, decided by a generated fixture under a `fixtures/` directory.

## Determinism (AD-4)

Two runs over the same tree serialize identically, blob and all — asserted in
`packages/scanner/src/analyze.test.ts`. The rule reads file contents and
nothing else: no clock, no RNG, no environment.

## The perf fixture still loads, and the harness still runs (AC-7)

`PERF_PORT=4317 pnpm --filter @gitnebula/viz perf` — **10 passed (1.4m)**, on
the 2,000-node fixture (2,100 nodes, 1440×797 CSS px at DPR 1):

| scenario | fps | floor | verdict |
| -------- | --: | ----: | ------- |
| b-frozen-pan-zoom | **119** | 55 | pass |
| c-unfold-pan | **89** | 55 | pass |

This was never at risk — `viz` loads the fixture from disk as a *document*,
while the rule changes what the scanner does with a *target repository's*
files — but it is the trap the delegation named, so it was executed rather
than reasoned about. The 792 `viz` unit tests that call
`loadContractFixture("synthetic-100x2000")` are green for the same reason.
