# Epic 6 retrospective — The Assembled Viewer, Verified

Written on 2026-09-08 by `superman`, the supervisor of the epic's closing wave,
at stage 4. It follows the structure established by
`docs/implementation-artifacts/epic-5-onboarding/epic-5-retrospective.md`.

Unlike Epic 5's, this one is written by the supervisor rather than reconstructed
after the fact, and it covers both waves. Wave A ran before this session existed
and its account comes from the epic journal entry its supervisor left
(`~/.local/state/terminal-agents/epics/`, wave 1, 2026-09-08T15:13:25Z) — the
mechanism Epic 5's retrospective was written without, and the reason that one
had to say "not recoverable" in three rows of its delivery table.

## Delivery summary

| | Epic 6 | Epic 5 |
| --- | --- | --- |
| Stories | **5 shipped, 0 unplanned** — 6.1 and 6.5 in wave A, 6.2/6.3/6.4 in wave B | 12 shipped — 8 planned, 4 unplanned |
| Agents | wave A alice, bob; wave B alice, bob, pamela; both supervised by `superman` — one story each, no agent carried two | alice, bob, pamela, arnold, rambo — several stories each |
| Wall clock | specs `0c4ddc9` 2026-09-05 20:10Z → last story merge 2026-09-08 16:43:18Z. **Execution: wave A ≈2 h, wave B 15:32:33Z → 16:43:18Z = 1 h 11 m** | ≈33 h |
| PRs | **5 story PRs, 5 merged, 0 abandoned** — #81, #82, #83, #84, #85 — plus supervisor deliverables | 29 merged, 1 abandoned |
| Planned vs actual merge order | exactly as planned. Wave A 6.1 → 6.5; wave B held to the end and merged 6.3 → 6.2 → 6.4 in one 23-second window | wave order held; four later corrections |
| Supervisor verdicts | **5 stamped, 5 `ready`, 0 `needs work`** — and every quoted number re-run by the supervisor in the authoring worktree before the stamp | not recoverable; one bad `ready` admitted |
| Codex findings | **1 across the whole epic** — bob's P2 boot-race in his own helper, fixed and proven with an observed red run. alice and pamela: zero findings | not recoverable in total |
| Test count | `viz` 806 → **827** (wave A +21; wave B added none, by design). Browser suite **0 → 44** | `viz` 383 → 806 |
| Epic size | **56 files, +7,715 / −103** | 121 files, +23,776 / −280 |
| Epic head | `570094d`: `pnpm lint`, `pnpm typecheck`, `pnpm test` (viz 827, cli 145, 12 tooling checks) and `pnpm build` all exit 0, plus **44 passed** in the browser suite — verified on the merged tip in a throwaway worktree, not on any story branch | `f8c9a71` |

The 44 is the number worth keeping. No branch could produce it: 3 from 6.1,
plus 22 from 6.3, 9 from 6.2 and 10 from 6.4. It exists only after the merge,
which is the entire argument for verifying the assembled epic rather than
trusting five green branches.

Epic 6 carries **no milestone**, and this repository's `sprint-status.yaml` has
never had `epic-N:` rows at all — a detail Epic 5's retrospective got wrong when
it wrote that "the `epic-5:` line is unset, as `epic-2:`, `epic-3:` and
`epic-4:` still are". Those keys do not exist in the file. Nothing follows from
it; it is corrected here so the next reader does not go looking.

## Post-run observations

### 1. The epic's thesis held: four defects in shipped code were invisible to 827 jsdom tests

Story 6.2 introduced four defects into `packages/viz/src/` one at a time and ran
both suites against each. Every one failed exactly one browser test and **none**
of the 827 jsdom tests. Two of the four are real defects in shipped behaviour
rather than contrivances: a pointer handler reading `event.clientY` without
subtracting `rect.top`, and `setUnavailable(probe3D(stage))` in place of
`unavailabilityAfterSwap(...)` — which is precisely the regression story 5.7's
code review caught by reading, and which the ordering comment at `app.ts:265-270`
exists to prevent.

