# 5.8 — README and docs refresh

Story spec:
[`docs/implementation-artifacts/epic-5-onboarding/5.8-repo-docs-refresh.md`](../../../implementation-artifacts/epic-5-onboarding/5.8-repo-docs-refresh.md).
PRD FR-33, UX-DR16. Owner module: `cli` (repository documentation). Touches the
repository root and `docs/` only — **no `packages/*/src` change of any kind**.

## What this story is

Epic 5 rebuilt what the map does when it opens. The README still described the
product from before it: it led with a one-line feature summary, and its
description of hover — "everything outside the hovered node's one-hop chain
dims, so a file's imports stand out of two thousand nodes" — described the
encoding story 5.2 deleted. This story makes the documentation describe the
product that now exists, and re-cuts the demo on the same path.

## AC-1 — every corrected claim, and the story that changed it

The spec names two and says explicitly not to trust that list to be exhaustive.
The audit was a line-by-line pass over the old README against the merged epic.

| README claim before | what is true now | changed by |
| --- | --- | --- |
| "Everything outside the hovered node's one-hop chain dims, so a file's imports stand out of two thousand nodes." | Out-of-chain nodes rest at 0.55 and their edges at 0.12; the chain is carried by emphasis — a glow boost, a ring, and `EDGE_ALPHA_CHAIN`. The map no longer goes dark under the pointer. | **5.2** |
| Navigation is zoom-only: "zoom past 1.8× and a module unfolds into its files." | Still true, and no longer the whole story: `dblclick` scopes the map to a module and pins it open, `Escape` leaves, and a connected-only filter drops edgeless files. | **5.4** |
| The map opens as a map — the README described no first state at all. | The map opens on the start-here panel: a reading order in three categories, reachable again from `◎ start here`. | **5.1** |
| "Churn, commit and author counts and last-change time over a 90-day window" — the window stated as a fixed property of the tool. | The window is data (`repo.analysisWindowDays`), the panel labels every history row with it (`history · last N days`), and a file with no commit inside it says "no change in last N days" instead of `0`. | **5.5** |
| No mention of filtering; the only way to see less was to zoom. | Five multi-select layer toggles; an excluded layer is **not drawn**, so it cannot be hovered or picked, and switching it back on does not re-run the settle. | **5.3** |
| "PNG export — a 2× re-render of exactly what is on screen." | Still true, and now explicitly includes the active filters. | **5.3** (AC-5) |
| Search described as fly-to-and-open only. | A result outside the active scope leaves the scope, flies there, says so, and offers the way back. | **5.4** (AC-5) |
| "Files … over a 90-day window" with no account of a quiet repository. | The heatmap legend states the near-uniform case, so a flat heatmap reads as data rather than as a broken renderer. | **5.5** (AC-4) |
| The sample run's numbers (295 nodes, 360 edges, 60 co-change pairs, 0.25 s) and its summary line. | Replaced by a real run over a fresh clone: 368 nodes, 400 edges, 140 co-change pairs, and the summary line now names the analysis window. | **5.5** (AC-5), plus history since 4.3 |
| Root files were absent from the map and from the README's account of it. | Files in the repository root are drawn; the README says so. | **4.7** (pre-epic, never documented) |

Two claims in the old README were checked and are **unchanged**, so they stay as
they were: the `1.8×` unfold threshold (`UNFOLD_ZOOM`) and the ⌘K search.

## AC-2 — what the README now documents

The lead is the question, not the tool (UX-DR16): *"You have just cloned a
repository you have never seen. Where do you start reading?"* The capabilities
this epic adds are then introduced along the path a first-time reader walks
them, under **The first five minutes** — start-here (5.1), the panel's windowed
history (5.5), drill-down and connected-only (5.4), the layer filter (5.3) and
hover (5.2) — rather than as six more bullets on a feature list. The older
capabilities keep their list, because a visitor scanning for "does it do PNG
export" is served by one.

## AC-3 — the demo

`scripts/record-demo.mjs` recorded the pre-Epic-5 tour, and its **first step**
was "hover a module — the dependency chain lights up and everything else dims":
the deleted behaviour, as the opening beat. The re-cut follows the onboarding
path — settle → start-here → take a file → drill down → hover a chain in scope
→ connected-only → `Escape` → layer filter → heatmap → PNG export — and
`docs/recording-demo.md` is rewritten to the recipe actually used.

One recipe change worth its own line: **record against a clean clone.** The
first take of this cut had `plan.md` and an `.intent-acks/` module on the map,
because the recorder was pointed at a live worktree. The recipe now clones into
a temp directory first, which is also why the README's sample run reports 368
nodes where the same command in a worktree reports over 400.

## AC-5 — every README command, run

Recorded step by step in [MANUAL_TESTING.md](MANUAL_TESTING.md), including the
`npx gitnebula` path against the published package.

## Files

| file | change |
| --- | --- |
| `README.md` | UPDATE — the story's subject (AC-1, AC-2) |
| `scripts/record-demo.mjs` | UPDATE — the onboarding-first sequence (AC-3) |
| `docs/recording-demo.md` | UPDATE — the recipe actually used, incl. the clean-clone rule (AC-3) |
| `docs/assets/demo.gif` | UPDATE — re-recorded take (AC-3) |
| `docs/dev/epic-5/5.8-repo-docs-refresh/README.md` | NEW — this file |
| `docs/dev/epic-5/5.8-repo-docs-refresh/MANUAL_TESTING.md` | NEW — the command verification and the owner's read-through |
| `docs/implementation-artifacts/epic-5-onboarding/5.8-repo-docs-refresh.md` | UPDATE — tasks + Dev Agent Record (append) |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE — this story's row only |

## AC-4 — the frozen-artifact audit

The diff over `docs/planning-artifacts/` is **empty**. The diff over
`docs/implementation-artifacts/` touches exactly two files: this story's own
spec (ticking its own boxes and filling its own Dev Agent Record, both of which
are appends into sections left empty for them) and this story's single row in
`sprint-status.yaml`. No content describing completed work is rewritten or
deleted anywhere in the diff.

## A defect found while measuring, reported and not fixed

`packages/viz/src/engine/layout.ts` line 238 joins a map key with a **literal
NUL byte** (`` `${source}\0${target}` ``). The scanner's binary-file heuristic
therefore classifies the file as binary, so gitnebula's map **of its own
repository** carries it with `loc: 0` and none of its imports:

```
! scan: binary-file ×1 (e.g. packages/viz/src/engine/layout.ts)
```

Reproduced on a clean clone of `epic/5-onboarding` at `4ffbee0`, outside any
worktree; NUL at byte 8879. It is the same defect story 5.1's agent found and
fixed in their own fixture, still present in shipped engine source. `engine/` is
not this story's territory and both wave-B peers are editing it, so it is
reported rather than patched — the reasoning is `DECISIONS.md` D8. Story 5.7's
owner confirmed the finding independently at the byte level and reported that
he had already drafted the same joined-key idiom into `layout3d.ts`; that file
now uses a nested map instead, so the defect did not propagate into the 3D
layout.
