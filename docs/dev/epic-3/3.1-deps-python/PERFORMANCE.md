# 3.1 — performance

The property this story is measured against is **AC-7**: the WASM parser's
initialisation time, which is new spend inside the SM-1 60 s pipeline budget.
The spec's rule is explicit — above 2 s it is a finding to flag, not something
to accept quietly.

## Method

Machine: Apple M4 Pro (12 cores), macOS 26.5.2, Node 22.20.0.

**Init (AC-7)** is measured in `packages/deps/src/python/parser.test.ts`, which
is a file of its own so vitest's per-file isolation gives it a cold process — a
second `Parser.init()` in the same worker measures nothing. It times
`Parser.init()` (compiling the tree-sitter runtime WASM) together with
`Language.load()` (the grammar), because no caller can have one without the
other:

```sh
pnpm --filter @gitnebula/deps exec vitest run src/python/parser --disable-console-intercept
```

**Stage runtime** comes from the AC-6 measurement, on a bare clone of streamlit
at `753fc013bb2a2781b1ff4830cc2b792103f2b9df` — 9,693 files in the universe, of
which 1,171 Python and 963 TS/JS:

```sh
GITNEBULA_MEASURE_REPO=<streamlit checkout> pnpm --filter @gitnebula/deps test
```

## Numbers

| what | budget | measured | verdict |
| --- | --- | --- | --- |
| `Parser.init()` + `Language.load()` | 2,000 ms (AC-7) | **7.2 ms**, 6.5 ms on a second run | pass, by three orders of magnitude |
| whole deps stage on streamlit (both languages, 2,134 source files) | part of SM-1's 60 s | **2,402 ms** | pass |
| committed grammar artifact | none stated | 449 KB | recorded, not budgeted |

The init cost is a one-off per process and is paid lazily: a repo with no Python
files never loads the grammar at all, because the loader is only reached from
the Python pass and that pass returns early on an empty source list.

The test asserts `< 2000 ms` so a regression — a much larger grammar, a runtime
that stops being cached, an accidental per-file re-init — fails rather than
merely being slower. There is no lower assertion: 7 ms is not a floor worth
defending, and pinning it would make the suite fail on slower hardware for no
gain.

## Regressions

None. This is the first record for `deps` on the Python side; story 2.2 measured
the TS/JS half on excalidraw and recorded no wall-clock budget ("well under a
second"), so there is no earlier number to compare 2.4 s against — the two runs
are different repositories.