The cause is one line of test scaffolding. `src/test-support/fake-canvas.ts:113-123`
monkeypatches `HTMLElement.prototype.getBoundingClientRect` globally to a fixed
1200×800 box at the viewport origin, and `devicePixelRatio` is 1 in jsdom. Every
coordinate conversion in the engine therefore subtracts zero. The excellent
`pick()` grid scan in `engine.test.ts:290-305` runs against a canvas that is
always at (0,0), while in the real page the canvas sits 103 px below the header.

**Why no story caught it earlier:** because nothing was wrong with any of those
tests. They assert what they claim to assert, on the environment they were given.
The defect is in the *environment*, and an environment is invisible from inside
itself. It took a second environment to see it.

**Fix:** shipped, as this epic. The standing consequence is that a change to
coordinate arithmetic in `engine.ts` is now covered by
`ui/tests/pointer-hit.pw.ts` and by nothing in `pnpm test` — so the browser suite
has to actually be run before such a change lands. See action item 3.

### 2. A real defect was found, measured, and deliberately not fixed

Story 6.4 found that the tooltip is positioned in the wrong coordinate space.
`.tooltip` is `position: fixed` (`styles.css:315`), so its `left`/`top` are
viewport coordinates, while the `screen` point the hover event carries is
canvas-relative (`engine.ts:1789-1791` subtracts the canvas `rect.top`). With a
103 px header and `TOOLTIP_OFFSET_PX = 14` (`chrome/tooltip.ts:17`), the tooltip
renders **89 px above the cursor**, and the vertical flip is decided against the
wrong origin: it fires above a canvas-relative y of 752 on a canvas 697 px tall,
so **no real pointer can reach it**. The supervisor re-derived all three figures
from the source constants rather than accepting the write-up.

It errs upward into the page and so never overflows the window, which is why
6.4's AC-4 still holds honestly.

**Why no story caught it earlier:** `tooltipPosition` is a pure function and is
tested exhaustively, including a viewport grid sweep asserting the never-overflow
invariant (`chrome/tooltip.test.ts:46-86`). The function is correct. What was
never tested is the *caller's* coordinate space, and in jsdom `offsetWidth`/
`offsetHeight` are 0, so `tooltip.test.ts:116-122` passes on a 0×0 box.

**Fix:** not applied, correctly. 6.4's AC-5 and AC-7 forbid touching
`packages/viz/src/`, and changing shipped layout needs its own story. The agent
asked whether to encode it as a deliberately failing test and argued herself out
of `test.fail()` on the grounds that it treats *any* failure as the expected one;
the supervisor agreed rather than overruling. Her bottom-edge test asserts only
that the rectangle stays inside the window and documents in its own comment why
it passes and what is broken, so a future fix lands without deleting or editing
an assertion. See action item 1.

### 3. The two waves cost each other nothing, because the second one held its merges

Wave A merged its two story PRs as they were verdicted, 8 minutes apart, and its
own journal records what that cost: `sprint-status.yaml` rows on adjacent lines,
a conflict git could not resolve, one rebase and one full Codex re-review round.

Wave B took the opposite approach on both counts. The three agents were told at
15:36:24Z not to touch `sprint-status.yaml` at all; all three complied and all
three said so in their plans and their PR bodies. And all three merges were held
until every PR was verdicted `ready`, then done in a 23-second window — so the
`epic-updated` nudge that follows any commit on the epic branch reached nobody
who was still working. **Zero rebases and zero re-review rounds in wave B.**

**Why no story caught it:** it is not a story-level concern. It is a property of
how a wave is scheduled, and only the supervisor sees the whole wave.

**Fix:** the merge-holding is now written down here; the `sprint-status.yaml`
rule is a live contradiction between two binding documents and needs the
maintainer. See observation 4 and action item 2.

### 4. Two binding documents disagree about who writes `sprint-status.yaml`

