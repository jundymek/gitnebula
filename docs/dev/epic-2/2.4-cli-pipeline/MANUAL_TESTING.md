# Manual testing — 2.4 CLI pipeline

Everything below is automated except what a person has to *look at*: the shape
of the progress output in a real terminal. Boxes are left unticked for the
maintainer.

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

- [ ] Every stage prints a `▸` start line and a `✔` end line, in the order
      repo, config, scan, deps, githist, assemble, enrich, emit.
- [ ] `deps` and `githist` visibly overlap — both start before either ends.
- [ ] Each end line carries an elapsed time that looks plausible (not `0.00s`
      for the stages that actually did work).
- [ ] The last line names the written file and the node/edge/co-change counts.
- [ ] `analysis.json` exists in the current directory and opens as valid JSON.
- [ ] Exit code is 0 (`echo $?`).

## 2. Progress counts on a repository big enough to see them

Run it against this repository itself, in a scratch directory:

```sh
node <repo>/packages/cli/dist/gitnebula.js <repo>
```

- [ ] Within-stage counts appear (`  scan 812/2043`) and update in place rather
      than scrolling — this is the TTY path, which the automated tests can only
      simulate.
- [ ] The counts never leave a half-overwritten line behind when the stage ends.
- [ ] Total wall-clock time is reasonable (FR-1's budget is 60 s for a
      500–2,000-file repository; record the number and the machine).

## 3. Failure output

```sh
mkdir -p /tmp/not-a-repo && node <repo>/packages/cli/dist/gitnebula.js /tmp/not-a-repo
```

- [ ] Prints `✖ repo (…)` and then
      `repo: /tmp/not-a-repo is not a git repository — run gitnebula inside a git repository, or pass the path to one`.
- [ ] Exit code is 1.
- [ ] The remedy reads like advice a stranger could act on.

## 4. Configuration and the llm notice

Put this in the fixture repo's root as `.gitnebula.yml`:

```yaml
excludes:
  - "legacy/**"
windowDays: 365
llm:
  backend: ollama
```

- [ ] The ignored-in-MVP notice about `llm` is printed exactly **once**, near
      the top, and reads as informational rather than as a warning.
- [ ] Nothing else about the run changes: same stages, same exit code (FR-8).
- [ ] Now break it — change `windowDays: 365` to `windowDays: soon` — and check
      the failure names the file, the **line** and the key.
- [ ] Delete the file again so the fixture repo is left as the build script
      made it.

## 5. Determinism, by eye

```sh
node <repo>/packages/cli/dist/gitnebula.js <fixture-repo> \
  --window-anchor 2026-01-01T00:00:00Z --out a.json
node <repo>/packages/cli/dist/gitnebula.js <fixture-repo> \
  --window-anchor 2026-01-01T00:00:00Z --out b.json
diff a.json b.json
```

- [ ] The only differing line is `analyzedAt`.

## 6. URL mode is refused, not half-implemented

```sh
node <repo>/packages/cli/dist/gitnebula.js https://github.com/jundymek/gitnebula
```

- [ ] Refused with a message naming story 3.2; nothing is cloned, no network
      access happens, exit code 1.

## Accessibility

Not applicable — this story ships no UI. The terminal output uses `▸ ✔ ✖` as
*decoration*: every line also names its stage in words, and no meaning is
carried by colour or by a glyph alone.
