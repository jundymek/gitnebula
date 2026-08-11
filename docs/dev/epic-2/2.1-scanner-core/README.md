# 2.1 — Scanner core: tree, LOC, languages, modules, layers

`@gitnebula/scanner` now implements FR-9: it walks a repository, applies the
exclusion globs, measures every surviving file, classifies it, derives the
module structure, and returns the `ScanResult` that is the closed universe
every later pipeline stage works from (AD-13).

## The surface

```ts
import { analyze, DEFAULT_EXCLUDES, LAYER_RULES } from "@gitnebula/scanner";

analyze(input: ScanInput, config: Config, onProgress?: ScanProgress): Promise<ScanResult>
```

- `ScanInput` is `{ root: string }` — the absolute repository root. It is not
  part of `Config` because node paths are repository-relative and the root is a
  property of the run, not of the analysis.
- `config.excludes` and `config.layers` arrive already resolved by cli (AD-3).
  The scanner reads no config file, no environment, no clock and no network.
- `onProgress(done, total)` fires once per file over the measurement pass. The
  directory walk runs first precisely so `total` is honest before the expensive
  pass starts.
- Per-item failures never throw (AD-7). Warning codes emitted:
  `symlink-skipped`, `irregular-file-skipped`, `unreadable-directory`,
  `unreadable-file`, `binary-file`. Directory entries whose type the filesystem
  will not report (`DT_UNKNOWN`, seen on FUSE and some network mounts) are
  resolved with `lstat` rather than written off as irregular.

`DEFAULT_EXCLUDES` and `LAYER_RULES` are exported as **data**, not behaviour —
cli resolves configuration against them and tuning them never touches analyzer
logic (AD-3, ADR-0002). Both are matched case-insensitively: `logo.PNG` is the
same asset as `logo.png`, and since APFS and NTFS fold case where ext4 does
not, a case-sensitive matcher would let one repository classify two ways
depending on the machine holding the checkout (AD-4).

## How each part decides

**LOC** is physical lines carrying at least one non-whitespace character.
Blank and whitespace-only lines do not count; comments do. Whitespace means
Unicode whitespace, not merely ASCII — a line holding one no-break space or an
ideographic space is blank to a reader and is counted as blank here, which the
counter resolves by recognizing those characters' byte sequences rather than
by decoding UTF-8 in the hot loop. All three line endings in the wild end a
line: LF, CRLF, and the bare CR of pre-OS X Mac files. Stripping comments
would need a parser per language, which is `deps`' business. Files are streamed
in 64 KB chunks and never retained whole, so a checked-in 40 MB blob costs one
chunk of memory.

**Language** is detected by extension, with a short table of extension-less
names (`Makefile`, `Dockerfile`). Unrecognized extensions count under
`unknown` — they still contribute LOC and still become nodes, so the shares in
`stats.languages` sum to 1. `stats.languages` is a share of analyzed *lines*,
as the contract declares; a repository with zero analyzed lines gets `{}`.

**Layers** come from `LAYER_RULES`, an ordered table where the first match
wins. Test rules sit first and unconditionally, so a test file under
`frontend/` is `test`. Then infra, then frontend (directory conventions like
`web/` and `client/` deliberately beat the generic language extensions below
them), then backend. Anything unmatched is `other` — never a guess. Globs from
`.gitnebula.yml` `layers:` are prepended, so a user rule wins over everything
including test detection (ADR-0002). A module's layer is the dominant layer of
its files by LOC, with ties broken on a fixed order rather than on iteration
order.

**Modules** start as top-level directories. If one holds more than
`DESCENT_THRESHOLD` of the analyzable files, it is replaced by its immediate
child directories — plus itself when it holds files directly, so `src/index.ts`
does not fall out of the structure. Module paths never exceed
`MAX_MODULE_DEPTH` (2) segments. Files sitting in the repository root belong to
no module: the contract already spells that `parent: null`, and a synthetic
root module would draw a module the repository does not have.

**Determinism** (AD-4): directory entries are traversed in sorted order, nodes
are sorted by id with a code-unit comparator (never a locale), language keys
and warnings are emitted sorted. Two runs over the same tree serialize
byte-identically — asserted in both the fixture-repo suite and the temp-tree
suite.

## Demo-repo evidence (AC-6) — human-review material for 4.4

