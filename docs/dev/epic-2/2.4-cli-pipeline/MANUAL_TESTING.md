# Manual testing — 2.4 CLI pipeline

Everything below is automated except what a person has to *look at*: the shape
of the progress output in a real terminal.

**Executed 2026-08-13** by the story's agent, at the maintainer's request, on
`story/2.4-cli-pipeline` rebased onto `epic/2-scanner-core`. Machine: Apple M4
Pro, Darwin 25.5.0 arm64, Node v22.20.0. Observed results are recorded under
each check so the run can be judged without repeating it — re-run anything that
looks surprising.

The TTY sections were run under a real pty (`script -q /dev/null …`), not
simulated, because `isTTY` decides whether the reporter rewrites a line or
stacks lines.

Prerequisites:

```sh
pnpm install
pnpm build                                # produces packages/cli/dist/gitnebula.js
sh ./test-fixtures/build-fixture-repo.sh  # AD-14 fixture repo, prints its HEAD
```

Run the binary as `node packages/cli/dist/gitnebula.js` (the package is not
linked onto PATH until it is published).

## 1. A normal run in the fixture repo

```sh
cd /tmp && mkdir -p gitnebula-manual && cd gitnebula-manual
node <repo>/packages/cli/dist/gitnebula.js \
  <repo>/test-fixtures/.generated/history-repo \
  --window-anchor 2026-01-01T00:00:00Z --window-days 365
```

- [x] Every stage prints a `▸` start line and a `✔` end line, in the order
      repo, config, scan, deps, githist, assemble, enrich, emit.
      → all eight present, in that order.
- [x] `deps` and `githist` visibly overlap — both start before either ends.
      → `▸ deps` and `▸ githist` both precede `✔ deps`.
- [x] Each end line carries an elapsed time that looks plausible (not `0.00s`
      for the stages that actually did work).
      → repo 0.04s, scan/deps/githist 0.01s each. `assemble`, `enrich` and
      `emit` do read `0.00s`, which is honest on a 3-file repository: they
      merge six nodes, return the analysis unchanged and write 2 KB. Section 2
      is where the working stages show real numbers.
- [x] The last line names the written file and the node/edge/co-change counts.
      → `…/analysis.json — 6 nodes, 0 edges, 0 co-change pairs in 0.06s`.
- [x] `analysis.json` exists in the current directory and opens as valid JSON.
      → parsed with `JSON.parse`, 6 nodes.
- [x] Exit code is 0 (`echo $?`).

## 2. Progress counts on a repository big enough to see them

Run it against this repository itself, in a scratch directory:

```sh
node <repo>/packages/cli/dist/gitnebula.js <repo>
```

- [x] Within-stage counts appear (`  scan 812/2043`) and update in place rather
      than scrolling — this is the TTY path, which the automated tests can only
      simulate.
      → under a pty, `scan` counted 1→236 and `deps` 30→134 as single
      carriage-returned lines. While `deps` and `githist` overlapped the
      reporter dropped to stacked lines, as designed, and `deps` returned to
      in-place rewriting once `githist` finished.
- [x] The counts never leave a half-overwritten line behind when the stage ends.
      → checked on the raw pty bytes rather than by eye: after stripping the
      pty's own CRLF translation, both rewrite groups end on a complete count
      followed by a newline, and no rewrite is shorter than the one before it,
      so no residue of a longer line can survive.
- [x] Total wall-clock time is reasonable (FR-1's budget is 60 s for a
      500–2,000-file repository; record the number and the machine).
      → **0.20 s** for 236 analyzable files / 241 nodes / 257 edges on an Apple
      M4 Pro. Note this repository is *below* FR-1's 500–2,000-file band, so
      this is an indicative number, not the budget check. The real measurement
      belongs to 4.4's DoD run on fastapi, excalidraw and streamlit.

## 3. Failure output

```sh
mkdir -p /tmp/not-a-repo && node <repo>/packages/cli/dist/gitnebula.js /tmp/not-a-repo
```

- [x] Prints `✖ repo (…)` and then
      `repo: <path> is not a git repository — run gitnebula inside a git repository, or pass the path to one`.
      → exactly that, with the path echoed back.
- [x] Exit code is 1.
- [x] The remedy reads like advice a stranger could act on.
      → it names both ways out (be inside a repository, or point at one).
      Reviewing the other failure messages the same way found one that read
      badly: URL mode's remedy carried a second em dash, which competed with
      AD-7's `cause — remedy` split. Reworded to a semicolon.

## 4. Configuration and the llm notice

Put this in the fixture repo's root as `.gitnebula.yml`:

```yaml
excludes:
  - "legacy/**"
windowDays: 365
llm:
  backend: ollama
```

- [x] The ignored-in-MVP notice about `llm` is printed exactly **once**, near
      the top, and reads as informational rather than as a warning.
      → one occurrence, immediately after `✔ config`, prefixed `note:` and
      ending "nothing else about the analysis changes".
- [x] Nothing else about the run changes: same stages, same exit code (FR-8).
      → same eight stages, exit 0. `excludes` also took effect: `legacy/` and
      `legacy/old.ts` left the node set, 6 nodes → 5.
- [x] Now break it — change `windowDays: 365` to `windowDays: soon` — and check
      the failure names the file, the **line** and the key.
      → `config: <repo>/.gitnebula.yml:3: "windowDays" must be a whole number
      of days of at least 1 — use a value such as 90`, exit 1. Line 3 is where
      the key is.
- [x] Delete the file again so the fixture repo is left as the build script
      made it.
      → deleted; `git status` in the fixture repo is clean.

## 5. Determinism, by eye

```sh
node <repo>/packages/cli/dist/gitnebula.js <fixture-repo> \
  --window-anchor 2026-01-01T00:00:00Z --out a.json
node <repo>/packages/cli/dist/gitnebula.js <fixture-repo> \
  --window-anchor 2026-01-01T00:00:00Z --out b.json
diff a.json b.json
```

- [x] The only differing line is `analyzedAt`.
      → `diff` reported exactly one hunk, `6c6`, the two run instants
      (`07:21:23.583Z` vs `07:21:23.948Z`).

## 6. URL mode is refused, not half-implemented

```sh
node <repo>/packages/cli/dist/gitnebula.js https://github.com/jundymek/gitnebula
```

- [x] Refused with a message naming story 3.2; nothing is cloned, no network
      access happens, exit code 1.
      → refused before any stage started, exit 1, and the working directory was
      still empty afterwards.

## Accessibility

Not applicable — this story ships no UI. The terminal output uses `▸ ✔ ✖` as
*decoration*: every line also names its stage in words, and no meaning is
carried by colour or by a glyph alone.
