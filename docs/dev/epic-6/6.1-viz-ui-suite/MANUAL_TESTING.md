# Manual testing — story 6.1, the `ui` suite skeleton

Every step below was **executed** on the story branch before the PR was
opened, and the observed result is recorded inline. A step that could not be
run headless is left unchecked with the reason stated.

Machine: macOS (darwin 25.6.0), Apple silicon, Node ≥ 20, pnpm 10.34.5,
Playwright 1.62.1 / Chrome Headless Shell 151.0.7922.34. A second agent was
working on the same machine throughout, which is relevant to step 8.

---

## 1. The suite runs on its default port

```bash
pnpm --filter @gitnebula/viz ui
```

- [x] **Ran.** 3 passed (8.0s):
  - `the harness reaches a booted Viewer and the layout settles` (877ms)
  - `the suite serves the fixture its config names, not the dev default` (723ms)
  - `the smoke check can fail: the same wait, given a key that is not the handle` (5.1s)

The third test is the negative control (AC-5). It takes ~5 s by design: it
waits out a 5,000 ms timeout proving that the handle wait does **not** resolve
for a key the Viewer never publishes.

## 2. The `UI_PORT` override works

```bash
UI_PORT=4331 pnpm --filter @gitnebula/viz ui
```

- [x] **Ran.** 3 passed (7.7s). Also exercised at `UI_PORT=4324`, `4325` and
      `4332` during the failure-mode checks below — every one started its own
      server on the port given and ran the suite against it.

## 3. The suite refuses to share a server (AC-2) — the story-3.5 failure mode

This is the check that matters most, so it was reproduced deliberately rather
than reasoned about. A **foreign** dev server was started on 4320 serving a
*different* fixture, standing in for another agent's worktree:

```bash
GITNEBULA_FIXTURE=single-module pnpm --filter @gitnebula/viz exec vite --port 4320 --strictPort &
curl -s http://localhost:4320/analysis.json | head -c 120
pnpm --filter @gitnebula/viz ui
```

- [x] **Ran.** The foreign server came up and served
      `"name": "fixture-single-module"` at `/analysis.json` — i.e. a document
      that is not this suite's. The suite then **refused to run**:

  ```
  Error: http://localhost:4320 is already used, make sure that nothing is
  running on the port/url or set reuseExistingServer:true in config.webServer.
  ```

  This is the correct outcome and the whole point of
  `reuseExistingServer: false`. With `!process.env.CI` — the convenient setting
  — the run would have attached to the foreign server and reported **3 passed**
  over a checkout that is not the one under test. During review of story 3.5
  exactly that happened: a green 8-passed run traced by `lsof` to another
  checkout entirely.

## 4. `pnpm test` needs no browser (AC-3)

Verified in both directions by pointing Playwright at an empty browser
directory, rather than by asserting it from the script definitions:

```bash
mkdir -p /tmp/no-browsers-6.1
PLAYWRIGHT_BROWSERS_PATH=/tmp/no-browsers-6.1 pnpm --filter @gitnebula/viz test
PLAYWRIGHT_BROWSERS_PATH=/tmp/no-browsers-6.1 pnpm --filter @gitnebula/viz ui
```

- [x] **Ran.** `test`: **56 files, 814 tests passed** with no browser
      available.
- [x] **Ran.** `ui`: failed loudly —
      `Error: browserType.launch: Executable doesn't exist at
      /tmp/no-browsers-6.1/chromium_headless_shell-1234/...`

So `pnpm test` genuinely does not require a browser, and the `ui` suite
genuinely does. The `test` script itself is byte-unchanged by this story.

## 5. The neighbouring `perf` suite still passes (AC-4)

```bash
pnpm --filter @gitnebula/viz perf
```

- [x] **Ran.** **10 passed (1.4m)** — all five spec files green after
      `openViewer` moved to `packages/viz/harness/page-helpers.ts` and the five
      import lines were repointed. See step 8 for one caveat about `fps-3d`
      that is not caused by this story.

## 6. The suite can be shown to fail — beyond the built-in control

The negative control in step 1 is permanent. Three further failure modes were
induced by hand and then reverted, to confirm the suite reports the *right*
failure rather than merely failing:

- [x] **Wrong fixture pinned** (`root-files` → `single-module`): exactly one
      test went red, the fixture assertion, with its prose message —
      `the page is not serving the root-files fixture the config names — check
      GITNEBULA_FIXTURE in ui/playwright.config.ts`. The other two stayed
      green, so the check is specific.
