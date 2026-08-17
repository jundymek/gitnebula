# 5.11 — The start-here `core` ranking, corrected

**Story:** `docs/implementation-artifacts/epic-5-onboarding/5.11-viz-start-here-ranking.md`
**Module:** `viz` · **Base:** `epic/5-onboarding` · **Contract:** unchanged

## The problem, measured

The start-here panel's `core` list ranked by in-degree. On this repository that
produced:

| in-degree | loc | file |
| --- | --- | --- |
| 57 | 38 | `packages/contract/src/index.ts` |
| 23 | 77 | `packages/viz/src/engine/index.ts` |
| 22 | 158 | `packages/viz/src/engine/constants.ts` |
| 22 | 29 | `packages/viz/src/test-support/fixtures.ts` |
| 20 | 40 | `packages/cli/src/errors.ts` |

Four of five are barrels or leaves. About 340 lines between them, most of it
`export * from`. `packages/viz/src/engine/engine.ts` — 1,694 lines and the
actual heart of the product — ranked ninth and never appeared.

**In-degree measures ubiquity, not explanatory value**, and in a workspace with
barrel exports ubiquity concentrates precisely in the files that teach a
newcomer nothing. Reading all five told you this repository re-exports things.

This was not a bug in story 5.1: its AC-1 said "ranked by in-degree
descending" and that is what it built. The wrong hypothesis was in the spec, so
5.11 supersedes that clause rather than fixing a defect.

## The rule now

**`importers × lines of code`**, descending, ties on `id` by code point.

Both factors are load-bearing:

- **in-degree alone** crowns barrels — that is the finding above;
- **size alone** crowns whatever is longest whether or not anything depends on
  it. Measured, that put a 906-line stylesheet into `core`.

The product says: *a file you must read is one that a lot of code depends on
**and** that has enough in it to be worth reading.*

Result on this repository:

| importers | loc | file |
| --- | --- | --- |
| 13 | 1,694 | `packages/viz/src/engine/engine.ts` |
| 5 | 1,386 | `packages/viz/src/engine/engine3d.ts` |
| 19 | 333 | `packages/viz/src/engine/types.ts` |
| 22 | 158 | `packages/viz/src/engine/constants.ts` |
| 12 | 216 | `packages/cli/src/test-support.ts` |

3,787 lines instead of 342, no barrels, and the `GraphEngine` interface —
genuinely the thing to read second — is on the list.

## What was rejected, and why

Recorded because "we tried the obvious thing and it did not work" is exactly
what a diff does not preserve. Both were rejected by measurement, not argument.

- **Count only non-test importers.** Sounds principled: it should drop the
  test-fixture helper. Measured, it still put three barrels in the top five
  *and* pushed `engine.ts` further down, because most of that file's importers
  are tests.
- **`importers × sqrt(loc)`.** Damps size so ubiquity keeps more weight.
  Measured, it kept `contract/src/index.ts` and `engine/index.ts` in the top
  five — the two files the change exists to demote.

## Not overfit to this repository

Checked on two other real checkouts before committing to the rule:

- **842-node repo:** the old rule surfaced a 3-line and a 2-line `index.ts`.
  The new rule drops both and lists the types module, the feature-flag layer,
  the locale table and the generator.
- **176-node repo:** the old rule headed the list with a 31-line logger. The
  new rule heads it with the 832-line data store, then the exchange client and
  the agent base class.

## Design decisions

- **Barrels are demoted, not filtered.** A filter would have to decide what a
  barrel *is*, and the contract carries no such fact — only `loc`, which is
  the honest proxy. A file everything imports is still worth being able to
  see, so it stays in the list, lower down. A test asserts it is still there.
- **The blurb states the rule.** "the most code that the rest of the
  repository depends on". The ordering is a product of two numbers, and a
  reader who saw only one of them would think the list was sorted wrong.
- **Each row prints both numbers** — `13 importers · 1,694 lines` — so the
  order is explicable from the row itself.
- **`importers`, not `imports`.** The other two categories rank on out-degree
  and print "13 imports" meaning *it imports 13 files*; core's number is the
  opposite direction. One word doing both jobs in one panel is a reading error
  waiting to happen, and it mattered more once the row started printing two
  numbers and asking the reader to see why they are multiplied.
- **Only `core` changed.** Entry points and tests were measured too and rank
  fine — out-degree does not concentrate in barrels. Minimal change on
  purpose.
- **Still no new aggregation** (AD-1): `loc` is a contract field, in-degree is
  a count of contract edges that 5.1 already computed. This is a sort key.

## Files

| path | change |
| --- | --- |
| `packages/viz/src/chrome/start-here-model.ts` | the rule, the blurb, the row label, `loc` on the entry |
| `packages/viz/src/chrome/start-here-model.test.ts` | the barrel-versus-engine regression, restored tie coverage, corrected names of two tests that described the old rule |
| `packages/viz/src/chrome/start-here.test.ts` | the row's printed and accessible label |

## The honest wart

On this repository the fifth entry is `packages/cli/src/test-support.ts` — test
scaffolding that lives under `src/`, so no layer rule excludes it. Left alone:
excluding it needs a heuristic on file names, and that is the kind of rule that
works here and breaks on the next repository.
