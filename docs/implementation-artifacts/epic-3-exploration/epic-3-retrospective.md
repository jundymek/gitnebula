# Epic 3 retrospective — Full Exploration Experience

Written by the supervisor (`superman`) of `epic/3-deps-python` on 2026-08-13, at
epic closure. It follows the structure established by
`docs/implementation-artifacts/epic-2-pipeline-and-map/epic-2-retrospective.md`.

## Delivery summary

| | | Epic 2 |
| --- | --- | --- |
| Stories | 6 (3.1 deps/python, 3.2 cli/serve+url, 3.3 viz/navigation, 3.4 viz/panel+modes, 3.5 viz/export+perf, 3.6 repo/fixture-race) | 5 |
| Agents | alice, bob, pamela, arnold, rambo, chuck — one per story, supervised by superman | 5 |
| Wall clock | 07:57:55Z launch → 10:25:33Z last merge — **2 h 28 m** | 40 h 34 m (≈4 h active) |
| …frozen on usage limits | none | ~36 h 30 m |
| PRs | **11 opened, 11 merged**, 0 abandoned, 0 reverted (6 story + 3 author follow-ups + 2 supervisor deliverables) | 7 |
| Planned vs actual merge order | 3.2 → 3.1 → 3.3 → 3.5 → 3.4 → 3.6, with follow-ups interleaved. The one hard ordering constraint (3.4 depends on 3.3) held; 3.3 merged before 3.4 as required | the one real constraint held |
| Supervisor verdicts | **14 stamped: 11 ready, 3 needs-work** (arnold ×2, rambo ×1). Every needs-work was resolved and re-verdicted within minutes | 9: 8 ready, 1 needs-work |
| Codex findings | ≥ 20 across the epic; the largest single branch was 3.4 with 9 (7 fixed, 2 dismissed). Every dismissal carried a written reason and I accepted each | 29, all fixed |
| Test count | 576 at Epic 2 head → **867** at Epic 3 head | 161 → 576 |
| Epic head | `2e19d43`: 867 tests, lint, `pnpm -r typecheck` (six packages) and build all clean — and the workspace `pnpm test` command **is reliable again**, which it was not at the Epic 2 head | `7d35aff`, root `pnpm test` broken |

Epic 3 carries no milestone of its own; M1, M2 and M3 belong to Epics 1, 2 and 4.

## Post-run observations

### 1. Three defects reached the branch through code that was already merged and verdicted

3.2 merged with a flaky test (`clone.test.ts` snapshotting the shared system temp
directory) that failed 5 runs in 8. 3.3 merged with search fly-to that never
opened the panel. 3.6 merged having silently removed a safety property — its
stamp no-op meant a dirtied fixture tree survived where the old `rm -rf` had
always restored it.

None was caught by the story's own suite, its Codex review, or my verdict. All
three were caught by **another agent working next to the code afterwards**:
chuck found the flake while measuring his own runs, arnold found the fly-to
break while exercising his panel, and chuck found his own regression by thinking
about what his change had removed rather than what it had added.

