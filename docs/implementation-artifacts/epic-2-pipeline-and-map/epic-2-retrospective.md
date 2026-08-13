# Epic 2 retrospective — Analysis Pipeline and Living Map

Written by the supervisor (`superman`) of `epic/2-scanner-core` on 2026-08-13, at
epic closure. It follows the structure established by
`docs/implementation-artifacts/epic-1-contract-foundations/epic-1-retrospective.md`.

## Delivery summary

| | | Epic 1 |
| --- | --- | --- |
| Stories | 5 (2.1 scanner, 2.2 deps, 2.3 githist, 2.4 cli, 2.5 viz) | 4 |
| Agents | alice, bob, pamela, arnold, rambo — one per story, supervised by superman | 4 |
| Wall clock | 15:02Z 08-11 launch → 07:36Z 08-13 last story merge — **40 h 34 m** | 5 h 08 m |
| …of which frozen on usage limits | **~36 h 30 m** (one daily, one weekly) | none |
| …active working time | **~4 h** | 5 h 08 m |
| PRs | 7 opened, 7 merged, 0 abandoned, 0 reverted (5 story + 2 supervisor deliverables) | 4 |
| Planned vs actual merge order | planned 2.1 first (2.4 depends on it); actual #10 deps → #11 scanner → #12 githist → #13 viz → #14 cli. The one real ordering constraint held. | identical to plan |
| Supervisor verdicts | 9 issued on story PRs: 8 × ready, 1 × needs-work (arnold, PR #14, stale Codex after a rebase) — resolved and re-verdicted within 6 minutes | 6 |
| Codex findings | 29 across the five stories (2.1: 4, 2.2: 4, 2.3: 8, 2.4: 12, 2.5: 6) — **29 fixed, 0 dismissed, 0 escalated** | 14 |
| Test count | 161 at Epic 1 head → **576** at Epic 2 head | 11 → 161 |
| Epic head | `7d35aff`: lint, typecheck, build clean; 576 tests pass **serially**; the workspace `pnpm test` command fails (see observation 1) | 41fb746 clean |

**M2 is met.** Verified on a clean scratch worktree at the merged epic head, fresh
install, no agent running: `gitnebula` analysing its own repository emits a valid
document — `238 nodes, 258 edges, 6 co-change pairs in 0.25 s`, exit 0 — and the
viewer renders the contract fixtures.

## Post-run observations

### 1. Four callers, one `rm -rf`: the workspace test command has never been reliable

**Symptom.** `pnpm test` from the root fails roughly half the time, alternating
between `githist/src/index.test.ts` and `scanner/src/fixture-repo.test.ts`. I
reproduced it 4 times out of 4 on a clean checkout of the merged epic head.

**Cause.** `test-fixtures/build-fixture-repo.sh` opens with `rm -rf` on a shared
directory and has four callers — the root `pretest` plus in-test rebuilds in
contract, githist and scanner. `pnpm -r test` runs packages in parallel, so one
package deletes the fixture repository while another reads it.

**Why no story caught it.** Each caller was added by a different story, each
reasonably: contract's in Epic 1, scanner's in 2.1, githist's in 2.3. Every
story's own gate is `pnpm --filter @gitnebula/<pkg> test`, which is unaffected
and passed honestly every time. The defect only exists in the union, and the
union has no owner.

**Fix.** Specced as `3.6-fixture-build-race`, merged in PR #15. It must land
before 4.2 turns CI on, because CI runs exactly the failing command.

### 2. The supervisor filed a real defect as an artefact of its own method

**Symptom.** Reviewing PR #12 I hit this same failure in pamela's worktree and
wrote it off in my report as my own interference, because I had run the suite
while she was running hers.

**Cause.** The interference was real — I *was* a fifth concurrent caller — and
that made the wrong conclusion comfortable. I stopped at the first sufficient
explanation instead of the correct one.

**Why no story caught it.** It was mine to catch, and both agents found it
independently while I had already dismissed it: arnold on a clean scratch
worktree at the unmodified epic head (3/3 failures), rambo with the quieter half
of the symptom (scanner silently dropping to 142 passed / 3 skipped).

**Fix.** Corrected in writing in the PR #13 report and in the 3.6 spec's own
provenance. The transferable rule: never run a suite in a live agent's worktree,
and when your own presence could explain a failure, reproduce it somewhere your
presence cannot.

### 3. A rebase silently invalidates a Codex verdict, and the gate cannot see it

**Symptom.** arnold's PR #14 sat with `codex_review = addressed` stamped against
a commit hash the rebase had rewritten and which no longer existed in the
branch's history, while the new head carried a source change to `cli.ts`.

**Cause.** The pre-PR gate enforces verdict freshness only on `gh pr create`. A
rebase after the PR is open moves every hash and nothing re-checks. arnold
correctly re-stamped *security* after the rebase and did not re-run Codex —
which is a natural mistake, because one of the two felt like a re-affirmation and
the other like a re-review.

**Why no story caught it.** It is invisible from inside a story: `status.json`
still reads `addressed`, and the field the agent looks at does not say against
what.

**Fix for now.** The supervisor checks `codex_review_commit` against HEAD on
every verdict, and re-verdicts when a head moves. That caught it here. A durable
fix would have the harness invalidate the verdict when HEAD stops containing the
stamped commit.

### 4. A relayed instruction raced a first-hand one, and the agent was right to stop

**Symptom.** I asked the owner whether 2.4's manual checklist should stay ticked,
was told "untick", and relayed that to arnold as an instruction. The owner had
meanwhile told him first-hand to keep them.

**Cause.** Two channels to the same human, no ordering between them.

**Why no story caught it.** Nothing to catch — it is a coordination hazard of
supervised mode itself, and it will recur any time the owner talks to an agent
directly while the supervisor is asking about the same thing.

**What went right, and is worth copying.** arnold refused to act on the
contradiction. He held the current state, named the conflict upward, explained
his reasoning (a first-hand later instruction outranks a relayed earlier one, and
unticking was the destructive direction — cheap later, expensive to undo),
declined to assume I had invented mine, and pre-specified the change in both
directions so that either answer cost ten minutes. The default failure mode here
is an agent quietly executing the last instruction it heard.

### 5. Two correct implementations produce a wrong picture

**Symptom.** On gitnebula's own repository, **89.1 % of nodes render hot**: churn
distribution over 238 nodes is 22 at zero, 3 below 0.25, 1 between 0.25 and 0.5,
172 between 0.5 and 0.75, and 40 above 0.75. Separately, the **module graph has 5
nodes and 0 edges**.

**Cause.** ADR-0003 normalizes churn against the P95 of same-kind nodes with at
least one commit — correct, and what 2.3 implements. UX-DR2 has a hot node render
`--hot` *replacing* its layer colour — correct, and what 2.5 implements. On a
young repository where nearly every file was touched inside the 90-day window,
the composition turns the whole nebula orange and the four-layer palette stops
carrying information. Likewise, the descent heuristic does not fire on
`packages/` (under the 0.7 share alice tuned against three demo repos), so every
import edge sits inside one module and 2.2 correctly emits no module-level edge
for it.

**Why no story caught it.** No story's acceptance criteria could. Each behaviour
is per spec; only the assembled epic shows the interaction, and only against a
real repository rather than the crafted fixture.

**Fix.** Not a code change to make blind. `HOT_THRESHOLD` is already
configurable; what is missing is evidence about its value on real repositories.
Both belong in front of a human — observation 5 is on the pending-owner list and
should join the 4.4 human-review checklist.

### 6. The fixture repository is too small to exercise what it certifies

**Symptom.** The AC-5 end-to-end snapshot in 2.4 shows 0 edges and 0 co-change
pairs, and 2.3's AC-6 snapshot shows an empty `cochanges` array.

**Cause.** The crafted history has one Python and one TypeScript file with no
import between them, and its only repeated file pair appears in 2 commits —
under ADR-0005's `count >= 3` bound. Both outputs are correct.

**Why no story caught it.** Both agents *did* catch it and both deliberately
declined to fix it, because `build-fixture-repo.sh`'s commit hashes are pinned by
the snapshots in 2.1, 2.3 and 2.4, so editing it mid-wave would have silently
invalidated three stories. That was the right call.

**Fix.** Confirmed harmless at closure: the real run produces 258 edges and 6
co-change pairs, so the code paths work and the gap was only in the fixture. A
sibling fixture repo with real imports and a repeated pair would close it
properly — a follow-up story, not a mid-wave edit.

## What we learned

**Peer coordination before implementation paid for itself, measurably.** bob
invented the `{ root, scan }` input envelope because a bare `ScanResult` cannot
open a file; arnold asked both remaining analyzer owners for their signatures
before coding; pamela named hers to match. The result: cli wired all three
analyzers with **no adaptation layer and no rework**, and arnold's own words were
that the envelope "matched structurally with no adaptation — agreeing the
signature through the inbox before implementation paid off." Three cross-story
interface questions were settled in about 90 seconds of messages each.

**Agents declining to fix things is a feature.** Three separate times an agent
found a defect outside its story and deliberately did not patch it — the fixture
race (twice), the fixture's co-change gap, the missing `--version` flag. Every
one of those restraint decisions was correct, and each came with a written reason
and an escalation. A cohort where everyone fixes everything they see produces
three conflicting fixes to one problem.

**A supervisor's own work needs the same gates.** Codex found three real defects
in the story spec I wrote, one of which was a contradiction between my own AC-2
and AC-3: I offered an implementer a choice whose first branch made the next
criterion unsatisfiable. Writing acceptance criteria is exactly as error-prone as
writing code, and I would not have caught it by re-reading.

**Verify where your presence cannot explain the result.** Observation 2, in one
line.

## What went well

- **Every Codex finding across five stories was real: 29 raised, 29 fixed, 0
  dismissed, 0 escalated.** Two were serious — a `DT_UNKNOWN` dirent fallback
  without which the scanner could skip an entire repository on FUSE or network
  mounts while reporting only a warning count, and githist's record framing
  breaking on paths containing `0x1e`.
- **Agents corrected their own PR bodies without being asked.** rambo refreshed
  #13's body because two figures had gone stale (141 → 148 tests, and the Codex
  tally); alice recorded a threshold change in three places rather than one.
