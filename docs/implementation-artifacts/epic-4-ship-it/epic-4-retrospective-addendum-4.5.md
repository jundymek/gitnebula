# Epic 4 retrospective — addendum: the closing wave (4.5-npm-release)

Written by the supervisor (`superman`) of `epic/4-npm-release` on 2026-08-14,
at the closure of the one-story wave that finished Epic 4. It is an addendum
rather than a replacement: `epic-4-retrospective.md` was written on 2026-08-13
at the 4.1–4.4 closure and deliberately left DoD item 1 open pending this
story. That file stands; this one records what the closing wave added and
resolves the parts of it that were left conditional.

## Delivery summary

| | Wave C (this one) | Epic 4, waves A+B |
| --- | --- | --- |
| Stories | 1 (`4.5-npm-release`, owner `cli`) | 3 shipped + 4.2 deferred |
| Agents | alice, supervised by superman | alice, bob, pamela |
| Wall clock | 07:49:36Z launch → 08:26:44Z merge — **37 minutes** | 6 h 34 m |
| PRs | 1 story (#48), merged; plus this supervisor deliverable | 5 |
| Supervisor verdicts | **1 stamped: ready**, first pass, no needs-work round | 5: 3 ready, 2 needs-work |
| Codex findings | **0** — clean on the first review, no re-rounds | ≈12 |
| Test count | **918** across six packages at this head, per the agent's run; the supervisor independently re-ran `pnpm --filter gitnebula test` (145 passed, 15 files) | 899 passed, 2 skipped |
| Epic head | `efeaceb`, tree byte-identical to the branch that was verdicted | `ef0f6f0` |

Planned vs actual merge order: one story, no ordering constraint to hold. The
spec's `depends_on: [4.4-dod-validation]` was already satisfied on `master`
before launch, so nothing waited.

**M3 and DoD item 1.** DoD item 1 stops being *pending a story* and becomes
*pending the maintainer*: the package is prepared, proven and versioned
`gitnebula@0.1.0`, and only `npm publish` is left. That is AC-7, an owner gate
by design. DoD item 6 (CI green, Pages) is unchanged — still partial, still
4.2's, still blocked on Actions billing.

## Post-run observations

### 1. The story's stated scope was one defect; the branch found three

AC-6 was written around a Python repository, because that is how story 4.4
found it: `prepack.mjs` populates `packages/cli/assets/` and npm runs it only
on pack/publish, so a dev checkout's binary died on the first Python file.
What the branch actually found was that a dev checkout could not serve a map
**at all**, whatever the repository contained, and that the error printed
named the wrong cause — it told the reader to build the viewer, while the
viewer was built. `resolveVizDist()`'s workspace fallback had been spelled for
the source layout only, so for the binary at `dist/bin/` there was no fallback
at all.

**Why no story caught it:** 4.4 found the symptom it happened to hit and
reported rather than patched, correctly — it was not that story's file. The
other two thirds were only reachable by running the built binary from a dev
checkout, which no story's manual testing did until this one.

**Fix:** landed here. The widening was carried to the agent as a verbal brief
at launch rather than as a spec amendment, so the spec's AC text is untouched
and the widening is recorded in the agent's `DECISIONS.md` (D-2), its
Completion Notes and the PR body. That is the cheaper of the two routes and it
worked, but it only works because the agent wrote it down in three places
without being asked to.

### 2. The build-order change touches AD-11, and the PR argued it rather than hiding it

`packages/cli`'s `build` is now `tsup && node scripts/assemble-assets.mjs`, and
the workspace `build` runs viz before cli. The two build edges are therefore
**ordered** — cli's edge consumes viz's output. It is still exactly two edges,
and the assets step copies rather than compiles, which is why it aborts by
name instead of building its inputs. The PR body states the cost against AD-11
in those terms and names the alternative it rejected (a root-level third step,
rejected because `pnpm --filter gitnebula build` would still produce the
half-built binary this story exists to kill).

This is the behaviour the rules ask for and it is worth recording as such: an
architectural decision was touched, and the reader of the merge commit can see
that it was touched, by whom, and with what argument.

### 3. A test that would have been handed a spurious pass

`dev-checkout.test.ts` asserts what `pnpm build` *left behind*. A concurrent
`npm pack` in another vitest worker repopulates `assets/` and would hand it a
green it did not earn. The branch factored `test-support.ts`'s build lock into
`withBuildLock`/`withBuildLockAsync` and put `pack.test.ts`'s `pack()` under it
too. The test was watched failing first, and by hand as well, because its first
assertion short-circuits the rest.

### 4. The frozen-artifact rule and an AC collided, and the collision was flagged rather than resolved silently

AC-2 requires sweeping every in-repo reference to the old package name and
names "story specs' test commands" explicitly. Four **frozen** specs (2.4,
3.2, 4.1, 4.2) carry `pnpm --filter @gitnebula/cli test`, which resolves to
nothing after the rename. `CLAUDE.md` forbids rewriting frozen artifacts and
also states that a story spec wins over `CLAUDE.md` with the divergence
flagged. The agent changed the one `Test command:` line in each and raised it
in the PR body and the Dev Agent Record.

Both readings are defensible; the point is that neither was taken quietly. The
underlying tension is structural and will recur on any rename: a frozen
artifact that contains a *runnable instruction* is not purely a record.

## What we learned

- A spec written out of supervision (this one was, on 2026-08-13, from a
  finding on PR #37) can be handed to an agent unchanged four weeks-worth of
  waves later and still be complete enough to work from. Its Provenance
  section is what made the widening in observation 1 legible rather than
  confusing.
- The one-story wave is cheap: 37 minutes, one codex round, one verdict. Most
  of the cost in earlier waves was coordination between concurrent agents and
  the rebases that followed each other's merges.
- Owner gates continue to hold: AC-7 was left unticked, and the two
  unexecutable manual-testing steps (`npx` from the real registry, the rendered
  npm page) were left unchecked **with reasons**, not quietly ticked.

## What went well

- **Verdict on the first pass.** No needs-work round, no re-verdict after a
  rebase.
- **Codex clean on the first review**, and the agent read its test-run failures
  correctly: 20 `listen EPERM` errors from the sandbox denying loopback binds,
  not defects in the diff.
- **The manual testing was executed, not merely written** — 16 of 18 steps with
  results recorded inline, including a cold `npm install` of the tarball into
  an empty temp directory and an `npx` run in an unrelated repository.
- **Independent verification reproduced the substance, not just the summary
  line.** The supervisor re-ran the cli suite (145 passed) and, separately,
  built a Python repository from scratch and ran the dev-checkout binary
  against it: 7 nodes, 2 edges, both an absolute and a relative Python import
  resolved, `import os` correctly classified external. AC-6 is closed in
  behaviour, not only in prose.

## Technical debt carried forward

Renumbered against the parent retrospective's table.

| # | Debt | Status after this wave |
| --- | --- | --- |
| 1 | Documented commands naming a non-existent binary path | **Closed** by 4.6 (merged before this wave) |
| 2 | `npx gitnebula` resolves to nothing | **Closed in the repository, open on the registry** — the package is prepared and versioned; the publish is the maintainer's (AC-7) |
| 3 | Dev checkout cannot analyse with its own built binary | **Closed** — and it was wider than recorded (observation 1) |
| 4 | CI `workflow_dispatch`-only; no Pages; DoD item 6 partial | **Open** — 4.2, deferred on Actions billing |
| 5 | Human-only verification unwalked | **Open**, and this wave adds two more steps (both AC-7's) |
| 6 | `sprint-status.sh` cannot read this project's dot-separated keys | **Closed** — verified at this closure: the script read `4.5-npm-release` and wrote the row without an error |
| 7 | The `epic-4:` milestone line is unset | **Open** — supervisor-reported, maintainer-written |
| 8 | Epic 3 debt items 3, 4, 5 | **Open**, carried again |
| 9 | Four frozen specs now edited for a rename (observation 4) | **Open decision** for the maintainer: keep or revert |
| 10 | `docs/planning-artifacts/architecture.md:17` still names `@gitnebula/cli` when describing the current package graph | **Open** — frozen artifact, so left; it now reads as a stale live statement |

## Next-epic readiness

There is no Epic 5. After this merge the repository is in the state the brief
describes, with two things outside it: the npm publish (owner, minutes) and
4.2's CI/Pages recipe (blocked on billing). Nothing in the codebase is waiting
on another story.

## Action items

| # | Action | Owner |
| --- | --- | --- |
| 1 | Merge the Epic 4 integration PR into `master` | maintainer |
| 2 | `npm publish` + `git tag v0.1.0` from a clean checkout of the merged base; the exact sequence is in PR #48's body | maintainer |
| 3 | After publishing, close MANUAL_TESTING steps C4 and E3 (`npx` from the real registry; the rendered npm page) | maintainer |
| 4 | Decide the frozen-spec question (observation 4): keep the four one-line edits or revert them | maintainer |
| 5 | Set the `epic-4:` milestone line (and `epic-2:`, `epic-3:`) in `sprint-status.yaml` | maintainer |
| 6 | Decide and state the M3 wording, now that DoD item 1 turns on a publish rather than a story | maintainer |
| 7 | Correct the gitnebula supervisor delta: it states this project has no retrospectives on disk and directs the supervisor to create `docs/findings/` — two retrospectives exist under `docs/implementation-artifacts/`, and this addendum follows them instead | maintainer (harness) |
| 8 | State the working directory for `make sprint-status` in the supervisor brief — the target lives in the harness install, not in the supervised project, and reads as a missing artifact from a project worktree | maintainer (harness) |
| 9 | Walk the human-review checklist in `docs/dod-report.md` and the unticked steps in 4.1's and 4.3's `MANUAL_TESTING.md` | maintainer |

## Follow-through on the parent retrospective's action items

| # | Epic 4 (waves A+B) action | Status |
| --- | --- | --- |
| 1 | Land 4.6, then merge the integration PR into `master` | 4.6 **done** (#44/#47); the merge is carried as action item 1 above |
| 2 | Walk the human-review checklist | **Open**, carried as item 9 |
| 3 | Decide the M3 wording | **Open**, carried as item 6, and now sharper: item 1 hangs on a publish, not a story |
| 4 | Schedule `4.5-npm-release` before the npm name is taken | **Done** — launched and merged this wave; the name was still free on 2026-08-14 (registry 404) |
| 5 | Set the `epic-4:` milestone line | **Open**, carried as item 5 |
| 6 | Teach `sprint-status.sh` this project's dot-separated keys | **Done** — verified working at this closure |
| 7 | Detect a dead agent session | **Not exercised** this wave — 37 minutes, no idle period long enough to test it |
| 8 | Record a supervisor delta for this project | **Done, and now needs a correction** — the delta exists and was used throughout; two of its facts are wrong, carried as items 7 and 8 |
| 9 | State the `review`-at-PR / `done`-at-closure rule in `CLAUDE.md` | **Not done** — the agent nevertheless wrote `review`, not `done`, so the rule held by practice this wave |
| 10 | Make `sprint-status.yaml` supervisor-written only | **Held this wave** — the agent wrote only its own row, to `review`; the supervisor wrote `done` once, at closure, from measurement |
