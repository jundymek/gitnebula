# Epic 6 retrospective — addendum for story 6.6

Written on 2026-09-09 by `superman`, the epic's closing supervisor, after story
6.6 merged. It follows the precedent of
`docs/implementation-artifacts/epic-4-ship-it/epic-4-retrospective-addendum-4.5.md`:
a story that landed after its epic's retrospective was written gets an addendum
rather than a rewrite, because
`docs/implementation-artifacts/` is append-only once frozen.

The main retrospective (`epic-6-retrospective.md`, merged in PR #86) stands
unchanged. Everything below extends it.

## What 6.6 was, and why it existed at all

The closure review ran the maintainer's frozen contract against the merged epic
and classified its eleven failures. **Three of them were one absent file** —
`packages/viz/ui/README.md`, which `scripts/specwitness/docs-presence.mjs:35`
reads by that exact path and which no story spec had ever commissioned. Story
6.1 was asked for, and delivered, `docs/dev/epic-6/6.1-viz-ui-suite/README.md`
instead. The gap was between two documents rather than inside either, which is
why no agent was at fault and why no story owned it.

The maintainer commissioned the story; the supervisor wrote the spec (PR #87);
`arnold` implemented it (PR #88, merged as `c5a10cb`).

## The measurement

The contract could not run against the epic branch at closure — its probe
scripts lived only on `master`. The maintainer carried them onto the branch as
`b18891a`, so for the first time the run below is **against a pushed ref** and
the maintainer can reproduce it with one command:

```
specwitness verify epic-6 --no-ai --base master --head origin/epic/6-assembled-viewer
```

| | at closure (`570094d`, via a local merge) | after 6.6 (`c5a10cb`, pushed) |
| --- | --- | --- |
| gates | 4 pass | 4 pass |
| criteria pass | 9 | **12** |
| criteria fail | 11 | **8** |
| needs_human | 20 | 20 |
| verdict | FAIL | FAIL |

The three that flipped are exactly the three the missing file caused: **E6-02,
E6-06 and E6-17**.

**E6-02 was not named in the spec, and the agent found it.** The story spec
named E6-06 and E6-17. `arnold` read the plan
(`.specwitness/plans/epic-6.yaml:206-226`) and saw that E6-02 attaches its
`docs-presence` probe to `$.uiReadmePresent` and
`$.uiReadmeMentionsOnDemandSeparation` — both of which would have gone green
from the E6-06 material alone, **a probe reporting clean over an unmet
criterion**. He wrote the server-reuse prohibition and the cross-worktree `lsof`
incident into the README anyway, so the criterion is met and not merely
reported met. That is the epic's own thesis applied by an agent to its own
work, unprompted, and it is the best single thing in this story.

## The eight that remain, unchanged in kind

Seven are the instrument artifacts the closure review classified — E6-09's
literal count tripped by the check that enforces it; E6-10, E6-11, E6-12 and
E6-14 reading a selector's visibility, expecting `false` and receiving
`<no element matches the selector>` where absence is the correct state; E6-23
and E6-28 unable to find two reports because `findReport` does not recurse into
story subdirectories.

The eighth is **E6-07**, the only substantive one: three direct `page.goto(`
calls against an expected two, all in story 6.3's failure-navigation helper,
which cannot use `openViewer` because a failed boot never publishes the harness
handle it waits for. It remains the maintainer's to accept or sharpen. No story
can decide it and none has been written for it.

## Three process findings from this story

### 1. A review-driven fix was lost to merge timing, and nobody would have noticed

Codex reviewed the 6.6 spec on the supervisor's own branch and raised two real
defects in it: **AC-8 was unsatisfiable** (it declared `packages/viz/ui/README.md`
the only file added, while the task list and the pre-PR gate both require a
`docs/dev/…/README.md` and a `MANUAL_TESTING.md`), and the E6-06 section
**stated as fact that `packages/viz/package.json` declares three scripts** when
it declares eight — inside a spec whose own AC-7 requires every claim to match
the tree.

The fix was committed as `3f8633c` and pushed. PR #87 was merged from `8bafdb2`,
the commit before it, so **`c985bb6` carries the unfixed spec** and `arnold`
worked from that version. It did not bite him: he shipped exactly the four files
the gates require, and he re-derived the script inventory from
`package.json:13` and `:17` rather than trusting the paragraph. But the merged
spec is permanently wrong on both points.

**Not fixed here, deliberately.** The supervisor may not write to an existing
story spec; that limit exists so a spec somebody is working from cannot change
under them, and it does not carve out an exception for a spec the supervisor
wrote. The correction is recorded here instead, which is the artifact that is
the supervisor's to write.

**The lesson is about sequencing, not about either party:** a fix pushed to an
open PR is only as good as the commit the merge actually takes, and nothing in
the flow says so. Whoever pushes a fix to an open PR should say "not yet" out
loud, and whoever merges should check the head.

### 2. An attribution footer nearly landed in permanent history

PR #88's body ended with `🤖 Generated with [Claude Code]` and a
`claude.ai/code/session_…` URL. This project squash-merges, so a PR body becomes
the commit body: a dead session link and an AI attribution footer would have
landed in the permanent history of a public MIT repository whose commit history
`CLAUDE.md` names as a product requirement — the same file that says `Agent:` is
this project's only AI attribution.

It was caught at review, removed in one edit, and the squash commit is clean.
None of the epic's other six PRs carried it.

**The cause was not the agent's judgement.** A mid-session system message
instructed the agent to end PR descriptions with that footer, stating that it
replaced earlier attribution guidance. He applied it in the PR body and did
*not* apply it in the commit message ten minutes earlier, where he correctly
ranked the project's instruction above it — so the inconsistency was his, in
the one place a squash makes permanent, but the instruction was not.

**His own recommendation, recorded because it is the right one:** the check
belongs in the pre-PR gate, not in an agent remembering. Every future agent
started this way will receive the same message.

### 3. `spawn-agent.sh` prepares an agent; it does not start one

6.6 was launched with `spawn-agent.sh` rather than `launch-task.sh`, on the
supervisor's recommendation, specifically so that launching a single follow-up
story would not delete the live supervisor and spawn a fresh one — which
`launch-task.sh --supervised` does, and which would have produced a second
retrospective for an epic that already had one.

The recommendation was one command short. `spawn-agent.sh` creates the worktree,
the runtime directory and the autonomous markers, and stops: no tmux window, no
REPL, no `node_modules`, and no `pr-summary.approved` — which
`launch-task.sh:978` pre-creates for autonomous cohorts. The agent sat at
`spawned` until `attach-agent.sh` and `pnpm install` were run, and then stopped
again at the PR-summary checkpoint that the other route removes.

Both stops were recoverable in one command each, and the checkpoint was arguably
useful. But the trade is worth stating for the next person: **the single-agent
route preserves the supervisor and costs three manual steps.**

## Action items, updated

Items 1–6 in the main retrospective stand. These are added:

| # | item | owner |
| --- | --- | --- |
| 9 | Put the attribution-footer check in the pre-PR gate, so a PR body carrying one is refused rather than caught by review | maintainer (terminal-agents) |
| 10 | Correct the two defects in the merged 6.6 spec — the unsatisfiable AC-8 and the "three scripts" claim — or leave them and let this addendum be the record | maintainer |
| 11 | Decide whether `spawn-agent.sh` should print its three missing steps, or whether a `--start` flag should do them | maintainer (terminal-agents) |

Action item 5 in the main retrospective — carrying the contract onto the epic
branch — is **done**: `b18891a`. The contract now runs against a pushed ref.
