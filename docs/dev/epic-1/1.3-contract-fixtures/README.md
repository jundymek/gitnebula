# 1.3-contract-fixtures — dev notes

Story: edge-case `analysis.json` fixtures plus the deterministic fixture-repo
mechanism (AD-14). These fixtures are the only data `viz` sees until M2, and
the built repos are the known history `githist` tests run against.

## What was built

- `packages/contract/fixtures/` — hand-authored edge-case documents
  (empty graph, single module, cyclic imports, module with zero files,
  zero-history repo) plus the generated `synthetic-100x2000.json`.
  See `packages/contract/fixtures/README.md` for the per-fixture edge table
  and the how-to-add-a-fixture recipe.
- `packages/contract/scripts/generate-synthetic-fixture.mjs` — seeded
  (mulberry32) generator for the 100-module / 2,000-file perf yardstick
  (ADR-0006 / FR-14). Byte-identical regeneration; a test asserts it.
- `test-fixtures/build-fixture-repo.sh` — replays crafted commits with pinned
  git dates and fixed identities into gitignored `test-fixtures/.generated/`.
  Deterministic hashes; see `test-fixtures/README.md` for the covered history
  and extension rules.
- Tests in `@gitnebula/contract`: every fixture in `fixtures/` passes
  `validateAnalysis` (directory loop — new fixtures are picked up
  automatically); the generator regenerates byte-identically; the repo
  builder builds twice with identical `git rev-parse HEAD`.
- Root `pretest` runs the repo builder, so `pnpm test` on a fresh clone works
  with no manual step; CI does the same.

## How the repo builder works

One POSIX shell script, one `commit` helper that pins
`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` and both identities per commit, gpg
signing and template hooks disabled, output rooted at
`test-fixtures/.generated/history-repo`. The final line of stdout is the HEAD
hash, which is what the determinism test compares.

The pinned analysis window for fixture tests is `windowAnchor =
2026-01-01T00:00:00Z`, 365 days (AD-13): 2025 commits are in-window, 2024
commits are deliberately outside it.

## How to add a fixture

Contract documents: drop a `.json` into `packages/contract/fixtures/`, add a
table row in its README, run the contract test suite — the validation loop
requires no test-code change. Fixture repos: extend the build script per the
rules in `test-fixtures/README.md` (pin dates, never read the clock, keep the
determinism test green).
