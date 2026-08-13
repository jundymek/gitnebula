# Epic 4 retrospective — Ship It

Written by the supervisor (`superman`) of `epic/4-build-bundle` on 2026-08-13,
at epic closure. It follows the structure established by
`docs/implementation-artifacts/epic-3-exploration/epic-3-retrospective.md`.

## Delivery summary

| | Epic 4 | Epic 3 |
| --- | --- | --- |
| Stories | 3 shipped (4.1 cli/bundle+package, 4.3 cli/README, 4.4 cli/DoD) + **4.2 deferred by the maintainer** | 6 |
| Agents | alice, bob, pamela — one per story, supervised by superman | 6 |
| Wall clock | 13:38:28Z launch → 20:12:46Z last merge — **6 h 34 m**, of which **4 h 25 m was one dead session** (observation 2) | 2 h 28 m |
| PRs | **5 opened, 5 merged**, 0 abandoned (3 story + 2 supervisor deliverables) | 11 |
| Planned vs actual merge order | 4.3 → 4.1 → 4.4, with the two supervisor PRs interleaved. The one hard constraint (4.4 needs 4.1's bundle) held: pamela waited on `alice:done` and measured against the merged base | the one real constraint held |
| Supervisor verdicts | **5 stamped: 3 ready, 2 needs-work** (alice ×1, pamela ×1). Both needs-work were the same defect — a `done` status row written before merge — and both were fixed and re-verdicted within minutes | 14: 11 ready, 3 needs-work |
| Codex findings | **≈12 across the epic**, every one fixed except a single argued dismissal on 4.3. alice's branch alone took five review rounds, the first four each finding something real | ≥ 20 |
| Test count | 867 at Epic 3 head → **899 passed, 2 skipped** at Epic 4 head | 576 → 867 |
| Epic head | `ef0f6f0`: lint, typecheck (six packages), build and `pnpm test` all clean, verified in the supervisor's own worktree | `2e19d43` |

M3 — *"Epic 4 merged: MVP DoD executed and recorded on fastapi, excalidraw,
streamlit"* — is **executed and recorded, but not fully closed**: 4.2 is
deferred, so DoD item 6 (CI green, map-of-itself on Pages) stays partial, and
item 1 stays partial until 4.5 publishes the package. `docs/dod-report.md`
states this in its own verdict rather than leaving it to be inferred.

## Post-run observations

### 1. The epic's only integration defect was invisible to every per-PR review

Story 4.1 moved the built binary to `dist/bin/gitnebula.js`, for a reason its
`tsup.config.ts` documents: the grammar `.wasm` resolves two directories up
from the emitting module, so a binary at `dist/` resolves outside the package
and dies on the first Python file. Story 4.3 wrote `README.md`,
`CONTRIBUTING.md` and `docs/recording-demo.md` against the old path and merged
first. Both PRs were correct when written; the merge produced a README whose
one runnable command — the pre-release fallback, since `npx gitnebula` is not
published — fails with `ENOENT`.

**Why no story caught it:** each review looked at one branch against the base
as it stood then. Nothing in the project runs against the merged result until
somebody does it by hand, and that somebody was the closure review, after all
three merges.

**Fix:** story `4.6-docs-path-drift`, specced at closure on the maintainer's
instruction. Its AC-3 is the durable half — an automated check that fails when
a tracked Markdown file names a path under `packages/*/dist/` that does not
exist after `pnpm build`.

### 2. An agent died mid-turn and the harness could not tell it from one that was working

At 14:47:51Z alice's session ended with `API Error: Your computer went to
sleep mid-response`, having just acknowledged a supervisor instruction and
committed three unpushed commits. She sat at an empty prompt until 19:12Z —
**4 h 25 m, two thirds of the epic's wall clock.**

Nothing in the harness said so. `status.json` read `pr-opened`, which is not a
stalled phase. The poker pressed Enter five times and each attempt was logged
as a successful `poked`, because pressing Enter on an empty prompt succeeds —
no `poke-failed` was ever written, so the one signal the supervisor brief names
for this case never fired. Her tmux pane title still carried a spinner. The
only way to tell was reading her pane's scrollback, which is not in the
supervisor's list of sources, and comparing her worktree HEAD against origin.

**Fix candidates:** treat "unread inbox + N pokes + no new event" as a distinct
condition; watch for a commit that exists locally and not on origin for more
than a few minutes; teach the poker that a poke into an idle prompt with unread
mail did not deliver anything.

### 3. My own deliverable PR cost the last agent a rebase — the brief warned me and I did it anyway

PR #38 (the 4.5 spec) merged mid-wave and added a `4.5-npm-release` row
directly beneath the `4.4-dod-validation` line pamela was editing. Her PR #39
went `CONFLICTING` within the hour. The supervisor brief's §8d says exactly
this: a status write during a wave buys every remaining agent a rebase, which
is why the closure write waits until nobody is working.

The spec itself was worth writing when the evidence was fresh. The **status
row** was not urgent and could have waited for closure with the rest.

### 4. `sprint-status.sh` cannot write to this project's status file at all

The script derives dash-separated keys (`4-1-build-bundle`) while this
repository's file has used dot-separated keys since Epic 1
(`4.1-build-bundle`). It halts on the first row, reports the mismatch and
writes nothing — the safe failure, but it means the measurement the brief
relies on does not exist here, and every closure edit in this project's history
has been by hand. This retrospective's row flips are hand edits for that
reason, with the merged PR numbers quoted.

### 5. Two of three agents wrote `done` into the status file before their PR merged

alice (PR #37) and pamela (PR #39) both did it; bob wrote `review`. In this
repository `done` means merged, and the convention lives only in the file's own
history (`ec82d35` sets `review` at PR time, `45f0943` flips a whole epic to
`done` at closure). No spec states it, and 4.4's AC-5 says only that rows are
"flipped by their owners", which reads as permission to write the final value.

Both were caught in review and fixed in one commit each, but two of three
agents making the same mistake is a documentation defect, not an agent defect.

### 6. Epic 3's debt item 1 was real, and the story spec was never amended

Epic 3's retrospective recorded that the built cli aborts on any repository
containing Python because tsup relocates `web-tree-sitter`'s runtime `.wasm`,
and its action item 2 asked the maintainer to add that to 4.1's AC-4 before an
agent read the spec. The spec was not amended. alice hit it anyway — AC-4's
cold-install proof made it unmissable — and fixed it by making the package
external. The debt was paid, but by luck of a well-written AC rather than by
the hand-off working.

### 7. A gap that no story owned, found by the story next door

pamela discovered while measuring the DoD that a development checkout cannot
analyse a Python repository with its own built binary: `prepack.mjs` fills
`packages/cli/assets/`, npm runs it only on `pack`/`publish`, so `pnpm build`
leaves it empty. She reported it rather than patching someone else's file,
which was correct, and it then had no owner because 4.1 had merged. It is now
AC-6 of `4.5-npm-release`, added by supervisor amendment on the maintainer's
explicit waiver of the no-spec-edits rule.

### 8. The DoD report argued itself down, unprompted

Between the supervisor's two reviews of PR #39, pamela downgraded four of the
brief's seven DoD items from green to **partial**, each with the reason named
and none of them because a number came back short: an unpublished package, a
deferred story, and two owner judgements. She also re-measured through `npx`
itself rather than the installed binary, because `npx gitnebula` is the command
the DoD actually names. The report now separates *passing a threshold* from
*closing a DoD item*. Nobody asked for any of it.

### 9. CI stayed off, and the epic proved it did not need it to be honest

The maintainer's scope note forbade turning CI on. 4.1 wired its size and
zero-external-request checks into `ci.yml` as a dormant `bundle` job **and**
into the cli test suite, so the gate cannot rot while the workflow sleeps. 4.3
shipped the CI badge asserting no status, with one factual line about what CI
runs. No PR in the wave was gated on an Actions run, and no report quoted a run
URL that does not exist.

## What we learned

1. **Merges create defects that no branch review can see.** The only cure is a
   check that runs on the merged tree — 4.6's AC-3 is the first one this
   project will have.
2. **A silent agent is not a working agent.** Cross-check `status.json` against
   origin, not against the phase label.
3. **The supervisor's own writes are wave traffic too.** Deliverables that
   touch a shared file wait for closure, like everyone else's.
4. **A convention that lives only in git history will be broken by two agents
   out of three.**
5. **A well-written acceptance criterion catches what a hand-off drops.** 4.1's
   AC-4 forced the cold start that surfaced Epic 3's debt item nobody had
   transcribed into the spec.
6. **Honest partials are more useful than green ticks**, and an agent will
   produce them when the spec makes the distinction available.

## What went well

- **The dependency held without ceremony.** pamela waited on `alice:done`,
  scaffolded her report while blocked, and every number in it was measured
  against the merged base rather than promised.
- **Recovery after the dead session was clean.** alice returned to a
  four-and-a-half-hour-old context, pushed, re-ran codex to clean, rebased onto
  a base that had moved twice, and lost nothing.
- **Every review round found something real.** alice's branch took five codex
  rounds and the first four each caught a genuine defect, including a reuse
  rule that would have published one repository's map under another's name.
- **Independent verification reproduced the headline numbers.** The supervisor
  packed the branch, installed the tarball into an empty directory and re-ran
  fastapi at the pinned SHA: 1.15/1.16/1.20 s against a claimed 1.12 s median,
  and `analysis.json` byte-identical in size to the reported 1.32 MiB.
- **Nobody ticked an owner gate.** Three of them across the epic — 4.3's copy
  review, 4.4's checklist walk, 4.5's publish — all left unticked with reasons.

## Technical debt carried forward

| # | Debt | Where it belongs |
| --- | --- | --- |
| 1 | Three documented commands name a binary path that does not exist; README omits `gitnebula build` | `4.6-docs-path-drift`, specced, unassigned |
| 2 | `npx gitnebula` resolves to nothing — package still `private`, `@gitnebula/cli`, `0.0.0` | `4.5-npm-release`, specced, unassigned |
| 3 | A dev checkout cannot analyse a Python repository with its own built binary (`prepack` only runs on pack/publish) | `4.5-npm-release` AC-6 |
| 4 | CI is `workflow_dispatch`-only; no Pages deploy; DoD item 6 partial | `4.2-ci-pages-recipe`, deferred on Actions billing |
| 5 | Human-only verification unwalked: 4.3's copy review and browser steps, 4.4's full checklist | maintainer |
| 6 | `sprint-status.sh` cannot read this project's key format | harness |
| 7 | The `epic-4:` milestone line is unset, as `epic-2:` and `epic-3:` still are | maintainer |
| 8 | Epic 3 debt items 3, 4 and 5 (git stash across worktrees, hot-threshold question, layer dominance) remain open | carried again |

## Next-epic readiness

There is no Epic 5 in the plan. What remains before the product is genuinely
shippable is three unassigned stories — 4.2 (blocked on Actions billing), 4.5
(publish) and 4.6 (the stale paths) — and the maintainer's own walk of the
human-review checklist. 4.6 is the only one of the three that blocks the epic
reaching `master` in a state a visitor can follow.

## Action items

| # | Action | Owner |
| --- | --- | --- |
| 1 | Land `4.6-docs-path-drift`, then merge the Epic 4 integration PR into `master` | maintainer |
| 2 | Walk the human-review checklist in `docs/dod-report.md` and the unticked steps in 4.3's and 4.1's `MANUAL_TESTING.md` | maintainer |
| 3 | Decide and state the M3 wording: declared with CI off and no Pages, or held until 4.2 | maintainer |
| 4 | Schedule `4.5-npm-release`; the npm name `gitnebula` was free on 2026-08-13 and is worth claiming before someone else does | maintainer |
| 5 | Set the `epic-4:` milestone line (and `epic-2:`, `epic-3:`) in `sprint-status.yaml` | maintainer |
| 6 | Teach `sprint-status.sh` this project's dot-separated keys, or record the incompatibility in a supervisor delta | maintainer (harness) |
| 7 | Detect a dead agent session: unread inbox + repeated pokes + no new event, or commits ahead of origin for minutes (observation 2) | maintainer (harness) |
| 8 | Record a supervisor delta for this project — still absent, so every project fact was read from the repo again, and `make sprint-status` still does not exist here | maintainer (harness) |
| 9 | State the `review`-at-PR / `done`-at-closure rule in `CLAUDE.md`, where an agent will read it (observation 5) | maintainer |
| 10 | Make `sprint-status.yaml` supervisor-written only — carried from Epic 3's action item 10, and this epic supplies two more incidents for it | maintainer |

## Follow-through on the previous epic's action items

| # | Epic 3 action | Status |
| --- | --- | --- |
| 1 | Merge the Epic 3 integration PR into `master` | **Done** — `f1cac16` |
| 2 | Add the runtime `web-tree-sitter.wasm` to 4.1's AC-4 | **Not done** — the spec was never amended; 4.1's cold-start proof caught it anyway (observation 6) |
| 3 | Assert `harness-handle.ts` is absent from the shipped tarball | **Not done** — no assertion exists; the tarball's contents are asserted by `pack.test.ts`, but not this absence |
| 4 | Walk the unticked human-only steps from Epic 3 | **Open** — and Epic 4 adds three more such files |
| 5 | Set the `epic-3:` milestone line | **Open** — now three epics want it |
| 6 | Spec a root `typecheck` fanning out beside lint and test | **Done** — `pnpm typecheck` exists and runs in all six packages; verified at this epic's head |
| 7 | Document that `git stash` is shared across linked worktrees | **Open** |
| 8 | Invalidate a Codex verdict when HEAD stops containing the stamped commit | **Open** — not exercised this epic; every verdict happened to be re-run after its rebase |
| 9 | Record a supervisor delta for this project | **Open** — carried as action item 8 above |
| 10 | Consider making `sprint-status.yaml` supervisor-written only | **Open** — carried as action item 10 above, with two fresh incidents |
