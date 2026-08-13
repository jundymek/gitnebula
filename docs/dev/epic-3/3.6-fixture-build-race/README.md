# 3.6 — One owner for the fixture repository build

`pnpm test` from the workspace root failed roughly half the time. Four callers
invoked `test-fixtures/build-fixture-repo.sh`, whose first act is `rm -rf` on a
shared directory, and `pnpm -r test` runs packages in parallel — so one package
deleted the fixture repository while another was reading it.

## Reproduction, before the change

Clean `.generated/`, base of this branch, three runs of `pnpm test`:

| run | result | package |
| --- | --- | --- |
| 1 | fail | `githist` — `Error: Command failed: sh .../build-fixture-repo.sh` |
| 2 | fail | `githist` — same error |
| 3 | fail | `scanner` — same error |

The quieter half of the symptom was visible too: on a racing run `scanner`
reported 142 passed / 3 skipped instead of 145 passed, which a reader watching
only for red scrolls past.

## The mechanism chosen

The builder was made safe, rather than the callers removed. AC-2 and AC-3 pull
in opposite directions: `contract`, `scanner` and `githist` have no `pretest`,
so their in-suite build is the only thing that gives them a fixture when the
package is run on its own, and deleting it would have broken every story agent's
`pnpm --filter … test` loop.

`test-fixtures/build-fixture-repo.sh` now has three properties, all three
needed:

1. **A `mkdir` lock** (`.generated/history-repo.lock`) — `mkdir` is atomic on
   every POSIX filesystem, so it needs no dependency and no flock. Released by
   an `EXIT`/`INT`/`TERM`/`HUP` trap. The wait is bounded at ~60 s and then
   fails loudly naming the lock directory, because a build takes about a second
   and a longer wait means a leaked lock, not a slow peer.
2. **A no-op when a valid repository is already present** — `.generated/history-repo.stamp`
   holds a checksum of the builder itself. If it matches and `git rev-parse HEAD`
   succeeds, the script prints the HEAD hash and touches nothing. This is what
   makes concurrent callers harmless rather than merely serialised: the common
   case is ~10 ms and does not delete anything. Editing the builder changes the
   checksum, so a stale fixture rebuilds on the next run.
3. **Build off to the side, then swap** — the build writes
   `history-repo.building` and is renamed over the live directory only once
   complete, so a reader never observes a half-built or deleted repository.

The stamp deliberately lives *outside* the repository working tree: inside it,
it would appear as a fourth file in the scan and break `scanner`'s committed
expectation.

### Rejected, and why

- **Delete the in-suite builds, keep only the root `pretest`.** Satisfies AC-2
  and breaks AC-3 — three packages would then have no fixture standalone.
- **Give every package its own `pretest`.** The same race with more callers.
- **Run `pnpm -r test` serially (`--workspace-concurrency=1`).** Hides the
  defect, costs everyone wall-clock, and leaves the next caller unsafe.
- **A copy of the fixture per package.** Six copies, six chances to drift, and
  the commit hashes are pinned by three merged snapshots.