Three repositories, cloned at `--depth 1` on 2026-08-11, scanned with
`DEFAULT_EXCLUDES` and no `layers:` overrides. Times are wall-clock on the
maintainer's machine, warm cache, and are here only to show the stage is far
inside the 60 s SM-1 budget — they are not the perf measurement.

### fastapi — 2,893 files, 257,221 LOC, 6 modules, ~0.3 s

| module      | layer   | LOC     |
| ----------- | ------- | ------- |
| `.github/`  | infra   | 1,801   |
| `docs/`     | other   | 155,552 |
| `docs_src/` | backend | 6,225   |
| `fastapi/`  | backend | 19,154  |
| `scripts/`  | backend | 5,032   |
| `tests/`    | test    | 68,575  |

Languages: markdown 58.8%, python 37.8%, yaml 2.8%, javascript 0.2%.
File layers: other 1,573 · test 637 · backend 522 · infra 146 · frontend 15.
No warnings.

**Reads sensibly.** `fastapi/` is the library, `tests/` is tests, `docs/` is
`other` because it genuinely is 155k lines of translated markdown. The
markdown-dominated language share is a true fact about this repository, not a
misclassification.

### excalidraw — 930 files, 245,523 LOC, 17 modules, ~0.1 s

| module                         | layer    | LOC     |
| ------------------------------ | -------- | ------- |
| `packages/excalidraw/`         | frontend | 172,306 |
| `packages/element/`            | backend  | 46,636  |
| `excalidraw-app/`              | frontend | 7,175   |
| `dev-docs/`                    | backend  | 5,122   |
| `packages/common/`             | backend  | 4,145   |
| `packages/math/`               | backend  | 2,785   |
| `examples/`                    | frontend | 2,677   |
| `scripts/`                     | backend  | 1,240   |
| `packages/utils/`              | backend  | 1,171   |
| `packages/laser-pointer/`      | backend  | 487     |
| `.github/`                     | infra    | 374     |
| `packages/fractional-indexing/`| backend  | 357     |
| `firebase-project/`            | other    | 87      |
| `.codesandbox/`                | other    | 53      |
| `packages/`                    | other    | 51      |
| `public/`                      | frontend | 30      |
| `.husky/`                      | other    | 2       |

Languages: typescript 70.2%, json 17.8%, unknown 5.0%, scss 3.4%.
File layers: frontend 357 · backend 270 · other 150 · test 136 · infra 17.
No warnings.

**Reads sensibly, and only because both thresholds were retuned** — see below.
The monorepo unfolds into its real packages. `packages/` survives as a small
`other` module holding the four config files that sit directly in it, which is
the honest answer rather than a hidden one.

### streamlit — 2,507 files, 543,077 LOC, 11 modules, ~0.3 s

| module            | layer   | LOC     |
| ----------------- | ------- | ------- |
| `frontend/`       | test    | 216,961 |
| `lib/`            | test    | 210,154 |
| `e2e_playwright/` | test    | 71,264  |
| `specs/`          | other   | 11,335  |
| `.github/`        | infra   | 9,242   |
| `scripts/`        | backend | 4,431   |
| `proto/`          | other   | 4,059   |
| `.cursor/`        | other   | 1,383   |
| `wiki/`           | other   | 273     |
| `.devcontainer/`  | infra   | 188     |
| `.codex/`         | other   | 93      |

Languages: python 51.4%, typescript 39.3%, markdown 3.5%, unknown 2.6%.
File layers: test 921 · frontend 764 · backend 511 · other 232 · infra 79.
Warnings: `symlink-skipped` ×4 (first: `.codex/skills`).

**One item for the human-review checklist.** `frontend/` and `lib/` both come
out `test`, and the numbers say that is *arithmetically correct*:

| module      | backend | frontend | test    | other |
| ----------- | ------- | -------- | ------- | ----- |
| `lib/`      | 71,944  | 13,969   | 119,699 | 4,542 |
| `frontend/` | —       | 100,954  | 116,007 | —     |

Streamlit genuinely has more test lines than source lines in both of its main
trees. This is ADR-0002's stated trade-off ("mixed modules show one colour;
per-file truth remains visible at file zoom"), reached honestly rather than by
a rule misfiring — the per-file split above is what a reviewer sees on unfold.
Flagging it for 4.4 as a *product* question, not a bug: if a reviewer decides
the map should not paint a repository's main modules as tests, the fix is a
change to ADR-0002's dominance rule (e.g. dominant among non-test layers when a
module has any source at all), which is an ADR revision and its own story — not
something to slip into this one.