- **Evidence beat assertion repeatedly.** bob's excalidraw measurement *failed*
  first at 21.2 % unresolved, and he changed the classification rather than the
  threshold after finding that not one of the 904 failures was a genuine miss.
  pamela reversed her own `--no-merges` decision when it turned out to bend a
  merged contract field. arnold kept two unflattering numbers (`0.00s` stage
  timings, an indicative rather than budget-checking benchmark) rather than
  rounding them.
- **The architecture's central bet held.** viz never imported an analyzer, its
  diff never touched one, and it was the only story that could have been written
  before any analyzer existed. AD-2 is doing real work.
- **`sprint-status.yaml` produced exactly one conflict** across five branches,
  and it resolved as the union, as the project's rule prescribes.

## Technical debt carried forward

| # | Item | Where |
| --- | --- | --- |
| 1 | The fixture-build race — `pnpm test` unreliable | `3.6-fixture-build-race` (specced, merged) |
| 2 | `packages/cli`'s conditional `pretest` workaround | removed by 3.6 AC-6 |
| 3 | Fixture repo cannot exercise co-change or import edges end to end | needs a sibling fixture repo; no story yet |
| 4 | The published binary has no `--version` flag | story 4.1 (AD-11) |
| 5 | Hot-threshold default swamps the layer palette on young repositories | needs a human decision; 4.4 checklist |
| 6 | Module derivation yields an edgeless graph on repos like this one | decide before 3.3 builds navigation on it |

