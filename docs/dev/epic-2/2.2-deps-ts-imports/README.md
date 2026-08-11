# 2.2 — TS/JS import edges

`@gitnebula/deps` now turns the scanner's closed universe of TS/JS files into
dependency edges at both graph levels: file-level edges resolved with the
TypeScript compiler API against the repo's own `tsconfig.json` (ADR-0001), and
module-level edges aggregated from them with `weight` = the number of underlying
file pairs (ADR-0005). Nothing in the stage throws: an unparsable file, an
unresolvable specifier, a dependency and a file outside the universe are each
dropped and counted under their own code (AD-7).

## The public surface

```ts
import { analyze, type DepsInput } from "@gitnebula/deps";

const result = await analyze({ root, scan }, config, onProgress);
// result: DepsResult — { edges, warnings }, both contract types
```

`DepsInput` is the one type this package adds. The contract's `ScannedNode.path`
is repo-relative and the resolved `Config` carries no root, so a bare
`ScanResult` cannot be opened — and adding a root to the contract would be a
contract change, which is never a side effect of another story. The root
therefore travels in a deps-local wrapper. **cli (story 2.4) passes
`{ root, scan }` rather than the `ScanResult` alone**; everything else is
contract-typed per AD-3.

## Files

| file | | why |
| --- | --- | --- |
| `packages/deps/src/index.ts` | UPDATE | `analyze`, `DepsInput`, and the classification cascade that decides edge / external / outside-universe / unresolved |
| `packages/deps/src/ts/collect.ts` | NEW | source text → import specifiers; every form AC-1 lists, plus syntax-error detection |
| `packages/deps/src/ts/resolve.ts` | NEW | specifier → file, via nearest-tsconfig lookup and `ts.resolveModuleName` |
| `packages/deps/src/edges.ts` | NEW | language-neutral: dedupe file pairs, aggregate module weights, stable sort |
| `packages/deps/src/warnings.ts` | NEW | the four counters, emitted in fixed order |
| `packages/deps/src/*.test.ts`, `src/ts/collect.test.ts` | NEW | 24 tests; `__snapshots__/analyze.test.ts.snap` is the committed expectation |
| `packages/deps/src/measure.test.ts` | NEW | the AC-6 measurement, opt-in via `GITNEBULA_MEASURE_REPO` |
| `test-fixtures/build-ts-fixture-repo.sh` | NEW | builds the crafted fixture trees (AD-14) |
| `packages/deps/package.json`, `tsconfig.json` | UPDATE | `typescript` dependency, `pretest` fixture build, `esModuleInterop` for the compiler API's `export =` |

The collect/resolve split is the seam story 3.1 needs: a Python parser adds a
sibling pair of modules and reuses `edges.ts` and `warnings.ts` unchanged.

## Why the fixture is generated rather than committed

`test-fixtures/build-ts-fixture-repo.sh` writes two trees into the gitignored
`test-fixtures/.generated/`, per AD-14 and the sibling-script rule in
`test-fixtures/README.md`. The AC-4 fixture is a file with genuine syntax
errors, which would break `pnpm lint` and `pnpm typecheck` for the whole
workspace if it were committed as `.ts`. githist's `build-fixture-repo.sh` is
deliberately untouched: its commit hashes are pinned by story 2.3's snapshots.

The fixture covers relative imports, a `paths` alias, a `baseUrl` import, an
implicit `index.ts`, an `export * from` chain, dynamic `import()`, JS `require`,
a computed `require`, a stylesheet import, a `node_modules` package, an
uninstalled package, a Node builtin, a workspace package reached through a
symlink, a file outside the universe, two kinds of unresolvable import, and the
broken file.

## AC-6 — measurement on excalidraw

Reproduce with:

```sh
git clone https://github.com/excalidraw/excalidraw && cd excalidraw
git checkout abeeaeba217ab3b5193b78c8d8d63c373b518ced
cd -; GITNEBULA_MEASURE_REPO=<that checkout> pnpm --filter @gitnebula/deps test
```

Pinned SHA `abeeaeba217ab3b5193b78c8d8d63c373b518ced` (2026-08-11,
"feat(editor): customizing color top picks (#11872)"), **with no `npm install`** —
a bare clone, which is the harder and more honest case.

| | |
| --- | --- |
| files in universe | 1,269 |
| specifiers examined | 4,261 |
| file edges resolved | 3,674 |
| external (packages, builtins) | 587 |
| outside universe | 0 |
| unparsable files | 0 |
| **unresolved** | **0 (0.0%)** |

