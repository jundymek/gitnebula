# 5.9 — The test command that cannot fail

`pnpm --filter <something that matches nothing> test` printed
`No projects matched the filters` and **exited 0**. A story whose spec quoted a
stale package name therefore satisfied its test obligation by running no tests,
and the pre-PR gate — which reads a quoted test result out of a PR body — had
nothing to catch it with.

This story makes an empty selection a failure, writes the six real per-package
commands down in one machine-checkable place, and records what the defect
actually cost.

## What changed

**A no-match filter now fails.** Two layers, because they cover different
ground:

- `.npmrc` sets pnpm's own `fail-if-no-match=true`. Global: `test`, `build`,
  `typecheck` and `exec` are all covered, including invocations nobody wrapped.
  bob hit this defect as a *build* during epic 5, not as a test.
- `pnpm test:pkg <package name>` (`scripts/pkg-test.mjs`) validates the name
  against the real workspace project list before it spawns pnpm, so the error
  names **the filter** that matched nothing and lists the names that exist.
  pnpm's own message names only the directory it searched.

**The commands are written down once.** `CLAUDE.md` gained a `## Verification`
section with a literal `<package name>` → `<command>` table for all six
packages, fenced by `<!-- canonical-test-commands:start/end -->` markers, with
the cli's unscoped `gitnebula` name called out as the exception that produced
the defect.

**The table cannot go stale silently.** `scripts/verify-test-commands.mjs`
asserts a bijection between the table and the workspace, asserts every row has
the one literal command form a later spec can be checked against, and asserts
both failure mechanisms still work. It runs inside root `pnpm test`.

**The cost is recorded.** [`AUDIT.md`](./AUDIT.md) maps each of the six spec
files carrying the stale command to the PR that shipped its work, reads that
PR body for a quoted cli test result, and compares the merge time against the
rename that created the defect.

**The finding: one story exposed, caught before it merged.** The cli package
was `@gitnebula/cli` until `efeaceb` renamed it on 2026-08-14 08:26 UTC, so the
epic-3 and epic-4 stories ran that filter while it still matched a real
project — their suites did run, and their quoted counts are consistent. Only
`5.5-viz-history-window` ran after the rename, and its agent reproduced the
exit code, reported it, and re-ran under the correct filter before opening the
PR. No merged story quoted a result produced by a filter that matched nothing.

## Files

| file | | why |
| ---- | - | --- |
| `.npmrc` | NEW | `fail-if-no-match=true` — the primary mechanism, global across every filtered command |
| `scripts/pkg-test.mjs` | NEW | canonical per-package test runner; names the filter that matched nothing, exports the workspace project list |
| `scripts/verify-test-commands.mjs` | NEW | the automated check behind AC-1/AC-2/AC-6; wired into root `pnpm test` |
| `package.json` | UPDATE | `test` now also runs `test:tooling`; adds `test:pkg` and `test:tooling` |
| `CLAUDE.md` | UPDATE | new `## Verification` section with the canonical command table |
| `docs/dev/epic-5/5.9-.../AUDIT.md` | NEW | AC-3 finding record |
| `docs/dev/epic-5/5.9-.../MANUAL_TESTING.md` | NEW | the wrong-filter demonstration, executed with exit codes |
| `docs/implementation-artifacts/epic-5-onboarding/5.9-....md` | UPDATE | this story's own tasks + Dev Agent Record |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's own row |

## Decisions worth knowing

- **Root `pnpm test` changed meaning**, from `pnpm -r test` to
  `pnpm -r test && pnpm test:tooling`. Every gate in this project runs
  `pnpm test`, so that is the only wiring that makes the check unavoidable. It
  runs after the package suites, so a red suite masks it — accepted, because
  ordering it first would tax every run and it is the cheaper thing to lose in
  a run that is already failing.
- **No frozen artifact was corrected**, including the one instruction that is
  still live and still wrong: `5.5-viz-history-window.md:90–91` tells its agent
  to run `pnpm --filter @gitnebula/cli test`. 5.5 is merged, and the record of
  what it was told to run is the evidence `AUDIT.md` is built from. It is
  defused rather than edited — that command now exits 1.
- **`docs/planning-artifacts/architecture.md:227`** is the template all six
  occurrences came from ("per-story test command
  `pnpm --filter @gitnebula/<module> test`") and is wrong for exactly one of
  the six modules. Frozen, so recorded in `AUDIT.md` and superseded by
  `CLAUDE.md`'s table rather than edited.

`AUDIT.md` carries the evidence behind the second and third points, including
the one detail of the story spec's own correction that did not survive
checking (4.6's merge time), and the limits of what a PR-body audit can claim.

## Reproducing any of it

```bash
pnpm test:tooling                     # the automated check, alone
pnpm test:pkg gitnebula               # the canonical way to run one package
pnpm test:pkg @gitnebula/cli          # exit 1, names the filter
pnpm --filter @gitnebula/cli test     # exit 1 (was exit 0 before this branch)
```