## Next-epic readiness

Epic 3 is unblocked. 3.1 (Python deps) has bob's parser/resolver seam to slot
into; 3.3, 3.4 and 3.5 build against the GraphEngine interface rambo defined in
full — including the members he did not implement, which name their owning story
at runtime rather than throwing anonymously, so a premature call fails with a
sentence instead of a mystery.

Two things to settle before launching Epic 3: **3.6 should go first or early**,
since it repairs the command every other story's agent runs; and **observation 5
wants a decision**, because 3.3 and 3.4 build navigation and panel modes on top
of an encoding that currently renders 89 % of a real repository as hot.

The harness itself needs the two limits noted: this epic spent 36 of its 40 hours
frozen on usage limits, and in both cases the cohort did **not** self-resume when
the window reset — every agent sat at an idle REPL until the supervisor messaged
it. That is the single largest lever on wall-clock time available to this project.

## Action items

| # | Action | Owner |
| --- | --- | --- |
| 1 | Merge the Epic 2 integration PR into `master` | maintainer |
| 2 | Add `3.6-fixture-build-race` to `4.2-ci-pages-recipe`'s `Depends_on` (a supervisor may not edit an existing spec) | maintainer |
| 3 | Walk `2.5-viz-engine-core/MANUAL_TESTING.md` — 37 unticked steps, the visual match against `reference/mockup.html` | maintainer |
| 4 | Decide the hot-threshold question (observation 5) or schedule it for 4.4 | maintainer |
| 5 | Set the `epic-2:` milestone line in `sprint-status.yaml` | maintainer |
| 6 | Make a frozen cohort resume itself when the usage window resets, or nudge it automatically | maintainer (harness) |
| 7 | Invalidate a Codex verdict when HEAD stops containing the stamped commit (observation 3) | maintainer (harness) |
| 8 | Schedule 3.6 first or early in Epic 3 | Epic 3 planning |
| 9 | Spec a sibling fixture repo that exercises import edges and co-change end to end | Epic 3 planning |
| 10 | Carry the layer-dominance product question (streamlit's `frontend/`, gitnebula's own `packages/`) into 4.4 | Epic 4 (4.4) |

## Follow-through on the previous epic's action items

| # | Epic 1 action | Status |
| --- | --- | --- |
| 1 | Fix `spawn-agent.sh` to write the project's `DOCS_TASK_DIR` | **Done** — `DOCS_TASK_DIR='docs/dev'` is in the project profile and no story hit the docs gate this epic |
| 2 | Stop `TA_PROJECT` leaking into agent REPLs | **Done** — no agent-identity incident occurred |
| 3 | Derive the auto-review recorded state from its actual verdict | **Not done** — still live, and it cost pamela four consecutive `auto_review_findings` labels over reviews that found nothing actionable, plus the round trips to work out that the label was not a verdict |
| 4 | Treat `done` as terminal in the dead-REPL respawn watcher | **Done** — no respawn loop observed |
| 5 | Accept or reject the 1.4 perf verdict | **Done** — accepted (3755dcc), which released 2.5 |
| 6 | Reconcile the M1 milestone text with the CI-skip decision | **Not done** — M1 still reads "CI green" while CI is `workflow_dispatch`-only until 4.2 |
| 7 | Carry the githist `count >= 3` and scanner language-share obligations into 2.3 and 2.1 | **Done** — both implemented and tested (2.3 AC-3, 2.1 AC-5) |
| 8 | Consider a guard against NUL bytes in source | **Open** — still Epic 4 (4.3) |
