# Epic 1 retrospective — Contract and Foundations

Written by the supervisor (`superman`) of `epic/1-workspace-scaffold` on
2026-08-11, at epic closure. This is the project's **first** epic retrospective:
there is no previous one in this repository, so it follows the supervision
brief's structure rather than a local precedent, and it establishes the location
`docs/implementation-artifacts/<epic>/epic-<n>-retrospective.md` for the next.

## Delivery summary

| | |
| --- | --- |
| Stories | 4 (1.1 scaffold, 1.2 schema, 1.3 fixtures, 1.4 perf spike) |
| Agents | alice, bob, pamela, arnold — one per story, supervised by superman |
| Wall clock | 09:15Z launch → 14:23Z last merge — **5 h 08 m** |
| PRs | 4 opened, 4 merged, 0 abandoned, 0 reverted |
| Planned vs actual merge order | identical: #1 → #2 → #3 → #4 |
| Supervisor verdicts | 6 issued: 4 × ready, 1 × needs-work (bob, PR #2, mid-flight), 1 × blocked-on-owner (alice, PR #1, CI billing) — both resolved and re-verdicted |
| Codex findings | 14 total across the epic (1.1: 1, 1.2: 4, 1.3: 1, 1.4: 8) — **14 fixed, 0 dismissed, 0 escalated** |
| Test count | 11 at scaffold → **161** at epic head |
| Epic head | 41fb746: lint, typecheck, test (161), build all clean |

No previous epic exists, so there are no comparative metrics and no prior action
items to follow through on. Both sections are empty by fact, not by omission.

## Post-run observations

### 1. `DOCS_TASK_DIR` never reached the agents, and the workaround was itself blocked

**Symptom.** bob's `gh pr create` was refused by the pre-PR docs gate demanding
`docs/backend/<epic>/1.2-contract-schema/README.md` — a path `CLAUDE.md` forbids.
pamela hit the same wall two hours later.

**Cause.** `config/projects/gitnebula/project.env` declares
`DOCS_TASK_DIR='docs/dev'`, but `spawn-agent.sh` writes the harness default into
each agent's `.env.agent`. Every agent in the wave inherited `docs/backend`.

**Why no story caught it.** No story owns the harness. The gate fires only at PR
time, so the defect is invisible for the whole of implementation and lands on
whoever reaches a PR first.

**Second-order failure.** bob escaped by correcting his own `.env.agent`. When
pamela and arnold tried the same at 12:28Z, the pre-tool-use hook refused it as a
secret-bearing path. The workaround the first agent used was unavailable to the
rest — so the wave's experience of the same defect was inconsistent, which is
worse than a defect that blocks everyone equally. The maintainer patched the two
live files at ~12:52Z and pamela cleared the gate on her next attempt.

**Fix (owner).** One line in `spawn-agent.sh` so the project value is written
instead of the default. Still outstanding: the next wave will inherit
`docs/backend` again.

### 2. `TA_PROJECT` leaked into agent shells and silently disabled agent identity

**Symptom.** bob's overview phase read `inbox-pending` for ~100 minutes while he
held 417 lines of real work, a fully-read inbox and an approved plan. Hook blocks
in `events.log` were attributed to `?` instead of an agent.

**Cause.** `pre-tool-use.sh` derives `AGENT_ID` from the CWD via
`agent_id_from_cwd`, which matches against `WORKTREE_BASE` from `resolve_project`
— and `resolve_project` honours `TA_PROJECT` over the CWD. With
`TA_PROJECT=terminal-agents` in the agent processes, a gitnebula worktree matched
nothing, `AGENT_ID` came out empty, and `bump_phase_if_spawned` returned at its
first line. Nothing errored; phases simply stopped advancing.

**Why no story caught it.** Same reason as above, plus this one fails *silently*:
the operator overview keeps rendering, it just renders stale.

**Blast radius worth naming.** `block-loops.sh` groups blocks by agent, so blocks
logged as `?` are invisible to it. Its clean "no block loops" result during that
window was not evidence of no loops. A supervisor reading that output as a green
light would have been wrong.

**Fix (owner).** Stop exporting `TA_PROJECT` into agent REPLs, or make
`resolve_project` prefer a CWD that resolves and fall back to `TA_PROJECT`.

### 3. The post-push auto-review reports findings when its own verdict is clean

**Symptom.** bob's round-six auto-review recorded `state=auto_review_findings`
while its log closes with "no actionable regressions identified". arnold's did the
same. Two different agents, so it is systematic.

**Cost.** Each false `auto_review_findings` sends the agent an inbox message,
trips the inbox gate on their next mutation, and invites a re-review round that
has nothing to find.

**Fix (owner).** Derive the recorded state from the verdict text (or whatever the
verdict actually is), not from the presence of review output.

### 4. Finished agents are respawned on a loop

**Symptom.** Four `dead-repl` respawn waves between 13:36Z and 14:02Z, every 7–11
minutes, each reviving alice, bob and pamela — all three already `done` — plus the
supervisor.

**Why it matters even though nothing broke.** A respawn cycle on agents with
nothing left to do is noise in exactly the signal a supervisor uses to detect a
genuinely dead REPL. Teach the watcher to treat `done` as terminal.

### 5. A literal NUL byte in source silently turns a file binary

**Symptom.** Two of pamela's source files carried a NUL as a map-key separator.
Git classified them as binary: `Bin 6864 -> 6874 bytes` instead of a diff.

**Why no gate caught it.** None looks. Lint, typecheck, tests and codex all pass —
the string is valid at runtime. It surfaces only in `git show --stat`.

**Why it matters here specifically.** `CLAUDE.md` makes a history that reads
cleanly to an outside observer a *product* requirement. Squash-merge saved this
one (the intermediate commits carrying the blobs are discarded), but an
unsquashed branch would put a permanently binary file in the portfolio history.

### 6. A perf spike's real risk is the instrument, not the target

**Symptom.** 8 of the epic's 14 codex findings landed on story 1.4, and every one
was about the measurement rather than the code under measurement: phase (c) never
collapsed modules on viewport exit (1,820 of 2,000 files accumulated, the opposite
of ADR-0006); the AC-5 partition excluded freshly-settled modules — precisely the
nodes that would drift if the mechanism leaked; the fixture loader 404'd into a
silent fallback; a settle timeout was indistinguishable from a settle; the canvas
was not DPR-correct; the visibility guard was blind to a suspended tab.

**Why no story caught it.** The spec asked for numbers and got numbers. Nothing in
it asked *how would this harness lie to me* — and the first version held 59 fps
whether the mechanism worked or not, so the number could not distinguish them.

**What saved it.** Six review rounds, and the agent re-measuring after each. The
committed evidence and the final code are the same commit (fd1260f) — checked at
review, not assumed.

## What we learned

- **A green number is not evidence until you know what would have made it red.**
  1.4's fps held at 59 with the unfold mechanism inverted. bob's date-time format
  began as a shape-only regex that accepted `2026-99-99T25:61:61Z` and passed its
  tests. In both cases the fix came from an adversarial reader, not from the suite.
- **Cross-record invariants need their own tests.** Schema validation is per-record
  by construction, so pamela's generator could emit 239 individually-valid module
  edges of which 4 lied about the pairs beneath them. The loop that checks the
  whole fixture directory is the durable part of story 1.3.
- **A fixture defect is someone else's future bug.** That weight error would have
  surfaced inside an Epic 3 viz story, far from its cause.
- **Harness defects concentrate at gates**, because gates are where an agent first
  meets the harness's assumptions. Three of the five harness findings above fired
  at PR time.

## What went well

- **The serial chain held with zero rework.** 1.1 → 1.2 → 1.3 → 1.4 merged in
  planned order; no story had to be re-scoped and no PR was abandoned.
- **Agents worked ahead of their blocks instead of idling.** arnold had commits,
  codex and a security pass done while still `waiting_for=pamela:done`.
- **The one shared-file change was negotiated, not stumbled into.** 1.3 needed a
  change to `packages/contract/tsconfig.json`, which 1.2 owns; the two agreed it
  before either landed and 1.2's AC-5 survives at the epic head.
- **`sprint-status.yaml` did not collide.** The file that produced rebase storms in
  earlier waves was left alone by every agent and written once, at closure.
- **Every codex finding was fixed; none was dismissed.** 14 for 14 across the
  story PRs — and a fifteenth, a P1, landed on the supervisor's own closure
  commit: it flipped `1.4-perf-spike` to `done` while that story's owner gate
  was still open, which would have made the lifecycle source of truth say "go"
  before the decision that releases 2.5 / 3.3 / 3.5. Corrected on the
  maintainer's call; the row stays `review` until the verdict is accepted. The
  review layer catching the reviewer is worth recording.
- **Both owner gates were left unticked without being asked twice** — 1.4's verdict
  acceptance and its six manual-testing steps.
- **An agent stopped at a gate and reported instead of routing around it.** pamela
  hit the docs gate, sent a message and waited; no duplicate README and no
  `docs/backend/` tree ever entered the repo.

## Technical debt carried forward

| Item | Owner | Note |
| --- | --- | --- |
| CI is `workflow_dispatch`-only | story 4.2 | Maintainer decision 2026-08-11; all verification is local until then. The M1 milestone text still says "CI green". |
| DPR was 1 in the 1.4 measurements | story 2.5 | A Retina run rasterises 4× the pixels; worth one confirming run against a real renderer. |
| Cross-module file imports drawn but not simulated in phase (c) | Epic 3 unfold story | Consequence of per-module wakes. |
| Co-change `count >= 3` not in the schema | story 2.3 (githist) | FR-7 calls it tunable analyzer policy; the contract bounds it at `>= 1` only. **githist must enforce it.** |
| `repo.stats.languages` is a share map, not raw counts | story 2.1 (scanner) | scanner must normalize. |

## Next-epic readiness

Epic 2 can launch. The contract is frozen and validated, the fixtures exist and
are byte-reproducible, and 1.4's verdict — pending the maintainer's acceptance —
means 2.5, 3.3 and 3.5 launch as written with no spec amendment. Three rules from
the spike belong in the Epic 3 unfold story's context when it is written, each a
real failure before it was a rule: no `forceCenter` inside a wake (the first
version measured 129 px/frame of non-member displacement, 258× over the bound); a
wake contains only newly-woken members plus their pinned module as anchor; one
wake per module, so a collapse is a deletion rather than a re-seed.

**Blocking Epic 2's launch:** nothing in the code. Two harness fixes (items 1 and
2 above) should land first, because both will recur wave-for-wave otherwise.

## Action items

| # | Action | Owner |
| --- | --- | --- |
| 1 | Fix `spawn-agent.sh` to write the project's `DOCS_TASK_DIR` instead of the default | maintainer |
| 2 | Stop `TA_PROJECT` leaking into agent REPLs (or make CWD win in `resolve_project`) | maintainer |
| 3 | Derive the auto-review recorded state from its actual verdict | maintainer |
| 4 | Treat `done` as terminal in the dead-REPL respawn watcher | maintainer |
| 5 | Accept or reject the 1.4 perf verdict, and walk `1.4-perf-spike/MANUAL_TESTING.md` | maintainer |
| 6 | Reconcile the M1 milestone text ("CI green") with the CI-skip decision | maintainer |
| 7 | Carry the githist `count >= 3` and scanner language-share obligations into 2.3 and 2.1 | Epic 2 planning |
| 8 | Consider a cheap guard against NUL bytes in source (a lint rule or a pre-commit grep) | Epic 4 repo-quality (4.3) |

## Follow-through on the previous epic's action items

None — this is the first epic.
