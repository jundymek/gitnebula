# Audit — the stories that carried `pnpm --filter @gitnebula/cli test`

Finding record for AC-3 of story `5.9-repo-test-command-false-green`. It reads
what each story **claimed** and checks that claim against the package-rename
timeline. It is **not** a re-verification of merged code, and nothing in it
asks for merged work to be reopened.

## The timeline this is measured against

The cli package was `@gitnebula/cli` until commit `efeaceb`
(`feat(cli): prepare the package for its first npm release`, PR #48), which
renamed it to `gitnebula`.

```
$ git show efeaceb^:packages/cli/package.json | grep '"name"'
  "name": "@gitnebula/cli"
$ git show efeaceb:packages/cli/package.json | grep '"name"'
  "name": "gitnebula"
$ git log -1 --format='%ci' efeaceb
2026-08-14 10:26:44 +0200          # = 2026-08-14 08:26:44 UTC
```

Before that instant the filter named a real project and the suite ran. After
it, the filter matches nothing and — until this story — exited 0. So the
question for each story is only ever: **did its work merge before or after
2026-08-14 08:26 UTC?**

## Findings, one row per spec file

| # | spec file | PR(s) carrying the work | merged (UTC) | vs rename | cli result quoted in the PR body | verdict |
| - | --------- | ----------------------- | ------------ | --------- | -------------------------------- | ------- |
| 1 | `epic-3-exploration/3.2-cli-serve-url.md` | #19, #26 | 2026-08-13 08:30, 09:28 | before | yes — `pnpm --filter @gitnebula/cli test` → **114 passed** (10 files), and in #26 run 12 consecutive times | **suite ran.** Consistent |
| 2 | `epic-3-exploration/3.6-fixture-build-race.md` | #20, #29 | 2026-08-13 09:28, 10:25 | before | yes — the same filter, quoted as **3 failures in 8 runs** | **suite ran**, and provably: a filter matching nothing cannot produce a failure |
| 3 | `epic-4-ship-it/4.1-build-bundle.md` | #37 | 2026-08-13 19:29 | before | yes — **13 files, 140 tests passed**, plus a `viewer assets: 57.6 KB gzipped` line the suite prints | **suite ran.** Consistent |
| 4 | `epic-4-ship-it/4.6-docs-path-drift.md` | #44 (epic integration #47, 07:44) | 2026-08-13 22:26 | before | yes, but sourced from root `pnpm test`: `Test Files 14 passed (14)` / `Tests 141 passed (141)` | **suite ran.** Immune either way — `pnpm -r` reaches the package by path, not by filter |
| 5 | `epic-4-ship-it/epic-4-retrospective-addendum-4.5.md` | #49 | 2026-08-14 08:35 | 9 min **after** | yes, and already with the **corrected** filter: `pnpm --filter gitnebula test` → 15 files / **145 passed** | **suite ran.** The document that recorded the rename also used the new name |
| 6 | `epic-5-onboarding/5.5-viz-history-window.md` | #54 | 2026-08-15 17:03 | after | the false filter is **not** quoted as a result; the PR body reports it as a defect and quotes `pnpm --filter gitnebula test` → **145 passed** | **the only live exposure — caught before merge.** No false claim shipped |

## What the audit concludes

**No merged story quoted a test result produced by a filter that matched
nothing.** Rows 1–4 ran while the filter was correct. Row 5 ran nine minutes
after the rename and had already switched to the new name. Row 6 is the one
story that was exposed, and its agent (`rambo`) reproduced the exit code,
reported it, and re-ran under the correct filter before opening the PR.

The honest finding is the narrow one the story's own correction predicted:
**one story, caught before merge.** The five older occurrences are *stale
today, not false when run*.

That does not make the defect cosmetic. Until this branch, the command in
those specs could not fail, so it could not pass either — and any spec written
tomorrow that copied it would have shipped a decorative test gate. That is
what AC-1's mechanism closes.

## Where the string actually survives, and what was done about it

Worth separating from the verdicts above, because the spec's provenance
section counts *file occurrences* and the binding line is what an agent
follows:

- The **binding `Test command:` line** carries the stale filter in **none** of
  the six files today. Story 4.5 already corrected it in 3.2 and 4.1 (recorded
  as its own observation 4 / debt item 9 in the epic-4 addendum); 3.6 and 4.6
  specify `pnpm test`; 5.5 specifies `pnpm --filter @gitnebula/viz test`.
- The surviving occurrences in rows 1–4 are in **Dev Agent Record prose** —
  a record of what that agent ran at the time, which was correct at the time.
  Rewriting them would destroy the evidence this audit is built from.
- The one **live instruction** is `5.5-viz-history-window.md:90–91`: "*Because
  this story touches `packages/cli` wording, also run
  `pnpm --filter @gitnebula/cli test` before opening the PR.*" It is not
  edited — 5.5 is complete and frozen. It is *defused*: with
  `fail-if-no-match=true` that command now exits 1 and says the filter matched
  nothing, instead of exiting 0 in silence.

## Two stale statements in frozen artifacts, recorded not corrected

Both name `@gitnebula/cli` as a live fact. `CLAUDE.md`'s append-only rule
covers them, so they are listed here rather than edited:

- `docs/planning-artifacts/architecture.md:227` — "per-story test command
  `pnpm --filter @gitnebula/<module> test`". This is the template the six
  occurrences came from, and it is wrong for exactly one of the six modules.
  `CLAUDE.md`'s new canonical table is the live replacement.
- `docs/planning-artifacts/architecture.md:17` — already logged as **open debt
  item 10** in `epic-4-retrospective-addendum-4.5.md:143`, for the same reason.

## Limits of this audit

- **PR bodies are self-reported.** The audit checks what was claimed for
  internal consistency (file counts, tool-printed lines, failure counts) and
  against the rename timeline. It does not re-execute the merged suites.
- **Row 4's timing is stated two ways in the record.** This story's spec
  correction dates 4.6 at 07:44 UTC via PR #47; PR #47 is the epic-4 →
  `master` integration merge, while 4.6's own story PR is #44 at 2026-08-13
  22:26 UTC. Both are before the rename, so the verdict is unaffected either
  way, and both numbers are given above rather than one being silently chosen.
- **Rows 1 and 2 each carry two PRs** (an implementation PR and a follow-up
  fix). Both were read; the table quotes the strongest claim from each pair.
- The audit covers the six spec files the story names. A workspace-wide sweep
  for other stale filters is not in scope; the `.npmrc` setting covers them
  behaviourally regardless of where they are written down.
