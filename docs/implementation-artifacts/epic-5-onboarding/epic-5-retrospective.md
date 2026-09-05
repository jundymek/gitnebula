# Epic 5 retrospective — Onboarding-First Map

Written on 2026-09-05, after the fact, by the maintainer's session rather than
by the epic's supervisor. It follows the structure established by
`docs/implementation-artifacts/epic-4-ship-it/epic-4-retrospective.md`.

**Why it is late, and why that is not an oversight.** Epic 5 ran at supervisor
stage 2; writing a retrospective is a stage 3 permission. PR #71 says so in its
own "Known issues" section and names where the material went instead: *"the
material — the four defects above, three merge-race losses, my own `ready`
verdict on #67 that missed an ADR-0006 violation, and three sprint rows the
measurement could not derive — is in the supervisor's reports file."* That
reports file no longer exists: `/Users/jundymek/dev/gitnebula-agents/` was
emptied on 2026-08-17 and holds nothing but a `.DS_Store`. **Everything below
is reconstructed from artifacts that survived inside the repository** — commit
messages, PR bodies, story specs and `docs/dev/epic-5/` records — plus a fresh
run of the gates. Where the supervisor's own account would have been the
source, that is marked.

The immediate reason to write it now is that Epic 6 is being planned and epics
1–4 each handed their successor a "next-epic readiness" statement. Epic 5 did
not, and the Epic 6 planning handover (`docs/dev/epic-6-planning-handover.md`)
flags the absence as a loose end.

## Delivery summary

