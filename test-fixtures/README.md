# Fixture git repositories

Deterministic git repositories used by `githist` (and pipeline) tests, built
by the scripts in this directory into the gitignored `.generated/` — **built,
never committed** (AD-14). No `.git` directory, renamed or otherwise, ever
lands in the repo.

```sh
./test-fixtures/build-fixture-repo.sh   # prints the HEAD hash
```

The root `pretest` script runs this automatically, so a fresh clone's
`pnpm test` needs no manual step; CI does the same.

## Determinism

Every commit is replayed with pinned `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`
and a fixed author/committer identity, with gpg signing and template hooks
disabled. Running the script twice — on any machine — produces identical
commit hashes; a test builds twice and compares `git rev-parse HEAD`.

## What the crafted history covers

The analysis window used by fixture tests pins `windowAnchor` to
`2026-01-01T00:00:00Z` with a 365-day window (AD-13), so 2025 commits are
in-window and 2024 commits are not.

- a rename with content preserved (`core/score.py` → `core/scoring.py`),
  exercising the one-pass `git log -M` rename mapping
- a multi-file commit touching `core/` and `web/` (co-change source)
- `web/api.ts` touched by 3 distinct authors
- `legacy/old.ts`, whose only commits predate the analysis window
- a Python + TypeScript file mix

## Adding history or a new fixture repo

Extend `build-fixture-repo.sh` (or add a sibling `build-*.sh` writing to its
own `.generated/<name>` directory). Rules:

1. Pin both git dates and both identities on every commit — use the script's
   `commit` helper.
2. Never use the current time; pick a fixed ISO date and note whether it is
   inside or outside the pinned analysis window.
3. Keep the determinism test green: build twice, hashes must match. Changing
   the crafted history intentionally changes hashes — update any snapshot
   that pinned them, in the same commit.
