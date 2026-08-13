# Fixture repositories

Deterministic repositories used by analyzer tests, built by the scripts in this
directory into the gitignored `.generated/` — **built, never committed**
(AD-14). No `.git` directory, renamed or otherwise, ever lands in the repo.

```sh
./test-fixtures/build-fixture-repo.sh      # githist: prints the HEAD hash
./test-fixtures/build-ts-fixture-repo.sh   # deps, TS/JS: prints the tree it wrote
./test-fixtures/build-py-fixture-repo.sh   # deps, Python: prints the tree it wrote
```

The root `pretest` script runs the first automatically and `@gitnebula/deps`'
own `pretest` runs the other two, so a fresh clone's `pnpm test` needs no manual
step; CI does the same.

The two `deps` scripts write plain source trees with no git history —
`ts-imports-repo`, `ts-imports-repo-no-config` and `python-imports-repo` —
because `deps` reads the working tree, never the log. Each has one file with
deliberate syntax errors, and that is precisely why the trees are generated:
committed as `.ts` such a file would break `pnpm lint` and `pnpm typecheck` for
the whole workspace, and as `.py` it would be a permanently broken file in the
repository.

## Concurrency (story 3.6)

`build-fixture-repo.sh` is safe to run from several processes at once, which is
what `pnpm -r test` does: `contract`, `scanner`, `githist` and `cli` each build
the fixture from their own suite so that every package's test command works
standalone. Three properties make that safe, and a new caller gets them for
free:

- a `mkdir` lock at `.generated/history-repo.lock`, released on exit and on
  `INT`/`TERM`/`HUP`, with a bounded wait that fails loudly rather than hanging;
- `.generated/history-repo.stamp` holds a checksum of the builder — a caller
  that finds a valid repository built by the same script prints its HEAD hash
  and touches nothing, so the common case costs milliseconds and deletes
  nothing;
- the build happens in `.generated/history-repo.building` and is renamed into
  place only when complete, so no reader ever sees a half-built repository.

Two rules follow. **Call the script, do not reimplement its steps** — a caller
that runs `rm -rf` itself is outside the lock. And **do not add a package-level
`pretest` that invokes it**: a suite-level call is already safe and cheap, and
`packages/cli/src/fixture-build.test.ts` fails if one reappears. Editing this
script changes its checksum, which invalidates the stamp — that is intended,
and it is how a stale fixture gets rebuilt.

The two `deps` scripts each have a single caller and no such discipline; if
either ever gains a second, give it the same three properties first.

The three scripts are independent. `build-fixture-repo.sh`'s commit hashes are
pinned by githist's snapshots; extend it only with that in mind, and prefer a
new sibling script (below).

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