The repair path that worked, three times, was the same: the **author** reopens
and fixes it in a second PR from the same story branch. bob (#26), pamela (#28)
and chuck (#29) each did that within roughly twenty minutes of the report.

**Why no story caught it:** each story's tests are written by the agent who
wrote the code, against the mental model that produced it. The first honest test
of that model is another agent using the result.

### 2. My own `ready` on PR #19 was wrong, and one green run is why

I verdicted 3.2 ready having run its suite **once**. The flake needed 8 runs to
show 5 failures. A single green run cannot distinguish a passing suite from a
50/50 one, and I treated it as evidence.

The rule I adopted mid-epic and applied for the rest of it: **anything touching
shared state — the filesystem, ports, temp directories — gets repeat runs before
a verdict.** It caught nothing further, but it is the reason the later verdicts
are worth more than the early ones.

### 3. Three separate environmental traps invalidated a measurement I had already made

Each looked exactly like a defect in the code under review:

- I ran the suite **inside chuck's worktree while he was mid-rebase** with
  conflict markers on disk. The red I saw was his conflict, not his PR. It was
  also a write into a peer's worktree, which I should not have done at all.
- A single **stale `gitnebula-clone-*` directory** left by one flaky failure made
  two other assertions fail deterministically, forever, on this machine. One
  flake poisoned every later run until someone removed the directory by hand.
- The perf harness **attached to another worktree's dev server** on its fixed
  port 4318 and reported a clean pass measuring rambo's live tree instead of the
  pushed branch. The first symptom was an unrelated-looking
  `Execution context was destroyed`; the second was a green run that was simply
  about the wrong code.

**Fix that landed:** rambo made the port overridable and stopped reusing a
foreign server, so a collision now fails loudly (#25). **Fix that did not:** the
first two are procedural, and the procedure is now "verify in a throwaway
worktree of the pushed branch, with an isolated `TMPDIR`, never in a peer's
checkout".

### 4. `pnpm test` does not typecheck, and nothing runs the typechecks together

arnold's branch carried a real type error through an entire story on a green
suite: `ChromeState` gained three fields and a test literal went short of the
type. vitest transpiles without checking, so the suite could not see it, and it
surfaced only because a rebase put the file in front of him.

Every package has a `typecheck` script. **Nothing runs them together.** So
`pnpm lint && pnpm test` — the bar this project's own rules set before a commit —
is blind to type errors by construction. It caught me too: every per-PR
verification I ran before that point was test + lint.

### 5. A rebase truncated a CSS rule, and nothing in the project could have seen it

arnold's rebase onto 3.3 left a CSS block without its closing brace, swallowing
the rules that followed. He found it by looking. The suite runs in jsdom and
never parses the stylesheet; lint does not either; the build parses it but
happily accepted the malformed result.

This is the argument for the freshness rule stated better than I stated it: when
I held his PR because Codex predated that rebase, the re-run found **two more
real user-visible bugs** — every click panned the map a few pixels, and a second
pointer's release ended the first pointer's drag.

### 6. A `done` agent that is blocked is indistinguishable from one that has finished

chuck read an authorisation, could not get his branch onto the merged epic head
(`reset --hard` denied by the operator, `merge` blocked by the classifier),
correctly refused to reach for `rebase --skip`, and stopped. From outside:
`phase=done`, `stop-fired`, silence. I reported it to the maintainer as 28
minutes of idleness. It was not idleness; it was a block with nowhere to be
recorded.

Nothing in `status.json` or `events.log` distinguishes "finished" from "stopped
because two commands were refused". The only place the outstanding work existed
was my own instruction ledger.

### 7. The browser found what the suite could not — and the suite could have, once you knew where to look

pamela's three most valuable defects (two in #24, one in #28) were all found by
driving a real Chrome. The fly-to bug was visible **only** under frame
throttling, which she had documented in `MANUAL_TESTING.md` as a limitation of
automated browser passes; the limitation turned out to be the detector.

Every one of them was reproducible in vitest afterwards. Her own conclusion is
the one worth keeping: *when the browser disagrees with a green suite, the suite
is testing the wrong instant.*

### 8. `git stash` is shared across linked worktrees

It lives in the common git dir, not per worktree. arnold's `stash pop` pulled
pamela's work-in-progress into his checkout with conflict markers. Nothing was
lost and all three now commit before rebasing, but this is harness-level
knowledge that currently survives only in two PR bodies.

### 9. `sprint-status.yaml` conflicted on nearly every merge, including mine

It is the one file where parallel stories meet textually, its rows are adjacent
lines, and every merge into the epic fired an `epic-updated` rebase at everyone
still working. My own supervisor PR hit the same conflict. The union rule works,
but the cost is a rebase per merge per agent — and a rebase invalidates a fresh
Codex verdict, which costs a review run too.

## What we learned

1. **A story's real test is the next agent.** Three merged-and-verdicted stories
   had defects found by peers within the hour. Design for that: the fastest
   repair is the author reopening, not a new story.
2. **One green run is not evidence** for anything touching shared state.
3. **Verify in your own throwaway checkout of the pushed branch.** Peer
   worktrees are mid-rebase, temp directories are polluted, fixed ports belong
   to somebody else.
4. **A gate that fails closed is not a verdict.** `auto_review_findings` means
   "unclassified", and twice on this epic the classification found real bugs.
5. **Freshness rules earn their keep on rebases**, not on paperwork.
6. **Green suite ≠ typechecked.**

## What went well

- **Cohort coordination.** The viz three agreed their territory in writing before
  any code, and it held through four rebases onto a moving base. The one
  predicted collision (`buildScene` vs `exportPNG`) resolved by their own written
  rule, with no conflict.
- **Hand-offs between stories.** arnold dropped his `load()` hunk to pamela
  because the lines sat in code she was rewriting; she took it with a test his
  version missed. rambo's fly-to audit leg, skipped while 3.3 was unmerged, went
  live on rebase with no edit.
- **Honest reporting under pressure.** chuck reported 7/10 rather than claiming
  ten. rambo re-measured after the rebase and published the drop
  (119 → 81–85 fps) instead of keeping the flattering pre-unfold row. arnold
  stated an AC unmet in his own PR body rather than ticking it.
- **Every dismissal was argued.** Not one Codex finding was waved away without a
  reason I could check.
- **The workspace test command is reliable again** — 3.6 fixed what Epic 2's
  retrospective recorded as its first observation.

## Technical debt carried forward

| # | Debt | Where it belongs |
| --- | --- | --- |
| 1 | Built cli aborts on any repo with Python in the universe — `dist/web-tree-sitter.wasm` is not copied by tsup. 4.1's AC-4 names the *grammar* wasm, not the runtime one | 4.1, spec edit needed first |
| 2 | No root `typecheck`; `pnpm lint && pnpm test` cannot see a type error | Epic 4, small story |
| 3 | `git stash` shared across worktrees — undocumented outside two PR bodies | harness docs |
| 4 | `sprint-status.yaml` as a per-story write target: one file, adjacent rows, a rebase for everyone per merge | process |
| 5 | Human-only verification across three viz stories (smoothness, drag feel, sustained fps on a real display, screen readers, reduced-motion preference, OS download) | maintainer, before 4.4 |
| 6 | `harness-handle.ts` publishes `{engine, settled}` on `globalThis` — must not reach the shipped tarball | 4.1, assert its absence |

## Next-epic readiness

Epic 4 can start. Its first story (4.1 build/bundle) inherits debt items 1 and 6,
and both need to be in its spec before an agent reads it — item 1 in particular,
because a literal implementation of AC-4 as written today copies the grammar and
still ships a broken binary.

## Action items

| # | Action | Owner |
| --- | --- | --- |
| 1 | Merge the Epic 3 integration PR into `master` | maintainer |
| 2 | Add `web-tree-sitter.wasm` (the runtime wasm) to `4.1-build-bundle`'s AC-4 — a supervisor may not edit an existing spec | maintainer |
| 3 | Add an assertion to 4.1 that `harness-handle.ts` is absent from the shipped tarball | maintainer |
| 4 | Walk the unticked human-only steps across 3.3, 3.4 and 3.5 `MANUAL_TESTING.md` | maintainer |
| 5 | Set the `epic-3:` milestone line in `sprint-status.yaml` | maintainer |
| 6 | Spec a root `typecheck` that fans out, wired next to lint and test | Epic 4 planning |
| 7 | Document that `git stash` is shared across linked worktrees | maintainer (harness) |
| 8 | Record a supervisor delta for this project (`config/projects/gitnebula/supervisor-delta.md`) — there is none, so every project fact had to be read from the repo, and two brief instructions (`block-loops.sh --record` without `--state`, `make sprint-status`) did not match reality | maintainer (harness) |
| 9 | Give a blocked `done` agent somewhere to say so (observation 6) | maintainer (harness) |
| 10 | Consider making `sprint-status.yaml` supervisor-written only, as the supervisor brief already assumes | maintainer |

## Follow-through on the previous epic's action items

| # | Epic 2 action | Status |
| --- | --- | --- |
| 1 | Merge the Epic 2 integration PR into `master` | **Done** — `bd9abd0` |
| 2 | Add `3.6-fixture-build-race` to `4.2`'s `Depends_on` | **Open** — still prose in 3.6's spec only; 3.6 is now merged, so the risk is reduced but the ordering is still unencoded |
| 3 | Walk `2.5-viz-engine-core/MANUAL_TESTING.md` (37 unticked steps) | **Open** — and Epic 3 adds three more such files |
| 4 | Decide the hot-threshold question | **Open** — carried to 4.4 |
| 5 | Set the `epic-2:` milestone line | **Open** — `epic-2:` and now `epic-3:` both want it |
| 6 | Make a frozen cohort resume itself | **Not exercised** — no usage freeze occurred this epic |
| 7 | Invalidate a Codex verdict when HEAD stops containing the stamped commit | **Not done** — and it cost this epic directly: I stamped two verdicts that a subsequent rebase made stale, and arnold's stale verdict was hiding two real bugs |
| 8 | Schedule 3.6 first or early in Epic 3 | **Done** — 3.6 ran in the wave and merged |
| 9 | Spec a sibling fixture repo exercising import edges and co-change | **Partly done** — 3.1 added `build-py-fixture-repo.sh`; co-change end-to-end is still unexercised |
| 10 | Carry the layer-dominance question into 4.4 | **Open** |