FR-11's threshold is 20%. The rate is reported over the specifiers that could
have become an edge — externals are ignored by design, not failures to resolve —
and here both readings are 0%.

That number took two attempts, and the first one is the more informative:

- **First run: 21.2% unresolved, over the threshold.** All 904 failures broke
  down into 587 bare specifiers (`react`, `clsx`, `node:fs`) failing only
  because a bare clone has no `node_modules`, and 317 relative asset imports
  (230 `.woff2`, 83 `.scss`, 4 `.css`). Not one genuine miss.
- Neither is an unresolved *import*. Counting them as such would have made
  FR-11 measure package installation and stylesheet conventions instead of
  resolution quality — so the classification changed, not the threshold.

The stage takes well under a second on this repo, comfortably inside the SM-1
budget.

## Resolution behaviour worth knowing

- **Nearest `tsconfig.json`**, searched from each file up to the repo root and
  no further, parsed once and cached. A repo with no tsconfig resolves under
  permissive defaults (AC-7) — verified by a second fixture tree.
- **A permissive second chance.** A specifier the repo's own options reject is
  retried once under bundler-style defaults. A `NodeNext` package rejecting an
  extensionless specifier, or a monorepo package whose own tsconfig was not
  found, should not cost a real edge. This can never invent a node: every
  result is still filtered against the `ScanResult` universe (AD-13).
- **Relative specifiers the compiler cannot follow** (`./view.css`,
  `../fonts/x.woff2`) are looked up literally in the universe. If the scanner
  listed that file, it is an edge — a component depending on its stylesheet is a
  real dependency.
- **Bare specifiers that resolve nowhere are external**, not unresolved: they
  name a package or a Node builtin. Zero-config means gitnebula runs on
  checkouts with nothing installed, where every dependency would otherwise look
  like a failure. A bare specifier the repo's own `paths` mapping claims is
  exempt and stays counted as unresolved — that one is a genuine miss.
- **Universe membership outranks externality.** In a pnpm/yarn workspace an
  intra-repo package resolves *through* a `node_modules` symlink to a repo file;
  TypeScript reports the real path, and that is a real edge. Verified against
  gitnebula itself: `packages/deps/src/index.ts → packages/contract/src/index.ts`
  and the aggregated `packages/deps → packages/contract` both appear — exactly
  the AD-2 dependency the architecture declares. This is a deliberate divergence
  from a literal reading of AC-2 ("imports resolving into `node_modules` produce
  no edge").
- **Type-only imports are edges.** They emit no runtime code but they are
  architectural dependencies, and dropping them would erase most edges into a
  repo's `types.ts`.

### Known limitations

- A repo that imports its own source through a **bare specifier with no `paths`
  entry** and with no install is counted external, so that edge is missed. It
  resolves correctly as soon as the workspace is installed.
- Computed specifiers (`require(name)`, template literals) are skipped, not
  counted: there is no import string to resolve.
- Syntax-error detection reads TypeScript's internal `parseDiagnostics`. The
  read is defensive — anything unexpected is treated as "parsed cleanly" — so a
  future TypeScript release could cost warnings, never a crash. A unit test
  fails if the internal moves.

## Determinism (AD-4)

No clock, no RNG (also enforced by ESLint for this package). Files are processed
in sorted path order, so even the single example kept on each warning is stable.
Edges are sorted by source then target with code-unit comparison, never
`localeCompare`, whose result depends on the ICU build. The snapshot test runs
`analyze` three times — twice plainly, once with the `ScanResult` node order
reversed — and asserts byte-identical JSON.

## Verification

```
pnpm --filter @gitnebula/deps test   # 24 passed, 1 skipped (the opt-in measurement)
pnpm lint                            # eslint + prettier, exit 0
pnpm typecheck                       # all six packages, exit 0
pnpm test                            # whole workspace, 183 passed
```

Every assertion here was seen red before it was trusted: removing the fixture's
`tsconfig.json` turns 5 tests red and the unresolved count from 1 to 5; renaming
the `parseDiagnostics` internal turns 5 red; removing pair deduplication turns
6 red.

Manual testing: not applicable. This story ships no UI, no route and no
keyboard-reachable surface — it is a library function inside the Node pipeline,
and every acceptance criterion except AC-6 is executable. AC-6 is a one-off
local measurement, recorded above with the command that reproduces it, so there
is no `MANUAL_TESTING.md`.
