# 4.6 — The command in the README does not exist

Epic 4, story 4.6. Owner module: `cli`.

## What this story fixes

Story 4.1 moved the built binary from `dist/gitnebula.js` to
`dist/bin/gitnebula.js` — the depth is load-bearing, and
`packages/cli/tsup.config.ts` says why. Story 4.3 wrote the README,
CONTRIBUTING and the recording recipe against the path that existed while it
was being written, and merged first. Neither PR was wrong; the merge of the two
was, and left three printed commands answering `ENOENT`. One of them,
README:54, is the only command a visitor can run today, because `npx gitnebula`
is not published until 4.5.

Three things landed:

1. **The three paths point at the binary that exists**, and every command the
   three documents print was executed from a clean clone (`MANUAL_TESTING.md`
   records the walk and its output).
2. **The README gained `gitnebula build`** — the command 4.1 shipped and no
   story documented: what it writes, `-o`, and one line on hosting the result.
   No Pages claim; that is 4.2's, and its `TODO(4.2-ci-pages-recipe)` marker is
   untouched.
3. **A check that sees this class of drift.** `packages/cli/src/docs-paths.test.ts`
   builds the workspace, scans the instructional documents for
   `packages/*/dist/…` references and fails on any that does not exist. It was
   watched failing against the pre-fix tree, naming exactly the three lines.

## The dev-checkout gap, and what the docs now say

The clean-clone walk turned up more than a rename. After
`pnpm install && pnpm build`, three of the printed commands still failed:
serving stopped at "the viewer has not been built" (404 on `/` and
`/analysis.json`), `gitnebula build` refused for the same reason, and a
repository containing Python failed its `deps` stage with
`ENOENT … packages/cli/assets/tree-sitter-python.wasm`.

One cause: `packages/cli/assets/` is populated by
`packages/cli/scripts/prepack.mjs`, which npm runs on `pack`/`publish` and
never during development. Running it by hand fixes all three — verified. So the
three documents print that line, with the reason beside it, rather than
printing a command that fails. Story 4.5's AC-6 owns removing the extra step;
when it lands, each document loses one line. No packaging was changed here.

## Files

| file | | why |
| ---- | - | --- |
| `README.md` | UPDATE | the fallback command's path, the working four-line dev recipe, and the `gitnebula build` section |
| `CONTRIBUTING.md` | UPDATE | the "try a change end to end" recipe: path, prepack step, and what fails without it |
| `docs/recording-demo.md` | UPDATE | the re-recording recipe's path and prepack step |
| `packages/cli/src/docs-paths.test.ts` | NEW | the stale-path check (AC-3) |
| `packages/cli/src/test-support.ts` | UPDATE | `buildWorkspace()` — `pnpm build` serialized across vitest workers, so two suites needing a fresh build cannot race |
| `packages/cli/src/pack.test.ts` | UPDATE | uses `buildWorkspace()`; its own `build()` moved, semantics unchanged |
| `docs/implementation-artifacts/epic-4-ship-it/4.6-docs-path-drift.md` | UPDATE | tasks ticked, Dev Agent Record |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's row |
| `docs/dev/epic-4/4.6-docs-path-drift/` | NEW | this README and `MANUAL_TESTING.md` |

## Decisions worth knowing

- **The check lives in `pnpm test`, not in a script.** AC-3 requires it beside
  the existing suites; root `pnpm test` is `pnpm -r test`, so a package suite is
  the only place that runs under the documented command.
- **It builds, and the build is locked.** A path is checked against a fresh
  build, never against a stale `dist/` — `tsup` cleans its output, so a `dist/`
  predating 4.1's rename would still contain the dead path and the check would
  pass on the very defect it exists to catch. `pack.test.ts` already built
  unconditionally for the same reason; both now go through one lock-protected
  helper instead of racing.
- **Scope is narrow on purpose.** `README.md`, `CONTRIBUTING.md`, `docs/*.md`.
  `docs/implementation-artifacts/` and `docs/dev/` are excluded: a dead path
  there is usually the subject, not an instruction — this story's own spec names
  `packages/cli/dist/gitnebula.js` deliberately, and so do the Epic 4
  retrospective and 4.1's record. The escape hatch for a genuine instruction is
  an inline `<!-- stale-path-ok: <path> — reason -->` marker, never a file-wide
  exclusion: it covers its own line and the line after it, so a command that
  drifts into the same document later is still caught.
- **The build lock reclaims orphans.** The holder writes its pid into the lock
  directory; a waiting caller that finds the holder gone removes the lock and
  proceeds. Without that, one killed vitest worker would block every later test
  run until somebody deleted the directory by hand. Codex review raised both
  this and the exemption's original document-wide scope; both are fixed.
- `docs/dod-report.md` is in scope and passes: its one reference is the
  directory `packages/cli/dist/`, which exists after a build.

Full reasoning, with the measurements behind it, is in `DECISIONS.md` at the
branch root.
