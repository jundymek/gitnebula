# 4.3 — Launch-ready README

The repository root is part of the product (brief §2, PRD FR-25/SM-7). This
story gives gitnebula the README it did not have, completes `CONTRIBUTING.md`,
and makes the demo asset reproducible instead of a one-off.

## What landed

**A README that shows the product in 30 seconds.** In AC-1's order: one-line
pitch → the demo GIF → `npx gitnebula` quickstart with the tool's real terminal
output → the map-of-itself link → feature bullets → CI badge → license. Every
bullet describes code merged on this branch's base; nothing is aspirational.

**A demo GIF recorded from the real product.** gitnebula analyzing its own
checkout (295 nodes, 360 edges, 60 co-change pairs), driven through the
scripted sequence the spec names: launch → settle → hover → panel → zoom/unfold
→ file hover → search fly-to → heatmap → PNG export. Recorded with Playwright's
`recordVideo`, encoded to GIF with ffmpeg.

**A recorder that anyone can re-run.** `scripts/record-demo.mjs` drives the
served map with real pointer, wheel and keyboard events and resolves node
positions at runtime through the engine's public `pick()` — so the same script
still works after the layout changes or on a different repository.

## Files

| file | | why |
| --- | --- | --- |
| `README.md` | NEW | The story's deliverable — the repo had no README at all. |
| `docs/assets/demo.gif` | NEW | The 30-second demo, 720 px / 8 fps / 3.7 MiB. |
| `docs/recording-demo.md` | NEW | AC-3: tool, resolution, sequence, re-record recipe, and why the encode is tuned the way it is. |
| `scripts/record-demo.mjs` | NEW | The scripted recorder behind that recipe. Dev tooling; nothing it uses enters the bundle. |
| `CONTRIBUTING.md` | UPDATE | AC-2 gaps: the workspace's six packages, running the tool on this repo, and the fixture-repo regeneration rules. |
| `eslint.config.js` | UPDATE | Node + DOM globals for `scripts/**/*.mjs`, mirroring the block that already exists for `packages/*/scripts/**/*.mjs`. |
| `docs/implementation-artifacts/.../4.3-repo-quality.md` | UPDATE | Tasks ticked, Dev Agent Record filled. |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | This story's row only. |

## Decisions worth knowing

- **Playwright rather than a desktop screen recorder.** External to the product
  (the in-tool recorder stays a non-goal), already a `viz` devDependency, and
  it makes "reproducible" mean something: the sequence is code, not prose.
- **720 px / 8 fps / 64 colours / no dithering.** Measured: the same capture at
  900 px/12 fps/128 dithered is 10.0 MB, this encode is 3.7 MiB. A dark canvas
  of moving points is GIF's worst case and dithering noise defeats its
  compression. The trade is mild banding in the node glow.
- **The CI badge does not claim green.** `ci.yml` is `workflow_dispatch`-only
  until story 4.2 revisits it, so the README shows the badge and states what CI
  runs, without asserting a status the repository cannot currently produce.
- **No `gitnebula build` in the copy.** That command is story 4.1 and is not on
  this base; AC-1 forbids vapor claims. Likewise the Pages URL is 4.2's, and is
  the one sanctioned placeholder.

Full reasoning, including the rejected alternatives, is in the branch's
`DECISIONS.md`.

## Verification

- `pnpm -r test` — 67 test files, 874 tests passed, 2 skipped (1 file skipped).
  No code changed; the run proves nothing broke.
- `pnpm lint` — clean (ESLint + Prettier).
- GitHub render check on the branch view, and the demo replayed end to end:
  see [MANUAL_TESTING.md](MANUAL_TESTING.md).

## Follow-ups for the epic

1. When **4.1** merges, add `gitnebula build` to the README quickstart.
2. When **4.2** merges, replace the map-of-itself placeholder with the Pages
   URL and delete the TODO comment beside it.
3. AC-5 (copy review) and the owner's steps in `MANUAL_TESTING.md` are the
   maintainer's, and are deliberately left unticked.