`config/projects/gitnebula/rules.md` tells a story agent to "flip ONLY your own
story's line". The supervisor contract's §8d says the file has exactly one
writer, the supervisor, at closure, and that "no story agent touches it any
more". Both are current. Wave A followed the first and paid for it; wave B was
instructed to follow the second and did not.

The consequence a reviewer sees is that three rows read `backlog` under three
merged PRs until the supervisor's closure commit lands. All three agents called
that out explicitly in their PR bodies so it would not read as an oversight —
which is the right mitigation and not a substitute for resolving the conflict.

**Why no story caught it:** neither document is a story artifact.

**Fix:** action item 2. The measurement argument favours §8d — `sprint-status.sh`
derives the rows from the PRs GitHub reports as merged, so it cannot be wrong in
the way three hand-edits can.

### 5. The frozen verification contract could not run against the epic branch

The maintainer froze a SpecWitness contract for this epic — 40 criteria,
`.specwitness/contracts/epic-6.yaml` — and committed it to `master` as `b47d48d`,
together with the eight probe scripts under `scripts/specwitness/`. It was never
merged into `epic/6-assembled-viewer`.

SpecWitness verifies by checking the head ref out into an isolated worktree. At
`570094d` that worktree contains no `scripts/specwitness/`, so the `viewer`
service died with `MODULE_NOT_FOUND` before a single criterion was evaluated:

```
✓ ok       gates      4 gate(s) passed
! error    services   infra: service 'viewer' exited before it became ready (exit code 1)
VERDICT: (none) — infra error
```

The four deterministic gates — `lint`, `typecheck`, `unit`, `build` — all passed
at the epic head before the run stopped, so the failure says nothing about the
epic's quality. It says the tool cannot see its own probes from there.

**Why no story caught it:** the contract is not a story artifact and no story
owns it. It is exactly the class of defect this epic was written about: each side
correct on its own terms, the gap only visible between them.

**Fix:** none applied — the resolution is a merge, and merges are the
maintainer's click. The supervisor reproduced the answer instead: `master` merged
into the epic tip locally in a throwaway worktree (one comment-only conflict in
`.prettierignore`, see observation 6), then re-verified.

That run — against `fb4db42`, a local commit that was never pushed and that the
maintainer would have to recreate to reproduce — returned **FAIL: 9 pass, 11
fail, 20 needs_human**, with all four deterministic gates passing. The headline
is not the finding; the classification is.

