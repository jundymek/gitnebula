# Contract fixtures

Committed `analysis.json` documents that exercise the contract's edges. They
are the ONLY data viz stories see until the M2 integration milestone, so every
edge case skipped here becomes an integration surprise later.

Every fixture must pass `validateAnalysis` — the test suite loops over this
directory, so dropping a new `.json` file in here automatically puts it under
validation.

| Fixture                   | Purpose / edge it guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `empty-graph.json`        | Zero nodes, edges and cochanges; empty `languages`. Guards renderers and aggregators against the "nothing to draw" case (no division by zero, no empty-reduce crash).                                                                                                                                                                                                                                                                                                                                                                            |
| `single-module.json`      | The minimal non-empty document: one module, one file, no edges. Guards layout and panel code that assumes ≥ 2 nodes or any edge.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `cyclic-imports.json`     | Module-level import cycle `a/ → b/ → c/ → a/` with the underlying file-level edges. Guards traversals (dependency-chain highlight, topological assumptions) against infinite loops.                                                                                                                                                                                                                                                                                                                                                              |
| `module-zero-files.json`  | A module node (`ghost/`) with no child files next to a normal module, and a `null` `lastChangedAt` on it. Guards per-module aggregation and unfold behaviour against empty membership.                                                                                                                                                                                                                                                                                                                                                           |
| `zero-history.json`       | A repo with no analyzable history: `commits: 0`, `authors: 0`, all `churn: 0`, every `lastChangedAt: null`, Python + TS mix. Guards heat/churn visuals, stats and date formatting against the all-zero, all-null column.                                                                                                                                                                                                                                                                                                                         |
| `root-files.json`         | Repository-**root** files: three `kind: "file"` nodes with `parent: null` (`setup.py`, `test_proxy.py`, `version.py`) beside one ordinary module. Carries every edge direction that touches one: root → a module's file (`setup.py → fp/proxy.py`), a module's file → root (`fp/proxy.py → version.py`), and root → root (`setup.py → version.py`). Story 2.1 leaves root files parentless deliberately, and no other fixture has one — which is why the Viewer could drop 82% of a real repository's lines without a test noticing (story 4.7). |
| `synthetic-100x2000.json` | 100 modules / 2,000 files, generated — the performance yardstick from ADR-0006 / PRD FR-14 (60 fps target is measured against this document).                                                                                                                                                                                                                                                                                                                                                                                                    |

## Regenerating the synthetic fixture

```sh
node packages/contract/scripts/generate-synthetic-fixture.mjs
```

The generator is fully seeded (mulberry32, fixed seed and time anchor):
regeneration is byte-identical, and a test asserts exactly that. If you change
the generator, the committed output must be regenerated in the same commit.

## Adding a fixture

1. Drop `<name>.json` in this directory (stable sorts per ADR-0005: nodes by
   id, edges by source then target, cochanges by count desc then ids).
2. Add a row to the table above naming the edge it guards.
3. Run `pnpm --filter @gitnebula/contract test` — the validation loop picks it
   up with no test-code change.

Fixture _git repositories_ (for githist) are a different mechanism: they are
built, never committed — see `test-fixtures/README.md` at the repo root.
