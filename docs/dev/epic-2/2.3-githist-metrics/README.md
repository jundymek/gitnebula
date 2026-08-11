# 2.3 — Git history metrics (`githist`)

Churn, authors, last-changed and co-change, derived from one pass over local
git history. No network, no clock, no per-file git invocations.

## The git invocation, exactly

Built by `gitLogArgs()` in `src/git-log.ts`, which is the only definition —
this document quotes it rather than restating it:

```sh
git -C <root> log \
    -M \
    -z \
    --name-status \
    --since-as-filter=<windowAnchor − windowDays> \
    --until=<windowAnchor> \
    --format=%x1e%H%x1f%ct%x1f%ae
```

Piece by piece:

- **`--since-as-filter` / `--until`** bracket the analysis window. Both ends
  come from `Config.windowAnchor` (AD-13); the analyzer never reads the clock,
  which is also what an ESLint rule enforces for this package (AD-4).

  The lower bound is **`--since-as-filter`, not `--since`**, and the difference
  is data loss rather than speed. `--since` is a traversal *cutoff*: git stops
  walking as soon as it meets a commit older than the bound. Commit dates are
  not reliably monotonic — clock skew, a rebase, an imported history — so an
  in-window commit sitting behind an older-dated descendant is never visited.
  Demonstrated on a two-commit repository (ancestor dated 2025-06, descendant
  dated 2024-01, window 2025): `--since` returns **nothing**,
  `--since-as-filter` correctly returns the ancestor. `--until` needs no
  equivalent — it skips newer commits without halting the walk.

  `--since-as-filter` needs git ≥ 2.37. Rather than spend a process probing the
  version on every run, the correct flag is tried first and `--since` is used
  only if git rejects it, so current git pays nothing and older git still
  works, with the cutoff as its documented cost.
- **`-M`** detects renames and emits them as `R<score>` records with both
  paths, which is where the old→new mapping comes from.
- **`-z`** NUL-terminates every path, so paths containing spaces, quotes or
  non-ASCII bytes arrive verbatim instead of git-quoted.
- **`--name-status`** is the cheapest per-commit file list; nothing here needs
  diff content.
- **`--format`** uses ASCII record (0x1e) and unit (0x1f) separators because
  `-z` has already spent NUL on paths. The commit **message is deliberately not
  requested**, so no user-controlled text reaches the header.

  The record separator is nonetheless **never searched for across the stream**.
  POSIX forbids only NUL and `/` in a filename, so a tracked path may legally
  contain 0x1e, and splitting on every occurrence would tear such a path in
  half and invent a commit from its tail. Instead the stream is split on NUL —
  which a path cannot contain — and a leading 0x1e is tested only at positions
  where a header may begin. Path tokens are consumed positionally and never
  inspected. Both the parser and a real repository carrying such a filename are
  covered by tests.
