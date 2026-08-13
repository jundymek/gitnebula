# 3.1 — Python import edges

`@gitnebula/deps` now parses Python as well as TS/JS. Python imports are read
with tree-sitter-python compiled to WASM and loaded through `web-tree-sitter`
(ADR-0001: no native bindings, no node-gyp anywhere in the `npx gitnebula`
path), resolved against the scanner's closed universe, and folded into the same
edge aggregation, the same warning counters and the same sort as the TS/JS half.
Two parsers, one output path (AC-5) — the story 2.2 snapshot is unchanged, byte
for byte.

## The public surface

Unchanged: `analyze({ root, scan }, config, onProgress)`. The package now also
exports `isPythonPath` (the mirror of `isTsJsPath`) and `grammarPath` (the
absolute path of the committed `.wasm`, which story 4.1's bundling will need).

`onProgress` now counts TS/JS **and** Python files on one scale. A Python repo
previously reported `0/0` while the stage did all its work; the callback's shape
is unchanged, so cli needs no change (DECISIONS D10).

## Files

| file | | why |
| --- | --- | --- |
| `scripts/build-grammar.sh` | NEW | builds the `.wasm` from pinned tree-sitter-cli + pinned grammar; `--check` proves reproducibility |
| `packages/deps/assets/tree-sitter-python.wasm` | NEW | the committed grammar (449 KB), an AD-11 deps asset |
| `packages/deps/assets/tree-sitter-python.wasm.sha256` | NEW | what the offline suite asserts against |
| `packages/deps/src/python/parser.ts` | NEW | `web-tree-sitter` runtime + grammar, loaded once, addressed via `import.meta.url` |
| `packages/deps/src/python/collect.ts` | NEW | source text → structured imports, via tree-sitter queries |
| `packages/deps/src/python/resolve.ts` | NEW | dotted module → repo file, by path arithmetic over the scan universe |
| `packages/deps/src/python/analyze.ts` | NEW | the per-file loop: classification into edge / external / unresolved / unparsable |
| `packages/deps/src/python/*.test.ts` | NEW | 26 tests, including the AC-1 checksum and the AC-7 init measurement |
| `packages/deps/src/index.ts` | UPDATE | the Python pass, the shared counters, one progress scale |
| `packages/deps/src/measure.test.ts` | UPDATE | the AC-6 measurement now counts both languages and the stage's wall time |
| `packages/deps/package.json` | UPDATE | `web-tree-sitter` dependency; `pretest` builds the Python fixture too |
| `test-fixtures/build-py-fixture-repo.sh` | NEW | the crafted Python tree (AD-14), a sibling script per `test-fixtures/README.md` |

`edges.ts` and `warnings.ts` are untouched. That was the point of story 2.2's
collect/resolve seam, and it held.

## The grammar, and why it is committed

```sh
./scripts/build-grammar.sh          # rebuild the artifact in place
./scripts/build-grammar.sh --check  # rebuild into a temp dir and diff
```

| pin | version | why |
| --- | --- | --- |
| `tree-sitter-cli` | 0.26.12 | builds the `.wasm` |
| `web-tree-sitter` | 0.26.12 | loads it — **same 0.26 line, deliberately** |
| `tree-sitter-python` | 0.25.0 | the grammar source, from its npm tarball |

A `.wasm` built by one tree-sitter minor and loaded by another fails at
`Language.load`: the language ABI is negotiated between compiled grammar and
runtime, and tree-sitter#5171 is the report of exactly that breakage across the
0.25/0.26 boundary. The grammar's own version moves independently — it is the
*tooling* that has to match. The artifact reports ABI 15, which a test asserts.

**Reproducibility (AC-1).** Two builds, run from different working directories
on the same machine, produced `36d25eee776af6293dc67bdf6f8f820af6a26bbc49e335cc4821dfd5a0dac685`
both times. The one input that leaks into the output is the **output file's
basename** — the emitted module records it, so `-o out1.wasm` and `-o out2.wasm`
differ in exactly one byte. The script therefore fixes the name, and `--check`
compares under it.

The full rebuild downloads the pinned CLI and a 106 MB wasi-sdk toolchain into
`~/.cache/tree-sitter` and takes minutes, so the test that runs it is opt-in
(`GITNEBULA_BUILD_GRAMMAR=1`); the default offline suite asserts the committed
artifact's sha256 and the pins in the script instead (DECISIONS D2). Nothing in
this path runs at analysis time: the grammar is a package asset, never a
download (AD-8).

## How Python imports resolve

Unlike TypeScript, Python needs no compiler to answer "what does this import
name" — its rules are path arithmetic. The resolver therefore never touches the
filesystem: it indexes the scan universe (AD-13) and answers from that, which
makes it a pure function of `(universe, import)` and trivially deterministic.

- **Source roots** are the repo root plus the parent of every top-level package.
  streamlit keeps its package at `lib/streamlit/` and imports it as
  `streamlit.x`, not `lib.streamlit.x`; resolving from the repo root alone would
  report most of the repo as unresolved. A directory is a source root when it
  directly contains a package (`__init__.py`) whose own parent is not one. On
  streamlit this finds `''`, `'lib'`, and two more.
- **`from pkg import name`** tries `pkg/name.py` first — the name may be a
  submodule. Where it is not, the name is a symbol and `pkg/__init__.py` is the
  dependency, because that is the file which defines it.
- **Relative imports** count dots from the importing file's own package: one dot
  is its directory, each further dot climbs. Dots that climb past the repo root
  resolve to nothing.
- **An absolute miss is `external`; a relative miss is `unresolved`.** stdlib and
  site-packages are indistinguishable from any other absolute import naming
  nothing in the repo — and zero-config means gitnebula runs on checkouts with
  no virtualenv, so any other classification would measure the user's
  environment. A relative import can only ever name a file in this repo, so a
  miss there is a real one (AC-3, DECISIONS D7).
- **Wildcards** (`from .helpers import *`) name the module and nothing else.
  **Aliases** (`import core.model as m`) change nothing about the target.
  **`from __future__ import annotations`** is a real stdlib import and is counted
  external — the grammar gives it its own node type, and leaving it out would
  quietly under-count.
- **`.pyi` stubs are targets, never parsed sources.** Parsing a stub beside its
  module would state the same imports twice, but a stub is a real destination:
  where nothing else answers a name, `pkg/thing.pyi` (or `pkg/__init__.pyi`) is
  the edge. A module always beats a stub of the same dotted name, which is what
  a type checker does too (DECISIONS D4).

Nothing throws. A file with syntax errors contributes no edges and one
`unparsable-file` warning, and the stage completes (AC-4).

## AC-6 — measurement on streamlit

Reproduce with:

```sh
git clone https://github.com/streamlit/streamlit && cd streamlit
git checkout 753fc013bb2a2781b1ff4830cc2b792103f2b9df
cd -; GITNEBULA_MEASURE_REPO=<that checkout> pnpm --filter @gitnebula/deps test
```

Pinned SHA `753fc013bb2a2781b1ff4830cc2b792103f2b9df` (2026-08-12, "Remove
`BaseWeb` for `DateInput` (#16460)"), **with no `npm install` and no
`pip install`** — a bare clone, the harder and more honest case.

| | |
| --- | --- |
| files in universe | 9,693 |
| Python files / TS-JS files | 1,171 / 963 |
| specifiers examined | 13,601 |
| **file edges resolved** | **6,845 — 3,958 Python, 2,887 TS/JS** |
| external (stdlib, packages, builtins) | 6,509 |
| outside universe | 0 |
| unparsable files | 1 |
| **unresolved** | **247 (3.5%)** |

FR-11's threshold is 20%; AC-6's is the same number. The rate is reported over
the specifiers that could have become an edge — externals are ignored by design,
not failures to resolve. Over all specifiers it reads 1.8%.

Both languages produce edges, which is the other half of AC-6.

Two details worth stating plainly, because both were checked rather than
assumed:

- **All 247 unresolved are TS/JS-side.** The Python half resolves every relative
  import in the repo; a probe over all 1,171 files found zero relative misses.
  The example kept on the warning is `@streamlit/protobuf in
  frontend/app/src/App.test.tsx` — an intra-repo workspace package reached by a
  bare specifier the repo's `paths` claims, with nothing installed. That is
  story 2.2's known limitation, unchanged and correctly counted.
- **The one unparsable file is `e2e_playwright/compilation_error_dialog.py`** —
  a file streamlit keeps deliberately broken to test its own error dialog. The
  parser is right about it.

## Performance

See [PERFORMANCE.md](PERFORMANCE.md): WASM init is 7 ms (AC-7), and the whole
deps stage runs streamlit in 2.4 s.

## Determinism (AD-4)

No clock and no RNG in the analysis path — also enforced by ESLint for this
package, which is why AC-7's measurement lives in a test using
`performance.now()` rather than inside `analyze()` (DECISIONS D9). Files are
processed in sorted path order, so the single example kept on each warning is
stable; the resolver's source-root order is fixed (shortest first, then
lexicographic); edges are sorted with code-unit comparison. The Python suite
runs `analyze` three times — twice plainly, once with the universe reversed —
and asserts byte-identical JSON.

## Verification

```
pnpm --filter @gitnebula/deps test   # 60 passed, 2 skipped (the opt-in measurement + rebuild)
pnpm lint                            # eslint + prettier, exit 0
pnpm typecheck                       # all six packages, exit 0
pnpm test                            # whole workspace
```

Every assertion here was seen red before it was trusted: forcing the source
roots to the repo root alone turns 5 tests red; removing the `__init__.py`
fallback for symbol imports turns 6 red; ignoring `hasError` turns the two
syntax-error tests red; a corrupted `.sha256` turns the AC-1 test red.

Manual testing: not applicable, and there is no `MANUAL_TESTING.md`. This story
ships no UI, no route and no keyboard-reachable surface — it is a library
function inside the Node pipeline. Every acceptance criterion is executable:
AC-1 through AC-5 and AC-7 from the test suite, AC-6 from the one-off local
measurement recorded above with the command that reproduces it.