**Seven of the eleven failures are instrument artifacts on correct work.** E6-09
counts two literal `__gitnebula` strings, both inside
`ui/src/suite-conventions.test.ts` — a comment at :144 and
`raw.includes("__gitnebula")` at :151 — which is the check that *enforces* the
criterion. E6-10, E6-11, E6-12 and E6-14 each read a selector's visibility and
expect `false`; the runner answers `<no element matches the selector>` and the
aggregator scores that as a failure, although an absent element is not visible.
Two of them look for `.error-screen`, which a good boot correctly never renders;
one for `#view-switch button[data-view='2d'][aria-pressed='true']`, which under
`?view=3d` does not exist because the attribute sits on the 3D button. The
epic's own browser suite asserts all four behaviours and passes. E6-23 and E6-28
report the validator-gap and layout reports missing; both exist, and
`findReport` in `scripts/specwitness/docs-presence.mjs` scans only the immediate
`.md` files of `docs`, `docs/dev` and `packages/viz/ui` — no recursion — so it
cannot reach a story subdirectory, which its own comment ("location is not fixed
by the contract") is the argument for.

**Three failures are one real divergence.** E6-02, E6-06 and E6-17 all fail on
the same missing file: `packages/viz/ui/README.md`, which the probe hard-codes.
Story 6.1's spec never asked for it — it asked for
`docs/dev/epic-6/6.1-viz-ui-suite/README.md`, which exists and carries every
clause the three criteria want: the separation from `pnpm test` (:36),
`reuseExistingServer: false` and `--strictPort` as load-bearing (:63), and the
cross-worktree `lsof` incident (:68). The substance shipped; only its location
differs from what the contract expects.

**One failure is a real divergence on defensible grounds.** E6-07 expects two
direct `page.goto(` calls in the suite sources and counts three, all in story
6.3's `ui/tests/support/load-failure-page.ts`. They exist because 6.1's
`openViewer` waits for a harness handle that a *failed* boot never publishes, so
a failure-navigation helper cannot use it; the file's comment at :424 says the
gotos live there "so the specs stay free of `page.goto`". No spec calls `goto`
directly, which is the criterion's evident intent — but the criterion counts
occurrences, and the count is three. The maintainer adjudicates: sharpen the
criterion, or move the navigation.

**Twenty `needs_human` is the contract's design, not a shortfall.** Two of them,
E6-05 and E6-08, the maintainer's own plan already declares human-adjudicated.

### 6. The integration merge conflicts, on comments only

`epic/6-assembled-viewer` carries `35a95c5`, which added `.specwitness/runs/`
to `.prettierignore` under a one-line comment. `master` carries `b47d48d`, which
added the same path under a five-line comment. Git cannot merge two different
comments above one line, so **the epic → master merge conflicts in
`.prettierignore` and nowhere else**.

The resolution is to keep `master`'s wording, which is the fuller and the newer
of the two, and to drop the epic branch's one-liner. The supervisor did exactly
that in a throwaway worktree to confirm nothing else conflicts; it did not.

**Why no story caught it:** neither commit belongs to a story. Both are
repository hygiene, written six hours apart on two branches.

### 7. `.prettierignore` is missing `intent.md`, and every cohorted agent pays for it

`pnpm lint` runs `prettier --check .` over the whole worktree. `.prettierignore`
exempts `plan.md`, `DECISIONS.md` and `PR_SUMMARY.md` as "terminal-agents
worktree scratch files (never committed)", but not `intent.md`, which postdates
that list — cohort intent-sync is a newer harness convention. Git ignores
`intent.md` through `.git/info/exclude`, so it never reaches a commit, but
Prettier does not read `.gitignore` and fails on it.

**All three wave B agents hit it inside the same hour.** One of them worked it
out, broadcast it to the other two with the workaround (`prettier --write` the
local file), and deliberately did **not** patch `.prettierignore`, on the
grounds that three branches each appending one line to one shared list is the
`sprint-status.yaml` collision again. The supervisor verified the reading and
did not need to instruct anything.

**Why no story caught it:** no story runs in a cohort worktree; only agents do.

**Fix:** one line, owned by nobody. See action item 4.

### 8. A gate that is right can still cost rounds, when its hint is wrong

The intent-sync gate builds its marker path as `"$CWD/intent.synced"`
(`hooks/pre-tool-use.sh:2829`) and looks for `intent.ready` and the ack markers
under `$CWD` — the working directory of the tool call, not the worktree root.
Claude Code's Bash working directory persists between calls, so one `cd
packages/viz` hides the markers and the gate refuses every mutating command
indefinitely. Its hint then says only `intent.md` is editable, which sends the
agent to edit a file that is not involved.

Wave A lost two rounds to it. In wave B it hit two of the three agents; the
supervisor recognised the pattern from wave A's journal entry, diagnosed it from
the hook source both times, and sent the one-line escape (`cd` back to the
worktree root — `cd` is on the gate's own read-only allowlist). Both cleared it
on the first message. **The journal entry is what turned a two-round loss into a
one-message fix**, which is the clearest evidence in this epic that the
cross-wave record earns its keep.

The same `$CWD` pattern is in the plan gate (lines 3012-3013), where it fails
*open* instead — from a subdirectory, `plan.pending` is invisible too.

This is a terminal-agents defect, not a gitnebula one. It is reported there.

### 9. Three agents coordinated without the supervisor, and got it right

The only cohort-wide instruction the supervisor sent was the `sprint-status.yaml`
one. Everything else the agents settled between themselves during and after
intent-sync: filenames exchanged so no two specs collided; a shared coordinate
helper proposed and declined in favour of local ones; the `intent.md` lint
finding broadcast with a workaround and a reasoned refusal to patch the shared
file; and a warning that the 6.1 conventions check rejects Playwright's
asymmetric matchers (`expect.any`, `expect.arrayContaining`,
`expect.stringMatching` all parse as a single-argument `expect(` and fail the
prose-message rule even when the outer assertion carries one).

Two of them wrote into `packages/viz/ui/tests/support/` in the same wave without
colliding, because they had exchanged filenames first.

### 10. The story specs were wrong in one checkable place, and the agent said so

Story 6.3's spec asserts that `renderErrorScreen` "has **no test in any
harness**". `packages/viz/bundle/tests/bundle.pw.ts` already renders it for the
`file://` case, asserting "has to be served" and "npx serve". The agent found it,
reported it in the PR body rather than quietly satisfying the criterion, kept his
own overlapping test deliberately narrow (the exact constant against that one's
two substrings), and recommended consolidating the two once wave B had merged —
which needs someone able to edit both suites at once, and so is nobody's story.
The supervisor read `bundle.pw.ts` and confirmed it.

The load-bearing half of the premise held: that was the only browser assertion on
the screen, covering one of six constructions.

## What we learned

**A second environment finds what a better test cannot.** Every defect this epic
surfaced was invisible to a suite that was already thorough, already
well-written, and already passing. None of them would have been caught by adding
more jsdom tests, because all of them live in the gap between jsdom and a
browser. The 827 tests were not weak; they were complete about the wrong thing.

**"Report, don't patch" produces better artifacts than "fix it".** Three stories
were forbidden from touching `packages/viz/src/`, and the constraint turned two
findings into measured write-ups with reproducible numbers rather than into
diffs a reviewer would have had to trust. The tooltip finding in particular is
more useful as 89 px, 752 and 697 than it would have been as a patch.

**A cross-wave record pays for itself in one incident.** Wave A's journal entry
cost its author ten minutes and saved wave B two rounds on the intent gate,
because the trap was named, diagnosed and paired with its escape before anyone
hit it a third time.

**Holding merges is free at the end and expensive in the middle.** Wave A merged
as it went and paid a rebase and a Codex round; wave B held and paid nothing.
The cost is entirely a function of whether anyone is still working.

**A supervisor's `ready` is only worth the reproduction behind it.** All five
verdicts in this epic quote numbers the supervisor re-ran in the authoring
worktree. Two of them (827/56 files, and the 44-test browser suite) came out
identical to the agent's claim, which is the only reason the claim is worth
repeating to the maintainer.

## What went well

- Five stories, five `ready` verdicts, zero `needs work`, zero rework after
  review, and one Codex finding across the whole epic — which the agent fixed
  and then proved fixed with an observed red run rather than an assertion.
- Every agent left AC-8 unticked with its reason, and nobody ticked a
  human-review box to make a checklist look finished. Story 6.4 left **two**
  unticked, one of which records a defect.
- Every negative control in this epic was shown to fail. 6.1 established the
  pattern, and 6.2, 6.3 and 6.4 each carried it: defeat the mechanism, watch the
  test go red, revert. The supervisor confirmed the reverts by diffing
  `packages/viz/src/` against the base on all three branches — empty every time.
- Wave B's three agents needed exactly one instruction between them.
- The whole epic added **no product code**, no dependency and no fixture, and did
  not touch `analysis.schema.json`. `schemaVersion` is still `"1.0"`.

## Technical debt carried forward

1. **The tooltip's coordinate space** (observation 2). Measured, written up in
   `docs/dev/epic-6/6.4-viz-reachability/README.md`, unfixed by design.
2. **The validator seam** (story 6.3). The schema requires 12 node fields and the
   loader checks 6; 4 edge fields against 2; `cochanges` is asserted only to be
   an array. Five of the unchecked fields degrade safely, five misread — `NaN`
   in the panel, a module reporting none of its files, a co-change pair silently
   disappearing. 6.3's README names what a future story must decide, and notes
   that a `formatInteger` returning the em dash for a non-finite input would fix
   two of the misreads without touching the loader, the schema, or the boot path.
3. **Two overlapping `file://` error-screen tests** (observation 10), in two
   suites, needing one story that can edit both.
4. **`.prettierignore` is missing `intent.md`** (observation 7).
5. **The browser suite is not in `pnpm test` and never will be** — that is 6.1's
   deliberate design (`pnpm test` must pass with no browser installed, criterion
   E6-05). The debt is not the separation; it is that nothing reminds a
   contributor to run `pnpm --filter @gitnebula/viz ui` before changing
   coordinate arithmetic. Action item 3.
6. **`docs/dod-report.md` is still stale**, inherited unresolved from Epic 5.

## Next-epic readiness

The epic branch is green at `570094d` on every gate this project defines, and the
browser suite it adds is 44 tests that did not exist three days ago. What the
next epic inherits, concretely:

- A browser suite with a real negative-control convention and a machine-checked
  set of conventions over it, which covers any new `*.pw.ts` the moment it lands.
- Two measured, written-up defects that are now cheap to schedule as stories,
  because the measurement is already done.
- A verification contract that has never completed a probe run against this epic
  (observation 5), and which the next epic will want working before it starts.

## Action items

| # | item | owner | why it is not an agent's |
| --- | --- | --- | --- |
| 1 | Schedule the tooltip coordinate-space fix as a story | maintainer | changes shipped layout; forbidden to 6.4 by its own ACs |
| 2 | Resolve the `sprint-status.yaml` writer contradiction — amend `rules.md` to match §8d, or the reverse | maintainer | both documents are the maintainer's |
| 3 | Decide how a contributor is reminded to run the browser suite before touching coordinate arithmetic | maintainer | needs a policy choice (CI, a hook, or a README rule) that no story owns |
| 4 | Add `intent.md` to `.prettierignore` | maintainer | one shared line; three branches adding it is the collision this epic avoided |
| 5 | Merge `master` into the epic branch (or resolve at integration) so SpecWitness can see `scripts/specwitness/`, then run the contract | maintainer | merges are the maintainer's click |
| 6 | Restore the CI push/PR triggers and get a green run | maintainer | GitHub Actions billing; story 4.2 |
| 7 | Adjudicate the four substantive SpecWitness failures: create `packages/viz/ui/README.md` or repoint E6-02/E6-06/E6-17; accept or sharpen E6-07's third `page.goto` | maintainer | the contract is frozen and only its author may change it |
| 8 | Fix two probes: make `findReport` recursive so E6-23/E6-28 can see story reports, and narrow E6-09's literal count so the check that enforces a rule stops violating it | maintainer | probe mechanics, in `scripts/specwitness/` on master |

The epic's closure verdict is **not ready to merge into master**, and the
integration PR was therefore not opened. Not because the epic's own gates fail —
every one of them passes — but because the verification contract built for
exactly this moment returns FAIL, and four of its eleven failures are
substantive. All four are documentation or probe-shape decisions that could be
settled in minutes, and none is a defect in the shipped product. Once they are
adjudicated the epic is ready and the integration PR follows.

## Follow-through on the previous epic's action items

Epic 5's retrospective is the immediate predecessor and its action items were
addressed as follows, to the extent this epic touched them:

- **"A check that can quietly report clean is not a check"** (Epic 5,
  observation 7) is the thesis Epic 6 was written to act on, and it was acted on:
  every assertion added in this epic was shown red before being relied on, and
  the negative-control pattern is now enforced by a conventions check rather than
  by discipline.
- **The `epic-N:` sprint-status line** that Epic 5 said "four epics now want" does
  not exist as a key in this file; corrected above.
- **`docs/dod-report.md` staleness** is unaddressed and carried forward again.
- **Epic 5's four unticked manual-testing items** were not revisited by this
  epic, except that 6.4 revisited story 5.6's "scrolling felt in a browser" — the
  mechanism half is now covered by a rendered check, and the feel half is
  restated as the only genuinely subjective part remaining.