- **`flock`.** Not present on macOS by default; `mkdir` is portable and enough.
- **Bringing `build-ts-fixture-repo.sh` under the same discipline.** It has one
  caller (`deps`' `pretest`), writes a different tree, and is not the defect;
  the story says to adopt it only if it costs nothing, and sharing the lock
  logic would mean a new shared shell helper plus a change in a file `3.1` is
  actively working in. Left alone deliberately.

## `cli`'s workaround, removed (AC-6)

Story 2.4 gave `packages/cli` a conditional `pretest`
(`[ -d …/history-repo ] || sh …`), a workaround for one package. It is gone.
`cli`'s four fixture-dependent suites now call `ensureFixtureRepo()` in
`beforeAll`, the same shape `scanner` and `githist` use — safe under the lock,
free when the repository is already built.

## Verification

| criterion | evidence |
| --- | --- |
| AC-1 | `pnpm test` from a clean checkout (`rm -rf test-fixtures/.generated` before each), **10 runs, 10 passed** on the base this branch started from — 578 tests. After rebasing onto the epic head three times (stories 3.2, 3.1 and 3.3 merged in): **7 of 10**, **8 of 10**, **7 of 10**, the last with `TMPDIR` pointed at an empty directory. Every failure in all three sets is story 3.2's `clone.test.ts`, none is the fixture builder — `grep -c 'Command failed: sh .*build-fixture-repo'` over all thirty run logs returns 0. See the section below. |
| AC-2 | Lock + stamp + swap, above. Six concurrent builders on a clean `.generated/` all exit 0 and print the same hash — asserted in `packages/cli/src/fixture-build.test.ts`. |
| AC-3 | `pnpm --filter @gitnebula/<pkg> test`, each from a clean `.generated/`, re-run after the second rebase: contract 103, scanner 145, githist 74, deps 66 (2 skipped), cli 116, viz 148 — all exit 0. |
| AC-4 | `git -C test-fixtures/.generated/history-repo log --format=%H` before and after the change: **identical**, HEAD `70cc4d3ce32dc991795fd87c077cf3cf9f967b55`. The crafted history was not touched; the build directory's path does not enter a commit hash. |
| AC-5 | `packages/cli/src/fixture-build.test.ts`, two assertions. Both were seen red before being relied on: the concurrency case fails against the old builder (`Error: Command failed`), the caller case fails with a `pretest` added to `packages/viz`. |
| signals | Killing a builder mid-build (`kill -TERM`) exits 143 and leaves no lock behind — only the abandoned `history-repo.building`, which the next run removes, and no stamp, so the next run rebuilds. |
| AC-6 | `packages/cli` has no `pretest`. Removed in this story, not by an earlier one. |

Fixture hashes (AC-4), unchanged, newest first:

```
70cc4d3ce32dc991795fd87c077cf3cf9f967b55
7d277ce81e2be716de15337016a16df20bf33e86
80b35ed1d334dff13bc837f1f9277b25f16c1edf
ae333690adfd4053de9418de02158d646faa581e
e0d4c037b3667f56702db506cb1b9f7a97d3006a
a16021fd5f51894b592a8f0c43f8af4cd54f4b6b
a2e4398799a24fbe374af5f8bedeb0fd51cd4d40
```

`pnpm lint` and `pnpm typecheck` both exit 0.

## Review round

Codex review raised three findings, all real, all fixed:

- **P1, the lock could be released twice.** A signal handler removed the lock
  and then called `exit`, which ran the `EXIT` trap and removed it again — and
  between those two removals another builder can legitimately own the lock,
  which the second removal would delete out from under it. Release now happens
  in one function that disarms every trap first.
- **P2, the concurrency test did not exercise the build.** Under the root
  `pnpm test` the `pretest` had already produced a valid stamp, so all six
  processes took the no-op path and the test would have passed with the lock
  removed. The builders now run against a throwaway copy of the script in a
  temp directory — which forces the real first-time build *and* keeps the test
  from deleting the fixture the rest of the workspace is reading. Verified red
  against the pre-change builder.
- **P2 (second round), the swap is not atomic for a concurrent reader.**
  Correct: POSIX has no atomic directory replacement, so between the two
  renames the live name is briefly absent. Partly fixed, partly accepted. The
  fix: the old stamp is no longer deleted before a rebuild, so an interrupted
  build leaves the previous repository *and* a matching stamp, and the next
  caller no-ops instead of rebuilding under a reader's feet. What remains: the
  window is only reachable while a reader holds a repository this script has
  decided to replace, which means the stamp stopped matching mid-run — someone
  edited the builder while tests were running. The alternatives (a symlink
  swap, which changes what `git rev-parse --show-toplevel` reports, or
  reader-side retry in four packages) cost more than that. Recorded in the
  script's own comment so the claim there is not broader than the truth.
- **P2, the fallback timeout was ten times too long.** Where `sleep` rejects
  fractional seconds the nap is 1 s, and the iteration limit stayed at 600. The
  limit now follows the nap, so the documented ~1 minute holds either way.

## Files

| file | change | why |
| --- | --- | --- |
| `test-fixtures/build-fixture-repo.sh` | UPDATE | lock, stamp, build-and-swap; crafted history untouched |
| `test-fixtures/README.md` | UPDATE | documents the concurrency contract for the next caller |
| `packages/cli/package.json` | UPDATE | conditional `pretest` workaround removed (AC-6) |
| `packages/cli/src/test-support.ts` | UPDATE | `ensureFixtureRepo()` replaces the `pretest` |
| `packages/cli/src/{cli,e2e,repo,pipeline}.test.ts` | UPDATE | build the fixture in `beforeAll` |
| `packages/cli/src/fixture-build.test.ts` | NEW | AC-5 regression guard |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's row only |

## Manual testing

Not applicable, and no `MANUAL_TESTING.md` ships with this story: it changes no
UI, no route and no keyboard behaviour. Its entire surface is the test harness,
and every acceptance criterion is an executed command whose result is recorded
in the table above.

## A different flake, not this story's, found while rebasing

After rebasing onto `epic/3-deps-python` with story 3.2 (`feat(cli): loopback
server and shallow-clone URL mode`, PR #19) merged into it, the ten-run check
came back **7 of 10**; after a second rebase, with 3.1 merged in too, **8 of
10**; after a third, with 3.3 merged in, **7 of 10** again. Every failure in all
three sets is the same test, and none of them touches the fixture builder:

```
FAIL src/clone.test.ts > an unreachable URL aborts in the AD-7 shape (AC-5)
     > names the URL, suggests the remedy, and leaves no temp dir
AssertionError: expected [] to deeply equal [ 'gitnebula-clone-SDCJZy' ]
```

Reproduced on the **unmodified epic head** `629a14c` in a scratch worktree,
running `pnpm --filter @gitnebula/cli test` alone — no root `pretest`, no
fixture build, nothing from this branch: **3 failures in 8 runs**. So it is
pre-existing and independent.

The shape: `cloneTemps()` snapshots `gitnebula-clone-*` directories in the
shared system temp directory, and vitest runs `clone.test.ts` alongside sibling
files in the same package. A directory another test created between the `before`
snapshot and the assertion — or disposed between them — makes the two lists
differ. The assertion needs to be scoped to the directories the test itself
creates.

The epic supervisor reproduced it independently and put the rate higher than
this branch's sample: **5 failures in 8 runs** at `629a14c`, always
`clone.test.ts:184`, and noted that line 161 has the same shape and the same
exposure. Their instruction was to record it and leave it alone, which is what
this file does.

One alternative explanation was ruled out rather than assumed. A stale
`gitnebula-clone-*` directory left in this machine's shared temp directory can
turn the same assertions permanently red, so the third set of ten runs was made
with `TMPDIR` pointed at an empty directory. It still came back 7 of 10 — the
race is between sibling suites inside one run, not residue from an earlier one.

Not fixed here, deliberately: it belongs to story 3.2, whose author is done, and
this story's spec says that changing what a test asserts rather than when the
fixture is built is out of scope. Reported to `bob` and to the epic supervisor,
who escalated it to the maintainer. `grep -c 'Command failed: sh .*build-fixture-repo'`
over all thirty run logs returns 0 — not one failure came from the builder.

Story 3.2's author has since fixed it in PR #26, and the epic supervisor also
specced it as story 3.7; neither had merged into the epic head this branch was
last measured on (`f0a64dc`), so the figures above stand as observed.

## Note for the maintainer

The spec's scheduling note stands: **`4.2-ci-pages-recipe` must not merge before
this story.** 4.2 turns `.github/workflows/ci.yml` on and CI runs exactly the
command that was failing. That ordering is not expressible from inside this
story — 4.2's own `Depends_on` lists only `4.1-build-bundle`, and editing an
existing spec is not this story's to do.