- **No `--no-merges`**, deliberately. `GitResult.commits` is contractually the
  repo-wide count and `lastCommitAt` the newest instant in the window, so
  filtering merges would undercount on any merge-based workflow and could
  report a stale last-changed instant. Merges therefore stay in the stream and
  attribute to no node: git prints no file records for a merge, which is
  correct, since its content already arrived through the commits being merged.
  A `commit --allow-empty` behaves identically — counted repo-wide, attributed
  nowhere. (This reverses an earlier decision in this branch; the measurement
  that settled it is in the story's Dev Agent Record.)

### Why `--follow` is banned

AD-13 bans it, and the ban is load-bearing rather than stylistic:

1. **`--follow` only accepts one path.** Following renames with it means one
   `git log` process per file — thousands on a 2,000-file repository — against
   a 60 s budget for the whole pipeline. One pass with `-M` costs one process.
2. **It cannot see co-change at all.** A per-file log never shows which *other*
   files moved with it, so the entire `cochanges` half of this story would need
   a second full pass anyway.
3. **Its history is heuristic and non-composable.** `--follow` re-runs rename
   detection per invocation, so two files' followed histories can disagree
   about the same commit. A single pass with one shared rename map gives every
   node the same view of the same history.

The replacement is `RenameChain` (`src/renames.ts`): git emits commits newest
first, so walking in that order and recording `old → resolve(new)` after each
commit collapses a chain `a → b → c` into direct lookups for both `a` and `b`.
A commit's own changes are resolved *before* its renames are recorded, because
within the renaming commit the file already carries its new name.

### Known limitation: divergent renames across branches

One path can be renamed to two different names on two branches that are both
reachable from HEAD (or deleted, recreated and renamed again). Its pre-fork
history then genuinely belongs to two present-day files at once, and a single
flat alias map can attribute it to only one — giving it to both would
double-count the same commits.

The rule here is **the most recent rename wins**: git emits newest first, so
the first rename observed for a path is the newest, and it is kept rather than
overwritten. That is explainable ("a path resolves to the name it most recently
acquired") and, crucially, deterministic — git's traversal order is fixed for a
given repository, so AD-4 holds and snapshots stay stable.

Resolving it *properly* means ancestry-aware state: a topological walk of the
commit DAG carrying a separate alias map per parent. AD-13 prescribes the
opposite — "one-pass `git log -M --name-status` with an old→new path mapping" —
so changing this is an architecture decision, not an implementation detail, and
would be its own story. Raised by Codex review and left documented rather than
silently redesigned. The affected shape (two divergent renames of one path,
both merged) is rare, and the error it produces is a misattribution of
pre-fork commits between two files, never a lost or duplicated commit count
repo-wide.

## Metrics

- **`commits`** — commits in the window touching the node. For a **module** the
  count is direct (ADR-0003): a commit touching three files of one module
  counts once, never summed from its files.
- **`authors`** — distinct author identities, keyed by lowercased email. Email
  is more stable than display name; `.mailmap` is not consulted (it would be a
  second side effect no story asks for).
- **`lastChangedAt`** — newest **committer** instant, ISO UTC. Committer date
  throughout, because `--since`/`--until` filter on it and git offers no
  author-date equivalent; reporting author dates would let a node's timestamp
  fall outside the window that selected it.
- **`churn`** — `min(1, commits / P95(commits))`, P95 taken over same-kind
  nodes with at least one commit (ADR-0003). The estimator is **nearest rank**
  (`sort ascending, index = ceil(0.95 · n) − 1`): it always returns an observed
  value, so a kind with a single active node yields that node's own count and
  therefore churn exactly 1.0. Reported at 3 decimals to match the committed
  contract fixtures, with a floor of 0.001 for any node that has activity —
  `churn === 0` must keep meaning "no commits in the window".

## Co-change

Pairs are unordered and same-kind, file-file and module-module, aggregated here
so viz stays a pure consumer (ADR-0005). Bounds: `count >= 3`, top 500 per
kind, sorted by count descending then `a` then `b` — sorted **before** the cap
so which 500 survive is deterministic.

A commit touching more than 50 files is skipped for co-change as bulk-change
noise and counted as a warning. The threshold is applied to the paths the
commit actually touched, *before* universe filtering: a 300-file dependency
bump of which four files happen to be in the universe is exactly the noise the
rule exists to drop. The skip is co-change only — those commits still count
towards every node's `commits`.

**The end-to-end snapshot's `cochanges` is empty, by design.** The built
fixture repo's only repeated pair (`core/scoring.py` + `web/api.ts`) has
count 2, below the `count >= 3` bound. Extending `build-fixture-repo.sh` would
change commit hashes under stories 2.1 and 2.4 mid-wave, so co-change is
covered instead by unit tests over the pure extractor — whose input shape is
itself pinned to real `git log` output by the parser tests.

## Universe and warnings

`ScanResult`'s node set is the closed universe (AD-13). A path in history that
is not a file node — deleted before HEAD, excluded by the scanner, or living
under a directory the scan never walked — is dropped and counted, never
silently (AD-7). Warning codes emitted:

| code                    | meaning                                             |
| ----------------------- | --------------------------------------------------- |
| `path-outside-universe` | history path with no matching file node             |
| `bulk-commit-skipped`   | commit over 50 files, excluded from co-change        |
| `unknown-module-parent` | file node whose `parent` is not a module in the scan |

Every node in the universe gets a `history` entry, including untouched ones
(explicit zeros and `lastChangedAt: null`), so cli never has to invent a
default for a node this analyzer did not mention.

## Failure policy

Only two conditions abort: git missing from `PATH`, and the root not being a
repository. Both are stage-level failures cli wraps in the AD-7 shape. A
repository that merely has **no commits yet** is a legitimate input with an
honest answer — all zeros — so that specific `git log` exit is recognised and
turned into an empty commit list.

## Files

| file                    |        | why                                                              |
| ----------------------- | ------ | ---------------------------------------------------------------- |
| `src/git-log.ts`        | NEW    | the single git spawn (AD-3's declared side effect) and its parser |
| `src/renames.ts`        | NEW    | old→new rename chain over a newest-first commit stream            |
| `src/metrics.ts`        | NEW    | per-node activity, nearest-rank P95, churn                        |
| `src/cochange.ts`       | NEW    | pair counting, ADR-0005 bounds, stable sort                       |
| `src/index.ts`          | UPDATE | `analyze` + the pure `computeGitResult`; scaffold seam retired    |
| `src/*.test.ts`         | NEW    | 72 tests; `index.test.ts` holds the fixture-repo snapshot         |

`analyze` takes `{ root, scan }` — `ScanResult` is the contract-typed part; the
envelope is package-local because the contract exports result shapes, not input
shapes. The field name matches the wrapper `deps` uses so cli sees one shape
across both analyzers.

## Verification

```sh
pnpm --filter @gitnebula/githist test   # 67 tests
pnpm lint                               # eslint + prettier
```

The snapshot test builds the fixture repo itself (AD-14) and pins
`windowAnchor` to `2026-01-01T00:00:00Z` with a 365-day window, so the
2024 commits fall outside it and `legacy/old.ts` reports zeros. A second test
runs the analyzer twice and byte-compares the serialized results.

## Manual testing

Not applicable — no UI, no route, no keyboard behaviour. The whole surface is
one exported async function returning a data structure, asserted against a real
git repository by the snapshot test. There is nothing a human could observe
that the tests do not already pin, so no `MANUAL_TESTING.md` accompanies this
story.
