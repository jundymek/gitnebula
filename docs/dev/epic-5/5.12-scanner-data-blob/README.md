# 5.12 — One generated fixture swallows the whole map

The maintainer opened the map of this repository and saw one enormous disc
covering most of the canvas with the real modules as specks around its edge.
The disc was `packages/` — the product's entire source — and it was that big,
and labelled layer **`test`**, because of a single file:
`packages/contract/fixtures/synthetic-100x2000.json`, a generated performance
fixture of 40,655 lines against a median file of 110.

## What changed

**The scanner leaves generated data blobs out of the analysed universe.** A
file in a *data* language — `json`, `yaml`, `toml`, `ini`, `xml` — longer than
`DATA_BLOB_LOC_THRESHOLD` (5,000 lines) does not become a node. Source is
never dropped however long it is, and data files small enough to be
hand-maintained stay, so `package.json` and a CI workflow are still on the map.

**Nothing is hidden silently.** Every drop is a counted warning naming the
path, which cli prints in its run summary:

```
! scan: data-blob ×1 (e.g. packages/contract/fixtures/synthetic-100x2000.json)
```

**The rule is written down for readers**, not only for maintainers: README.md
gained a *What the map leaves out* section stating it, with the numbers that
set the threshold.

## Why this mechanism and not the other

Two candidates were on the table. Both were measured against the real document
before either was chosen — the numbers are in [MEASUREMENTS.md](./MEASUREMENTS.md).

| | largest file ÷ median radius | `packages/` share of module area | `packages/` layer |
| - | ---: | ---: | --- |
| before | 8.08× | 60.5% | `test` |
| **scanner drops the blob** | **2.14×** | **47.2%** | **`backend`** |
| radius cap at 4× median | 8.08× → capped at 4× | **60.5%, unchanged** | `test`, unchanged |

**The radius cap was rejected on evidence.** The disc the maintainer actually
saw is the *module* node, and it sits at 3.41× the median module radius — under
a cap loose enough to preserve real size differences between modules it is not
clamped at all. And no view-side rule can fix the second half of the defect:
the layer. `packages/` was labelled `test` because a module's layer is the
dominant layer of its files by LOC (ADR-0002) and one fixture under a
`fixtures/` directory outweighed all the source. A drawn-size rule leaves that
claim about what the code *is* exactly as wrong as it was.

## Decisions worth knowing

- **Dropped, not kept at 0 LOC.** The scanner keeps binary files at 0 LOC
  deliberately, because a binary's line count is meaningless. A data blob's
  line count is *true* — and therefore misleading rather than absent, so
  zeroing it would put a false number in the panel. Dropping matches how
  excluded paths already leave the universe: before anything downstream sees
  them, so no stage is told to trust a node that is not there.
- **Detected by shape, not by name.** Generated files are not named
  predictably, which is why the existing exclude list — lockfiles by name, test
  snapshots by directory — could not have caught this one. The rule is
  deliberately narrow: a data language *and* a size no hand-maintained document
  reaches.
- **Threshold from the gap, not from taste.** In this repository the largest
  hand-maintained data file is `analysis.schema.json` at 229 lines and the
  largest source file is 1,694, while the blob is 40,655. 5,000 sits in empty
  space — an order of magnitude above anything a person maintains, an order of
  magnitude below the blob.
- **Zero-config ruled out the cheap fix.** A `.gitnebula.yml` entry in this
  repository would have cleaned up this map and left every other repository
  with the same defect; brief principle 1 says the default run must already be
  useful.
- **Known limit, recorded rather than fixed.** `.csv` and `.tsv` carry no entry
  in the language table, so they detect as `unknown` and are out of reach of
  this rule. Adding them would change `stats.languages` for every repository —
  wider than this defect asks for.

## Files

| file | | why |
| ---- | - | --- |
| `packages/scanner/src/analyze.ts` | UPDATE | the drop, the `data-blob` warning, `DATA_BLOB_LOC_THRESHOLD` and its justification |
| `packages/scanner/src/languages.ts` | UPDATE | `isDataLanguage` and the data-language set |
| `packages/scanner/src/analyze.test.ts` | UPDATE | five assertions: the drop, the two over-reach guards, module aggregation, determinism |
| `README.md` | UPDATE | *What the map leaves out* — the rule, where a reader finds it |
| `docs/dev/epic-5/5.12-scanner-data-blob/MEASUREMENTS.md` | NEW | before/after, the rejected candidate simulated, perf harness run |
| `docs/implementation-artifacts/epic-5-onboarding/5.12-scanner-data-blob.md` | NEW | the spec, written from the delegation message |

## Verifying it

```bash
pnpm --filter @gitnebula/scanner test          # 150 tests, 5 of them this rule
pnpm build && node packages/cli/dist/bin/gitnebula.js --no-serve --no-open -o /tmp/map.json
# the summary prints:  ! scan: data-blob ×1 (e.g. packages/contract/fixtures/synthetic-100x2000.json)
PERF_PORT=<free port> pnpm --filter @gitnebula/viz perf    # 10 passed, fixture still loads
```

Every new assertion was watched fail before being relied on: with the drop
disabled the three that assert it went red, and with the rule widened to drop
everything the two over-reach guards went red.