## Final thresholds, and why they are not the PRD's numbers

`DESCENT_THRESHOLD = 0.7`, `MAX_MODULE_DEPTH = 2`.

The PRD carries 80% / depth 2 as an explicit assumption to be refined against
the demo repos. The refinement:

| repo       | largest top-level directory | share of files |
| ---------- | --------------------------- | -------------- |
| excalidraw | `packages/`                 | 79.2%          |
| fastapi    | `docs/`                     | 58.0%          |
| streamlit  | `frontend/`                 | 39.5%          |

- **At 0.8**, excalidraw misses the bar by four fifths of a percent and draws as
  a single 227,938-line `packages/` module — precisely the failure the descent
  heuristic exists to prevent.
- **At 0.5**, fastapi's `docs/` descends into thirteen translation modules
  (`docs/de/`, `docs/es/`, `docs/ja/`, …), which is worse than not descending.
- **0.7 and 0.6 produce identical output on all three repositories**, so 0.7 is
  not balanced on a knife edge; it takes the larger of the two, keeping the most
  distance from fastapi's 58.0%.

Depth 2 is unchanged — nothing in the measured output asked for a third level.

Three exclusions were added on the same evidence: `**/__snapshots__` and
`**/*.snap` (on excalidraw, three generated snapshot files of 21.8k, 15.1k and
10.0k lines were among the four largest in the repository and by themselves
flipped `packages/` to `test`), and `**/.yarn`. One layer rule was removed:
`**/testing/**` labelled streamlit's shipped `lib/streamlit/testing/` API as
test code.

## Files

| file                                     | new/update | why                                              |
| ---------------------------------------- | ---------- | ------------------------------------------------ |
| `packages/scanner/src/index.ts`           | UPDATE     | public surface: `analyze` + the exported data     |
| `packages/scanner/src/analyze.ts`         | NEW        | the analyzer entry: walk → measure → assemble     |
| `packages/scanner/src/walk.ts`            | NEW        | tree walk with directory pruning; streaming LOC   |
| `packages/scanner/src/excludes.ts`        | NEW        | `DEFAULT_EXCLUDES` data + picomatch compilation   |
| `packages/scanner/src/layers.ts`          | NEW        | `LAYER_RULES` table, rule engine, dominant layer  |
| `packages/scanner/src/languages.ts`       | NEW        | extension map, share computation                  |
| `packages/scanner/src/modules.ts`         | NEW        | module derivation and the descent heuristic       |
| `packages/scanner/src/warnings.ts`        | NEW        | AD-7 counted-drop collector                       |
| `packages/scanner/src/analyze.test.ts`    | NEW        | end-to-end behaviour over crafted temp trees      |
| `packages/scanner/src/walk.test.ts`       | NEW        | entry classification and the Unicode whitespace rule |
| `packages/scanner/src/fixture-repo.test.ts`| NEW       | AC-4 snapshot + byte-identity on the fixture repo |
| `packages/scanner/src/excludes.test.ts`   | NEW        | AC-1 exclusion coverage, both directions          |
| `packages/scanner/src/layers.test.ts`     | NEW        | AC-2 ordering, overrides, dominance               |
| `packages/scanner/src/languages.test.ts`  | NEW        | AC-5 detection and shares                         |
| `packages/scanner/src/modules.test.ts`    | NEW        | AC-3 derivation and descent                       |
| `packages/scanner/src/index.test.ts`      | UPDATE     | public-surface guard, replacing the 1.1 stub test |
| `packages/scanner/package.json`           | UPDATE     | adds `picomatch` (AD-13: matching lives here only)|

`packages/scanner/src/index.ts` still exports `packageName`: the cli stub from
story 1.1 imports it to prove its AD-2 edge, and 2.4 drops that import when it
calls `analyze` for real. It is marked as such in the source.

## Verification

```sh
pnpm --filter @gitnebula/scanner test   # 145 tests
pnpm lint && pnpm test                  # both exit 0, whole workspace
```

The fixture-repo suite builds `test-fixtures/.generated/history-repo` itself
(AD-14), so the per-package command works without the root `pretest` step.

Manual testing: not applicable. This story ships no UI, no route and no
keyboard behaviour — it is a library function whose surface is covered by the
suite above. The one human-judgement item is AC-6, and its evidence is the
demo-repo section of this document rather than a set of steps to repeat.
