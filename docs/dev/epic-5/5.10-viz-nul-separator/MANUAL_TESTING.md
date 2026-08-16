# Manual testing — 5.10-viz-nul-separator

Executed in `/Users/jundymek/dev/gitnebula-agents/pamela` on
`story/5.9-repo-test-command-false-green`, rebased onto epic head `b0dd6bf`.
macOS 25.5, Node 22, pnpm 10.34.5. Every step below was run; observed output
is recorded inline. This story ships no UI, so nothing is left for a human eye
and no step is unticked.

## 1. Reproduce the byte (AC-5, before)

- [x] Sweep every tracked file, counting NUL bytes directly:

```
$ git ls-files -z | while IFS= read -r -d '' f; do
    n=$(LC_ALL=C tr -dc '\0' < "$f" | wc -c | tr -d ' ')
    [ "$n" != "0" ] && echo "$n NUL  $f"
  done
67410 NUL  docs/assets/demo.gif
1230 NUL  docs/dev/epic-4/4.4-dod-validation/map-excalidraw.png
2344 NUL  docs/dev/epic-4/4.4-dod-validation/map-streamlit.png
1322 NUL  docs/dev/epic-4/4.4-dod-validation/map-fastapi.png
228645 NUL  packages/deps/assets/tree-sitter-python.wasm
1 NUL  packages/viz/src/engine/layout.ts
```

**Observed:** exactly the five genuine binary assets the spec names, plus one
source file. `grep -an 'const key' packages/viz/src/engine/layout.ts` shows it
at line 238 as `` const key = `${source}^@${target}`; `` under `cat -v`.

- [x] **The locale trap, observed on the way in.** The same loop *without*
      `LC_ALL=C` printed `tr: Illegal byte sequence` four times and listed only
      **two** of the six files — silently skipping four of the very files it
      was looking for. Recorded because it is the same class of failure as the
      defect: a sweep that reports clean while the byte is there.

## 2. The tool's first console output, on a clean clone (AC-5, before)

- [x] `git clone --no-local` of the branch before the fix, analysed with the
      built binary:

```
! scan: binary-file ×1 (e.g. packages/viz/src/engine/layout.ts)
! scan: data-blob ×1 (e.g. packages/contract/fixtures/synthetic-100x2000.json)
… 406 nodes, 492 edges, 181 co-change pairs …
```

**Observed:** gitnebula warns a stranger about gitnebula's own source file, in
the run summary a first-time visitor reads. This is the half that got the story
scheduled, and it reproduces exactly as alice reported it.

- [x] The node itself:

```
node   : loc=0 layer=backend parent=packages/
out(3) -> engine/graph.ts, engine/prng.ts, engine/settle.ts
in (4) <- engine/camera.ts, engine/engine.ts, engine/layout.test.ts, engine/navigation.test.ts
```

**Observed:** `loc: 0`, 3 out-edges, 4 in-edges — reproducing arnold's measured
expectation rather than citing it. `deps` does not read the scanner's `binary`
flag, so the coupling survives and only the line count is lost.

## 3. The same clean clone after the fix (AC-5, after)

- [x] Cloned the branch at `624d19d` and analysed it the same way:

```
! scan: data-blob ×1 (e.g. packages/contract/fixtures/synthetic-100x2000.json)
… 407 nodes, 493 edges, 181 co-change pairs …
```

**Observed:** the `binary-file` warning is **gone from the summary entirely** —
not reduced, absent. The remaining warning is story 5.12's generated fixture,
which is expected and correct.

- [x] The node itself:

```
node   : loc=388 layer=backend parent=packages/
out(3) -> engine/graph.ts, engine/prng.ts, engine/settle.ts
in (4) <- engine/camera.ts, engine/engine.ts, engine/layout.test.ts, engine/navigation.test.ts
```

**Observed:** `loc: 0 → 388`. The edges are **identical in both directions**,
which is the evidence the fix changed nothing but the byte.

- [x] The whole-document delta, computed rather than eyeballed:

```
added nodes:   scripts/nul-sweep.mjs
removed nodes: (none)
added edges:   scripts/verify-test-commands.mjs -> scripts/nul-sweep.mjs
removed edges: (none)
```

**Observed:** the only structural change to the map is this story's own new
file and the import that reaches it. Nothing else moved.

## 4. The check fails when the byte comes back (AC-3)

- [x] Injected one NUL into a different tracked source file
      (`packages/viz/src/engine/settle.ts`, offset 4) and ran the tooling check:

```
  FAIL no tracked text file carries a NUL byte
verify-test-commands: 1 failed
  - no tracked text file carries a NUL byte
       packages/viz/src/engine/settle.ts:2 — literal NUL byte at offset 4
 ELIFECYCLE  Command failed with exit code 1.
```

**Observed:** exit 1, with the file, the line and the byte offset — enough to
act on a byte that renders as nothing in an editor.

- [x] **The grep trap, on that same broken tree.** With the byte present:

```
$ grep -rlP '\x00' packages/viz/src/          → no output, exit 1
$ grep -n 'import' packages/viz/src/engine/settle.ts  → no output, exit 0
$ node scripts/nul-sweep.mjs
nul-sweep: 1 tracked text file(s) carry a NUL byte
  packages/viz/src/engine/settle.ts:2 — literal NUL byte at offset 4
```

**Observed:** the sweep bob and superman both reached for reports the tree
clean *while the byte is in it*, and grep suppresses even ordinary matches in
that file. The byte-based sweep finds it. This is why the check reads bytes
itself.

- [x] Restored with `git restore` and re-ran:

```
nul-sweep: no tracked text file carries a NUL byte   (exit 0)
```

**Observed:** green again, working tree clean.

## 5. The scanner is untouched (AC-4)

- [x] `git status --short packages/scanner/` → **empty**.
- [x] `pnpm --filter @gitnebula/scanner test` → **8 files, 150 tests passed**,
      including `keeps a binary file in the universe at 0 LOC and counts it`
      at `analyze.test.ts:386`, unchanged.

## 6. Suites and build (AC-6)

- [x] `pnpm lint` → **exit 0** (eslint + `prettier --check`).
- [x] `pnpm --filter @gitnebula/viz test` → **Test Files 55 passed (55)** /
      **Tests 806 passed (806)**.
- [x] `pnpm test` → **exit 0**: contract 105, scanner 150, githist 74, deps 66
      passed + 2 skipped, viz 806, cli 145, then
      `verify-test-commands: 6 packages, all checks passed` — now twelve checks,
      the twelfth being the NUL sweep.
- [x] `pnpm build` → **exit 0** (viz via vite, cli via tsup).
