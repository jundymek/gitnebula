# 6.6 — manual testing

Machine: darwin 25.6.0, Apple silicon, pnpm 10.34.5, node 22, one worktree
(`gitnebula-agents/arnold`). `UI_PORT=4330` throughout, because 4320 may be held
by another worktree — the override the suite's config documents.

Every step below was executed. The one unchecked box is AC-9, a human-review
item the story spec leaves for the owner, and the reason is stated on it.

---

- [x] **1. `pnpm --filter @gitnebula/viz test`** — the package's own suite,
      unchanged by this story (no product code, no spec added).

  ```
   Test Files  56 passed (56)
        Tests  827 passed (827)
  ```

- [x] **2. `UI_PORT=4330 pnpm --filter @gitnebula/viz ui`** — the browser suite.
      The story spec requires it to stay at 44 tests and green, since this story
      adds no spec.

  ```
    44 passed (37.2s)
  ```

  Run twice: once before the README was written and once after, with the same
  result both times.

- [x] **3. `playwright test -c ui/playwright.config.ts --list`** — the source of
      the README's inventory table. Not transcribed from a story README; read
      from the listing.

  ```
  Total: 44 tests in 8 files
  ```

  Per file: `smoke` 3, `boot` 2, `view-swap` 5, `pointer-hit` 2, `load-failure`
  11, `validator-seam` 11, `reachability` 7, `tooltip-edges` 3. Sums to 44.

- [x] **4. `pnpm exec vitest list --filesOnly | grep ui/`** — the check behind
      the README's claim that the separation is at the spec-file level, not the
      directory level.

  ```
  ui/src/suite-conventions.test.ts
  ```

  So `ui/` does contribute one file to `pnpm test`, and the README says so
  rather than claiming the directory is wholly on demand.

- [x] **5. `pnpm exec vitest list | grep -c '^src/chrome/'`** — re-measuring the
      jsdom count story 6.1's README records as ~318.

  ```
  323
  ```

  Three stories have landed since that README was written. The new file records
  323 across 21 files.

- [x] **6. `pnpm lint`** — `eslint . && prettier --check .`, exit 0.

  ```
  Checking formatting...
  All matched files use Prettier code style!
  ```

  `packages/viz/ui/README.md` is **not** covered by `.prettierignore` (which
  ignores `docs/`, not `packages/`), so it was formatted with
  `prettier --write` before this run. The two files under `docs/dev/` are
  ignored by that config and were not reformatted.

- [x] **7. `pnpm test`** — the whole workspace, exit 0.

  ```
  packages/contract  105 passed (105)   |  3 files
  packages/scanner   150 passed (150)   |  8 files
  packages/githist    74 passed (74)    |  5 files
  packages/deps       66 passed | 2 skipped (68)  |  8 passed | 1 skipped
  packages/viz       827 passed (827)   | 56 files
  packages/cli       145 passed (145)   | 15 files
  test:tooling       verify-test-commands: 6 packages, all checks passed
  ```

  Exit code checked explicitly: `pnpm test >/dev/null 2>&1; echo $?` → `0`.

- [x] **8. `node scripts/specwitness/docs-presence.mjs`, before and after.** The
      probe was run, never edited.

  Before:

  ```json
  {"uiReadmePresent":false,"uiReadmeMentionsOnDemandSeparation":false,
   "uiReadmeMentionsBootGap":false,"uiReadmeMentionsCaptureRestore":false,
   "uiReadmeMentionsJsdomCanvas":false,"uiReadmeMentionsHandleReacquire":false, ...}
  ```

  After:

  ```json
  {"uiReadmePresent":true,"uiReadmeMentionsOnDemandSeparation":true,
   "uiReadmeMentionsBootGap":true,"uiReadmeMentionsCaptureRestore":true,
   "uiReadmeMentionsJsdomCanvas":true,"uiReadmeMentionsHandleReacquire":true, ...}
  ```

  All five keyword fields flip. `validatorReportPath` and `layoutReportPath` are
  still `null` — the `findReport` recursion defect the closure review reported,
  out of scope here and untouched.

- [x] **9. Scope check.** `git status --porcelain` at the end of the work:

  ```
  ?? docs/dev/epic-6/6.6-viz-ui-readme/
  ?? packages/viz/ui/README.md
  ```

  and `git diff --stat origin/epic/6-assembled-viewer -- packages/viz/src
  .specwitness scripts/specwitness docs/implementation-artifacts/sprint-status.yaml`
  is **empty**. The spec file itself is edited separately, for its Tasks and Dev
  Agent Record.

- [x] **10. Every `path:line` in the new README opened and read.** Each citation
      was checked against the file at the branch head rather than copied from
      the story spec. Two were corrected in the process: the `CarriedState`
      interface ends at `app.ts:206`, not `:207`, and `reuseExistingServer` sits
      at `playwright.config.ts:100`, closing the comment block that starts at
      `:88`. The full table is in this folder's `README.md`.

- [ ] **11. AC-9 — read the README cold as a first-time contributor.**
      Left for the owner, deliberately: I wrote the document, so I cannot read
      it cold, and "does this work as an entry point for someone who has never
      opened `packages/viz/ui/`" is the one claim in the story that no command
      settles. What I can report is the structure it was built to: the first
      screen answers *what this is* and *why it is not in `pnpm test`* before
      anything else, the four browser-only facts come after the inventory rather
      than before it, and every assertion in the file carries the `path:line`
      that makes it checkable.