- [x] **Nonexistent fixture** (`no-such-fixture`): the dev server logged
      `gitnebula: fixture not found at .../no-such-fixture.json — set
      GITNEBULA_FIXTURE` and all 3 tests failed on the handle wait. The 404 is
      loud on purpose (story 1.4); a silent fallback would have produced a run
      that looked normal while measuring nothing.
- [x] **Artifacts on a red run** land in `packages/viz/test-results/ui`, which
      `.gitignore` already covers, and `git status` stayed clean afterwards.
      Playwright's default (`ui/test-results`) is *not* ignored, which is why
      `outputDir` is set.

## 7. The conventions check can be shown to fail (AC-6)

`ui/src/suite-conventions.test.ts` is 8 assertions. Each was watched red before
being relied on — a test that has never been seen red proves nothing:

| mutation | result |
| --- | --- |
| add a bare `expect(1).toBe(1)` to a spec | ✗ `gives every expect a prose failure message (AC-6)` |
| write `"__gitnebula"` as a literal | ✗ `imports HARNESS_HANDLE_KEY rather than writing the literal (AC-6)` |
| add a direct `page.goto("/")` | ✗ `navigates through openViewer, never page.goto (AC-4)` |
| `reuseExistingServer: false` → `true` | ✗ `keeps the server isolation that the lsof incident bought (AC-2)` |
| delete the `lsof` comment | ✗ same check |
| `retries: 0` → `2` | ✗ `matches the house style the two existing suites set (AC-1)` |
| port `4320` → `4321` | ✗ `takes port 4320 and UI_PORT, continuing the series (AC-2)` |
| fixture → `zero-history` | ✗ `pins the fixture rather than inheriting the dev default (AC-7)` |
| remove `--strictPort` from the command | ✗ `keeps the server isolation…` — **see below** |

- [x] **Ran, and it found a real defect in my own check.** The first version of
      the `--strictPort` assertion was `config.includes("--strictPort")`.
      Deleting the flag from the dev-server command left the test **green**,
      because the explanatory comment underneath also mentions the flag. A
      check that a comment can satisfy is not a check. It now reads the
      `command:` template literal specifically, and re-running the same
      mutation with the comment left intact fails as it should:
      `the dev-server command (pnpm vite --port ${PORT}) no longer passes
      --strictPort — a port collision would silently move the server instead of
      failing, which is how a run measures the wrong checkout`.

All mutations were reverted; `git diff --stat` on both files was empty
afterwards.

## 8. Repository gates

- [x] `pnpm lint` — clean (`eslint` + `prettier --check`, "All matched files
      use Prettier code style!").
- [x] `pnpm --filter @gitnebula/viz typecheck` — clean. `harness` and `ui` were
      added to `tsconfig.json`'s `include`, so the new code is typechecked the
      way `perf` already is.
- [x] `pnpm test` (whole workspace) — **1354 passed, 2 skipped**: contract 105,
      scanner 150, githist 74, deps 66 (+2 skipped), viz 814, cli 145, plus all
      12 `verify-test-commands` tooling checks.
- [x] `pnpm build` — clean (viz via vite, cli via tsup; viewer assets 70.3 KB
      gzipped of the 2.00 MB budget).

**One caveat, not caused by this story.** On the first full `perf` run,
`fps-3d.pw.ts` failed: the `c-unfold-pan` phase measured below its 20 fps
usability floor while a second agent was building on the same machine. Re-run
alone it measured **21 fps** and passed; a subsequent full-suite run was
**10 passed**. Story 5.7 already recorded this phase at **22 fps**
(`docs/dev/epic-5/5.7-viz-3d-view/PERFORMANCE.md:47`), so the assertion sits
~1–2 fps above its own floor and flips under machine load. The entire `perf`
diff in this story is five import lines, none of which the 3D renderer loads.
Reported in the PR body and in this folder's README; deliberately not retuned
here.

## Not executed

- [ ] **Visual look-and-feel of the map in a real window.** `UI_HEADED=1` is
      wired and the suite runs under it, but judging the nebula aesthetic,
      settling feel and pan/zoom smoothness is a human check and is not
      something this story changes — no renderer, chrome or engine code is
      touched. It belongs to the epic's human-review checklist.
- [ ] **Screen-reader behaviour.** This story ships no UI: it adds a test
      harness. There is no new markup, no new control and no new focus order to
      audit. Accessibility of the chrome is covered by the jsdom suites and by
      story 6.5's `data-testid` work.