| | Epic 5 | Epic 4 |
| --- | --- | --- |
| Stories | **12 shipped** — 8 planned (5.1–5.8), **4 unplanned** (5.9, 5.10, 5.11, 5.12) | 3 shipped + 1 deferred |
| Agents | alice, bob, pamela, arnold, rambo, supervised by superman — **agents carried several stories each**, unlike one-per-story in epics 3 and 4 | alice, bob, pamela — one per story |
| Wall clock | planning `8797640` 2026-08-15 12:32Z → last story merge 2026-08-16 21:53Z — **≈33 h**, of which wave A was 15:05Z→17:10Z (**2 h 05 m**) | 6 h 34 m |
| PRs | **29 merged, 1 abandoned** (#60, the wave-A integration PR, superseded by #71) — 12 story + 8 author follow-ups + 9 supervisor deliverables | 5 opened, 5 merged |
| Planned vs actual merge order | wave A 5.1 → 5.3 → 5.2 → 5.5 → 5.4, wave B 5.9 → 5.6 → 5.7 → 5.8, then four corrections. The one declared dependency (5.6 on 5.5) held as a base-state fact | the one hard constraint held |
| Supervisor verdicts | **not recoverable** — the reports file is gone. PR #71 admits one bad verdict: a `ready` stamp on #67 that missed an ADR-0006 violation | 5 stamped: 3 ready, 2 needs-work |
| Codex findings | **not recoverable in total.** 5.4's record alone documents **5 across three passes**, all real, one a regression introduced by the branch's own earlier fix | ≈12 across the epic |
| Test count | 899 at Epic 4 head → **1,346 passed / 2 skipped** at Epic 5 head. `viz` alone 383 → **806** | 867 → 899 |
| Epic size | **121 files, +23,776 / −280** | — |
| Epic head | `f8c9a71`: re-verified 2026-09-05 — `pnpm lint`, `pnpm typecheck` (six packages), `pnpm test` (1,346/2) and `pnpm build` all exit 0 | `ef0f6f0` |

Epic 5 carries **no milestone**. M1–M3 belong to epics 1, 2 and 4, and the
`epic-5:` line in `sprint-status.yaml` is unset — as `epic-2:`, `epic-3:` and
`epic-4:` still are. Four epics now want that line.

## Post-run observations

### 1. Four defects reached the epic branch that no test could have caught, and all four were found by looking at the product's output

This is the epic's defining fact and PR #71 states it plainly: *"Four defects,
none of which any test in the suite would have caught, each found by a person
or a tool reading the **output** rather than the code."*

- **start-here ranked by in-degree** put four barrels and a fixture helper in
  its top five — 342 lines of `export * from` — while the 1,694-line engine
  that actually explains the repository never appeared. **5.1's AC-1 passed
  while producing the wrong answer**: the criterion specified in-degree, so the
  hypothesis was wrong rather than the code. Fixed by 5.11 as
  `importers × lines of code`.
- **one 40,655-line generated fixture swallowed the map.** `packages/` — the
  product's entire source — drew at **60.5% of total module area** and was
  labelled layer `test`, because a module's layer is its dominant layer by LOC
  (ADR-0002). Fixed in the scanner (5.12), deliberately not in the drawing
  code.
- **the 3D member layout diverged to ~1e13** on a 253-file module, so 3D drew
  60 of 254 nodes; the dense blur was residue near the camera. Found by
  building the occlusion measurement AC-8 never asked for. Occlusion went
  51.7% → 22.0% against a 2D control of 0.0%.
- **a NUL byte made our own layout engine scan as binary**, so the tool's first
  console output warned a stranger about our own source — and the byte
  suppressed `grep` on that file, hiding itself from the tools a reviewer would
  use to find it.

Three of the four were found by the **maintainer running the map by hand**. The
suite was green for all four, before and after.

### 2. A third of the epic was unplanned, and the plan was never amended to say so

`epics.md` describes Epic 5 as *"**Stories:** 8, in two waves"* and contains
exactly eight `### Story 5.x` headings. Twelve shipped. The four extra:

| story | origin |
| --- | --- |
| 5.9 test-command false green | supervisor, mid-wave-A, *"a defect no story owned"* |
| 5.10 NUL separator | supervisor, mid-wave-B, same class |
| 5.11 start-here ranking | agent's own spec, from the maintainer's pass over the running map |
| 5.12 scanner data blob | agent's own spec, delegated by peer message |

`epics.md` has not been touched since `8797640` on 2026-08-15 — the planning
commit itself. **The four unplanned stories carry no FR number, no epics.md
entry and no PRD trace**, so a third of Epic 5's delivered work is invisible to
the requirements documents. This is the same coverage-gap pattern epics 3 and 4
each produced (3.6, 3.8; 4.5, 4.6, 4.7), now at its largest.

Worth separating from the pattern: 5.11 handled its own supersession
**exactly as `CLAUDE.md` requires** — a new versioned file naming what it
supersedes, scoped to the one clause of 5.1's AC-1 that changed, with every
other criterion explicitly left standing. That is the frozen-artifact rule
working as designed.

### 3. FR-26..FR-33 are cited as PRD requirements and the PRD does not contain them

Nine Epic 5 specs cite `PRD FR-26` … `PRD FR-33`. The PRD stops at **FR-25**
and has not been modified since `225ec2f` on 2026-08-10. The requirements exist
only in `epics.md:73-80`, which declares them deliberately — *"Added
2026-08-15. These extend the inventory; FR-1..FR-25 are unchanged"* — and
records in its own frontmatter that the measurements justifying FR-29..FR-31
were taken in-session on a langgraph checkout rather than read from a document.

So the requirements are real, sourced and deliberate; **the citation label is
wrong**. Every spec points a reader at a document that does not contain the
requirement it names. This is a documentation defect, not a process failure —
but it is the kind that compounds, because Epic 6's specs will copy the
convention from Epic 5's.

### 4. Three commits that had passed review were lost to merge races, and one of them carried an ADR violation onto the epic branch

The mechanism is recorded in `8f0a650`: a merge click landing while a branch is
being force-pushed squashes an **intermediate head**, so commits that were
reviewed never reach the epic. It happened three times (#65, #66, #67).

The worst was #67. The commit `efe539a`, which restored viewport-scoped
unfolding, did not make the squash — *"the merge captured the branch one commit
earlier. The epic therefore carries the 3D engine with neither the viewport
scope nor the settle gate, which is the ADR-0006 violation that fix existed to
close."* The supervisor had stamped that PR `ready`.

It was caught only because the supervisor verified what merged against what he
verdicted — *"found by verifying the merge rather than assuming it"* — a check
PR #71 says exists precisely because of the earlier two losses. **The recovery
worked; the mechanism that caused it is untouched.**

### 5. Two agents independently wrote the same story id at the same time

5.12's provenance records it: the story was first written as `5.11`, and
`alice`, working in parallel, independently reached the same conclusion and
landed `5.11-viz-start-here-ranking.md`. The supervisor resolved the collision
*"by an explicitly arbitrary tie-break — her message arrived first"*.

Nothing allocates story ids. With agents empowered to spec the defects they
find — which this epic showed is valuable — id collision is a structural
consequence, not bad luck.

### 6. A test went green with the bug still present, and only a negative control caught it

From 5.4's record, on the second Codex finding: *"the first version of the test
for (2) went green **with the bug still present**, because the langgraph-shaped
fixture contains no node in the failing shape. Reverting the fix and watching
the test stay green is what caught it."*

The defect itself was substantial — a probe found **1,131** nodes on
`synthetic-100x2000` counted as connected while their only edge was dropped
from the scene. The lesson is about fixtures: **a fixture that does not contain
the failing shape makes the test a decoration**, and the only reliable detector
is watching the test fail first. This is the same class as story 5.9's
false-green, where a `--filter` matching no project exited 0 having run nothing.

### 7. The epic's real thesis: a check that can quietly report clean is not a check

Story 5.10 wrote that line, and it is the sentence Epic 5 should be remembered
for, because **four separate tools reported "clean" on inputs that were not**:

- **`grep -rlP '\x00'` returns nothing on a tree that contains a NUL byte.**
  Three people hit it: *"`bob` nearly reported the defect as non-reproducing on
  exactly this; `alice` lost an hour; `superman` a minute."*
- **`tr -dc '\0' < file` fails with `Illegal byte sequence` under a UTF-8
  locale** — 5.10's own first sweep *"silently listed two of the six NUL-bearing
  files until it was re-run under `LC_ALL=C`."*
- **`pnpm --filter <no match>` exits 0** having run nothing — story 5.9's
  false-green, where *"a story whose spec quoted a stale package name therefore
  satisfied its test obligation by running no tests."*
- **`git ls-files -z` decoded as UTF-8** would skip a file whose *name* is not
  valid UTF-8, in silence — found by Codex in review of 5.10's own sweep
  script, i.e. **the fix reintroduced the defect class it was written to
  close**.

5.10 generalised it into a design rule when it deliberately inverted its own
acceptance criterion: an allow-list of file types *"fails open — add a `.rs`
file tomorrow and the sweep skips it in silence"*, so it shipped a binary
deny-list that fails closed. And it refused to use git's own binary detection,
because *"Git calls a file binary because it contains a NUL, so that rule would
exclude from the sweep exactly the file the sweep exists to catch — the defect
in miniature."*

**This is the observation Epic 6 most needs**, because a browser test suite is
another tool that can report clean. See readiness §1.

### 8. Codex review found what agents and the supervisor did not, repeatedly

The counts that survive: **5.4 took at least five passes** (3 defects in the
first, 2 more in a second, 2 in a third, 1 P1 in a fifth), **5.7 reached at
least review round eight**, 5.8 had three documentation errors plus a vacuous
test caught, 5.10 the filename-encoding hole above, 5.6 a fixture missing a
required contract field that *"lint, test and build were all green while
`tsc --noEmit` was not."*

Two findings are worth quoting because they show the review catching things
tests structurally cannot:

- 5.4 hid the whole scope bar while idle, making connected-only unreachable
  from the default view. *"Caught by review, not by the suite — **the tests at
  the time asserted the bar hides, which is the mechanism, not the promise.**"*
- 5.4's fifth pass flagged a P1 the agent had knowingly declined, and the agent
  recorded being wrong: *"The reasoning for declining ('it widens the story into
  a file three agents are editing') was wrong on inspection: the whole change
  lives in this story's own code path."*

Set against observation 1 — where Codex caught nothing, because all four
defects were correct code answering the wrong question — this maps the review's
edge precisely. **Codex finds defects in code; only running the product finds
defects in hypotheses.**

### 9. "Report, don't patch" worked — and two of its handoffs still have no owner

The cohort rule that *"a defect outside a story does not get patched five
different ways in five branches"* was followed consistently, and it is why this
epic converted two found defects into shipped stories (5.9 from 5.5's
false-green filter, 5.10 from the NUL byte three agents tripped over). That is
the rule paying for itself.

But a report only works if somebody catches it. Two did not, and **both are
still open today**:

- **The legend has no key for the `other` layer.** 5.3 measured `other` as the
  *largest* layer on this repository — **145 of 363 nodes**, ahead of `backend`
  at 111 — and reported it to 5.5, whose territory the legend is. 5.5 declined
  it with a good reason: *"`other` and `infra` deliberately share one grey in
  `LAYER_COLOR`, so adding a fifth entry produces two identical swatches and
  needs a palette decision, not a line of code."* Verified 2026-09-05:
  `packages/viz/src/chrome/legend.ts:26-31` still lists exactly the mockup's
  five entries, and `other` is not among them. A reader gets an `other` toggle
  with no legend key.
- **`hiddenCount().visible` ignores the layer filter** when no scope and no
  connected-only filter is active — *"The interface documents the field as the
  survivors of every filter including layers, but the implementation
  short-circuits to `graph.nodes.length` on that path."* Found by 5.7 while
  building the degradation sweep, which *"read 2,100 for every sample"*. 5.7
  handed it to *"5.3/5.4"* — two stories that had already merged. It went to a
  pair of story ids rather than to a person or a row, so nobody received it.

Neither is large. The pattern is: **a report addressed to a merged story is
addressed to nobody**, and the epic had no place to put a defect that belonged
to no open branch. 5.9 and 5.10 survived precisely because the *supervisor*
picked them up and wrote specs; these two were handed peer-to-peer instead.

### 10. Concurrency shaped the code, not just the schedule

Six of the twelve stories record choosing a weaker or more awkward
implementation because four other agents held `engine/` and `chrome/` in the
same wave. The recurring artifacts:

- **New tests go in new files** — *"a new file is a merge neither branch can
  lose"* (5.2, 5.6).
- **Interface members were announced before being written.** 5.6's
  `setBlastRadius`/`getBlastRadius` is the model: 5.7's owner *"asked to be told
  before any interface member landed; they were told before a line of it was
  written, approved the exact signature, and implemented both in `engine3d.ts`
  on their own branch — so neither merge order leaves a hole."*
- **Deliberate duplication over a cross-branch import.** All four wave-A
  stories needed an empty-state convention; three copied it rather than
  importing 5.5's module, because that module *"does not exist on
  `epic/5-onboarding` until this PR merges, so a cross-branch import would
  leave their branches uncompilable"* — for a dependency none of them had
  declared (`Depends_on: []` on all four).
- **A partial fix rather than the right one.** 5.1 found that under
  `prefers-reduced-motion`, `settled` fires synchronously inside `engine.load()`
  before chrome subscribes, so `settling` stayed `true` for the whole session —
  disabling the 2.5 replay control for reduced-motion readers, a bug **older
  than the story**. It fixed only the initial value, because the real fix
  *"reaches outside this story's territory while four other agents hold
  `engine/` and `chrome/` in the same wave."*

This is the cost of the five-parallel-agent model, and it is mostly paid in
duplication rather than in defects — an acceptable trade that should be made
knowingly. The one piece of it that is still outstanding is 5.1's deferred
`settling` fix.

### 11. The epic's review left no trace in the public history

All 29 PRs carry **zero GitHub review comments**. Every codex pass, every
supervisor verdict, every needs-work round happened inside the harness and was
written to a file that has since been deleted. What survives is what agents
chose to write into commit bodies, PR descriptions and `docs/dev/` records —
which, to their credit, is a great deal.

For a project whose `CLAUDE.md` states that *"commit history is part of the
portfolio and must read cleanly to an outside observer"*, this is a real gap:
an outside observer sees twelve stories land with no visible scrutiny. It also
cost this retrospective its two most quotable metrics — verdict counts and
total codex findings — which epics 2, 3 and 4 all reported.

### 12. `docs/dod-report.md` was never re-run after Epic 5, and is now stale in a way that understates the product

The report's single commit is `ef0f6f0` (2026-08-13, story 4.4). It contains
**no mention of Epic 5**. Two of its statements are now false:

- DoD item 1 is `partial` because *"the package is `private`, `@gitnebula/cli`,
  0.0.0"*. It is now published: **`npm view gitnebula version` → 0.2.0**, tags
  `v0.1.0` and `v0.2.0` exist locally.
- Items 3 and 7 ("half measured", "visually sensible is an owner gate") were
  judged against the **pre-Epic-5 product** — before start-here, the hover fix,
  the layer filter, drill-down and the 3D view existed.

Separately, **NFR-13's evidence never reached the project level**. NFR-13
requires the 3D view to hold ≥ 55 fps or document its own measured floor; 5.7
measured it (**28 → 22 fps** on the unfolded 2,000-node fixture, knee between
840 and 1,260 drawn nodes) and the number lives only in
`docs/dev/epic-5/5.7-viz-3d-view/PERFORMANCE.md`.

### 13. The human-review checklist was bypassed rather than used, and now contradicts the product

On 2026-08-17 the maintainer walked the manual-testing items and ticked **34
boxes across nine files** (`f8c9a71`). The canonical
`docs/planning-artifacts/human-review-checklist.md` — the file the PRD §13.2.5
rule exists to keep as the single collection point — was **not touched**: 19
items, 0 ticked, sign-off blank, last modified 2026-08-10.

It also now contradicts the shipped product. Its item *"Hover dim/highlight
reads instantly at 2,000 files"* describes the behaviour **5.2 deliberately
replaced**, and `epics.md:897` had explicitly made correcting exactly that line
part of 5.8's job. 5.8 refreshed the README and `docs/` but did not sweep the
checklist. The 3D view has no visual-fidelity item at all.

So the review happened and the collection point missed it — which is the
failure mode the collection point was created to prevent.

### 14. Four manual-testing items remain unticked, all for environmental reasons

Counted directly: **234 ticked, 4 unticked** across eleven `MANUAL_TESTING.md`
files. The four are a non-UTF-8 filename (APFS refuses the name:
`[Errno 92] Illegal byte sequence`), a WebGL-less machine, a global
`npm install -g` this worktree may not perform, and one *"scrolling felt in a
browser"*. **None is a coverage gap an agent could close**, and each file
records why. This is the honest-partial discipline Epic 4 observation 8 praised,
holding two epics later.

## What we learned

1. **Green tests say nothing about whether the product answers the question.**
   Four defects, one of them a passing AC that specified the wrong metric, all
   found by reading output. A suite can only defend a hypothesis it was told.
2. **When agents are allowed to spec the defects they find, they will** — four
   stories, all worth shipping — **and the plan document will not notice.**
   Amending the epic is a separate act nobody owns.
3. **A merge race silently discards reviewed work.** Verifying that what merged
   is what was verdicted is the only defence that worked, and it is a manual
   habit rather than a mechanism.
4. **A fixture without the failing shape turns a test into a decoration.** The
   only reliable detector is watching the test go red first.
5. **Review that lives in the harness dies with the harness.** Only what agents
   wrote into the repository survived to be read here.
6. **A checklist people work around stops being a checklist.** The walk
   happened; the canonical file records that it did not.
7. **Requirements added at epic level, cited as PRD level, propagate the
   mislabel to every spec that copies the convention.**
8. **A check that can quietly report clean is not a check** — the epic's own
   sentence, earned four separate times. Prefer failing closed: a deny-list
   over an allow-list, a non-zero exit over an empty result set.
9. **Codex finds defects in code; only running the product finds defects in
   hypotheses.** Eight review rounds on one story caught real bugs and could not
   have caught any of observation 1's four.
10. **A report addressed to a merged story is addressed to nobody.** The two
    handoffs that went peer-to-peer are still open; the two the supervisor
    picked up became shipped stories.
11. **Five parallel agents cost duplication, not defects** — and the cohort paid
    it knowingly, in new files, pre-announced interfaces and copied conventions.

## What went well

- **The product genuinely changed.** The verdict that motivated the epic —
  *"a library like this has no real value for a developer"* on a 662-node
  langgraph pass — was answered: hover no longer dims 647 of 650 nodes, the map
  opens on a reading order, and 47.5% edgeless files can be filtered out.
- **The corrections were structural, not cosmetic.** The data-blob fix went
  into the scanner rather than the renderer, precisely because a drawing-side
  fix would have left the wrong layer label in place.
- **A defect was fixed at the layer that caused it even when that meant
  crossing a module boundary** — 5.12 is `Owner: scanner` in a viz-dominated
  epic.
- **The frozen-artifact rule worked under pressure.** 5.11 superseded a shipped
  AC with a new versioned file scoped to the one clause that changed.
- **Wave A was fast and clean**: five stories, disjoint territories, 2 h 05 m
  from first to last merge, no cross-story conflict.
- **Nobody ticked an owner gate.** AC-6 (README as a stranger) and AC-8 (is 3D
  worth switching to) both landed explicitly unticked, with the 3D cost
  published rather than buried.
- **The supervisor documented his own bad verdict** in the integration PR
  instead of leaving it to be found.

## Technical debt carried forward

| # | Debt | Where it belongs |
| --- | --- | --- |
| 1 | `epics.md` describes 8 stories; 12 shipped. 5.9–5.12 have no epic entry, no FR, no PRD trace | Epic 6 planning — append, do not rewrite |
| 2 | Nine specs cite `PRD FR-26..FR-33`; the PRD stops at FR-25 | Epic 6 planning: fix the citation convention before it is copied again |
| 3 | `docs/dod-report.md` never re-run after Epic 5; stale on the npm row, and items 3/7 judged against the pre-Epic-5 product | a DoD re-validation story |
| 4 | NFR-13's 3D frame-rate evidence lives only in 5.7's `PERFORMANCE.md`, not in any project-level report | same story as #3 |
| 5 | `human-review-checklist.md` unticked, unswept, and contradicts 5.2's shipped hover behaviour; no items for any Epic 5 feature | maintainer + a docs story |
| 6 | No UI behaviour is covered through a real browser — start-here, layer filter, drill-down, connected-only, blast radius, search, panel, 3D carry-over. Zero `data-testid` in `packages/viz/src` | **Epic 6's subject** |
| 7 | `topLevelLinks` and `topLevelLinks3D` are the same function twice, nothing keeping them in step. Both authors flagged it and argued against merging inside the epic | when a third caller appears |
| 7a | **The legend has no key for the `other` layer** — the largest layer here (145 of 363 nodes). Needs a palette decision: `other` and `infra` share one grey. Reported 5.3 → declined 5.5 → still open (observation 9) | a small `viz` story + a palette call |
| 7b | **`hiddenCount().visible` ignores the layer filter** on the no-scope/no-connected-only path, in both 2D and 3D engines. Handed to "5.3/5.4", both already merged (observation 9) | unowned; needs a row |
| 7c | 5.1's `settling` fix is partial: under `prefers-reduced-motion`, `settled` fires inside `engine.load()` before chrome subscribes. Only the initial value was fixed; the real fix needs a settle-state accessor on `GraphEngine` or a connect-before-load reorder | `viz`, when `engine/` is not contended |
| 7d | `MIN_COCHANGE_COUNT` restated in `viz` rather than imported from `contract` (same standing choice as `HOT_THRESHOLD`) | standing duplication, deliberate |
| 7e | `.csv`/`.tsv` carry no language-table entry, so 5.12's data-blob rule cannot reach them | recorded limit, not scheduled |
| 7f | `architecture.md:227` still gives `pnpm --filter @gitnebula/<module> test` as the per-story template — wrong for exactly one of six modules, and the source the six stale specs copied. Behaviourally defused by `.npmrc`, still wrong on the page | frozen artifact; supersede, don't rewrite |
| 8 | Merge races can drop reviewed commits; the ADR-0006 loss was caught by habit, not mechanism | harness |
| 9 | Nothing allocates story ids; two agents wrote `5.11` simultaneously | harness |
| 10 | Supervisor reports are outside the repo and were deleted; verdict and codex counts are unrecoverable for this epic | harness / process |
| 11 | CI still `workflow_dispatch`-only; DoD item 6 partial; `4.2-ci-pages-recipe` the only `backlog` row | `4.2`, on the billing decision |
| 12 | `epic-2:`, `epic-3:`, `epic-4:`, `epic-5:` milestone lines all unset | maintainer |
| 13 | `CLAUDE.md` still says *"Do not implement the `describe`/LLM layer in MVP"* — MVP has shipped, so the guard's precondition has expired | maintainer, scope decision |
| 14 | Epic 3 debt items 3, 4, 5 (git stash across worktrees, hot-threshold, layer dominance) — layer dominance was *exercised* by 5.12 but the question is still open | carried a third time |

## Next-epic readiness

**Epic 6 can start**, and the handover in `docs/dev/epic-6-planning-handover.md`
has already done its research. Three things from this retrospective feed it
directly:

1. **Debt item 6 is Epic 6's subject.** Observation 1 is the strongest possible
   argument for it and a warning about its limits in the same breath: a browser
   suite would have caught **none of the four defects**, because all four were
   wrong answers from correct code. Epic 6 should be scoped as *"nothing drives
   the chrome through a browser at all"* — not as *"tests would have caught
   Epic 5's bugs"*, which is false.
2. **The `pnpm test` question (handover §2b.3) has a precedent this
   retrospective can settle on evidence:** `perf` and `bundle-check` both live
   **outside** `pnpm test` as separate scripts, and `perf.yml` sets
   `continue-on-error: true` because hosted runners have no GPU. A UI suite
   that needs a browser follows that precedent unless a story argues otherwise.
   The decision still belongs to planning, not to a story agent.
3. **Observation 7 is the quality bar the new suite must clear.** A browser
   suite is exactly the kind of tool that can report clean: it can pass because
   the selector never matched, because the page never finished booting, because
   the fixture lacks the failing shape (observation 6), or because the assertion
   describes the mechanism rather than the promise (observation 8's scope-bar
   finding). The handover already records the house answers — negative controls
   are house style, `reuseExistingServer: false` exists because *"a green
   8-passed run traced by `lsof` to another checkout entirely"*, a missing
   fixture 404s loudly on purpose. **Epic 6 should make at least one acceptance
   criterion about the suite's ability to fail**, not only about what it covers.
4. **Observations 3 and 13 should be fixed *during* Epic 6 planning, not by
   it** — the FR citation convention and the human-review checklist sweep are
   cheap now and get more expensive with every epic that copies them. The
   checklist matters twice over here: it is where a browser suite's *un*automatable
   remainder belongs, so Epic 6 needs it healthy anyway.

Debt items 3, 4 and 5 (the stale DoD report, NFR-13's orphaned measurement, the
checklist) form a coherent small story that is **not** Epic 6's subject but
would close four partial DoD items. It is worth deciding whether it rides along.

Debt items 7a and 7b (the `other` legend key, `hiddenCount().visible`) are the
two orphaned handoffs. Both are small, both are in `viz`, and both are in
territory Epic 6's suite will drive — **7b in particular is a defect in a
readout a UI test would naturally assert against**, so it is worth fixing
before, not after, a test encodes the wrong number as expected.

## Action items

| # | Action | Owner |
| --- | --- | --- |
| 1 | Append an Epic 5 delivery record to `epics.md` covering 5.9–5.12 — append, never rewrite | Epic 6 planning |
| 2 | Decide how epic-level requirements are cited when the PRD does not carry them, and stop specs claiming `PRD FR-26+` | Epic 6 planning |
| 3 | Sweep `human-review-checklist.md`: delete the hover item 5.2 superseded, add items for start-here, layer filter, drill-down, blast radius and 3D, then record the 2026-08-17 walk in it | maintainer |
| 4 | Re-run or supersede `docs/dod-report.md` against the post-Epic-5 product; fold in NFR-13's 3D floor | maintainer / a story |
| 5 | Set `epic-2:`…`epic-5:` milestone lines in `sprint-status.yaml` — asked for by three previous retrospectives | maintainer |
| 6 | Settle whether a browser UI suite joins `pnpm test` or stays a separate script (see readiness §2) | Epic 6 planning |
| 7 | Decide the `describe`/LLM scope guard now that MVP has shipped | maintainer |
| 8 | Keep supervisor reports inside the repository, or copy them in at closure — this epic's are gone | maintainer (harness) |
| 9 | Prevent a merge click from squashing an intermediate head, or make the post-merge verification a gate rather than a habit | maintainer (harness) |
| 10 | Allocate story ids centrally when agents may write their own specs | maintainer (harness) |
| 11 | Run Epic 6 at supervisor stage 3 so its retrospective is written while the material exists | maintainer |
| 12 | Give the two orphaned handoffs a row: the `other` legend key (needs a palette call) and `hiddenCount().visible` ignoring the layer filter | Epic 6 planning |
| 13 | Give a found-defect report a destination that is not a merged story id — a backlog row, or the supervisor by default | maintainer (process) |
| 14 | Require at least one negative control per new suite in Epic 6's ACs, so the suite's ability to fail is itself verified (readiness §3) | Epic 6 planning |

## Follow-through on the previous epic's action items

| # | Epic 4 action | Status |
| --- | --- | --- |
| 1 | Land `4.6-docs-path-drift`, merge Epic 4 into `master` | **Done** — `9a67edf`, and 4.6 is `done` |
| 2 | Walk the human-review checklist and the unticked `MANUAL_TESTING.md` steps | **Partly done** — 34 boxes ticked on 2026-08-17 across nine Epic 5 files; the canonical checklist is still 0/19 (observation 9) |
| 3 | Decide and state the M3 wording | **Open** — M3's line is unchanged and `4.2` is still `backlog` |
| 4 | Schedule `4.5-npm-release` | **Done** — merged, and `gitnebula@0.2.0` is live on the registry |
| 5 | Set the `epic-4:` (and `epic-2:`, `epic-3:`) milestone lines | **Open** — now four epics want it |
| 6 | Teach `sprint-status.sh` this project's dot-separated keys | **Open** — Epic 5's rows for 5.11/5.12 were hand-written for a related reason: the script cannot derive a row from a branch named for its author's earlier story |
| 7 | Detect a dead agent session | **Not exercised** — no dead session this epic |
| 8 | Record a supervisor delta for this project | **Open** — carried a third time |
| 9 | State the `review`-at-PR / `done`-at-closure rule in `CLAUDE.md` | **Open** — not added; the convention held this epic anyway, with the supervisor writing rows at closure |
| 10 | Make `sprint-status.yaml` supervisor-written only | **Effectively done in practice** — the supervisor wrote the rows at closure (#64, #70, #75, #80); still not written down as a rule |
