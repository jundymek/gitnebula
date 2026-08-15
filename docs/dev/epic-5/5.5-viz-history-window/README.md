# 5.5 — Analysis window made legible

**Owner:** `viz` · **Touches:** `packages/cli` (terminal summary wording only)
· **PR base:** `epic/5-onboarding` · **Contract:** unchanged, `schemaVersion`
stays `"1.0"`

## The problem

Measured on a real langgraph checkout: **386 of 650 files carry
`commits: 0`** — not because the analysis failed, but because their last
change predates the analysis window. The panel rendered that as a bare `0` and
an em dash. The numbers were correct; the presentation was a bug report
waiting to happen.

Reproduced here at small scale with the repository's own deterministic fixture
(`test-fixtures/build-fixture-repo.sh`), whose history is 2024–2025. Analysed
at the default 90-day window from the 2026-01-01 anchor, **every node** comes
back `churn 0`, `commits 0`, `lastChangedAt null` — the exact "broken tool"
reading, on a repository that is simply old.

## What changed

### The window is data, never a literal (AC-1)

Every history metric in the panel now states the window it covers, sourced
from `repo.analysisWindowDays`. **The literal `90` appears nowhere in this
story's code** — `--window-days` makes the window configurable, and copy that
hardcodes it starts lying the moment anyone uses that flag.

The history rows (`churn`, `authors`, `last change`, `co-changes with`) sit in
a `role="group"` captioned `history · last {N} days`. The static rows
(`files`, `loc`) describe HEAD, not the window, and stay outside it.

**Why a group caption rather than a suffix on each label.** Suffixing produces
`last change 365d`, which is not a label anyone can read. A labelled group
states the window for every metric inside it — through the visible caption and
through `aria-label`, so a screen reader reaching any row is told the window
too. See `DECISIONS.md`.

### Absent is not zero (AC-2)

A node with `lastChangedAt: null` prints `no change in last {N} days` instead
of `—`, on a row carrying `is-empty`. The class matters: colour alone would
not survive a greyscale render or a colour-vision deficiency, so the
stylesheet pairs it with italics. The panel names `--window-days` as the exit.

### A quiet repository says so once (AC-3)

When `repo.stats.commits === 0`, **every** node is out of window, so the
per-node sentence would repeat on every node the reader opens — precisely the
failure AC-3 names. The repository-level notice wins and the per-node one is
suppressed. `repo-zero-history` beats `node-out-of-window`, asserted for every
node of the zero-history fixture.

### A flat heatmap is data, not a broken renderer (AC-4)

In `heat` mode, when more than half of file nodes sit at zero churn, the
legend says so with the count: `3 of 3 files unchanged in the last 90 days`,
plus the same `--window-days` exit. Absent — not merely hidden — when it does
not apply: a key for a case that does not hold is clutter the reader has to
rule out.

The count is a display-time count over values the contract already carries,
the same shape as the existing
`modules: nodes.filter(kind === "module").length` in `mountChrome`. No new
contract field, nothing written back (AD-1).

### The terminal names its window (AC-5)

```
analysis.json — 6 nodes, 0 edges, 0 co-change pairs, history over the last 90 days (--window-days), in 0.07s
```

Wording only. No pipeline, config or analyzer logic changed, and the cli suite
passes unchanged.

## Empty-state conventions — the part 5.6 builds on

`chrome/empty-state.ts` encodes UX-DR14 read literally:

> **An empty state names its CAUSE and offers an EXIT, in that order, one
> sentence each.** Never a bare em dash, never "no data", never a disabled
> control standing in for an absent one.

Two rules that carry the weight:

- **Name the lever, not the feeling.** The exit is `--window-days`, a toggle,
  a button — something the reader can act on without guessing. "Try adjusting
  your filters" is not an exit.
- **State the count when you have one.** `386 of 650 files unchanged` beats
  "some files". A number is what makes an empty state read as a measurement
  rather than as a failure — the whole point of this story.

### Why three peers copied the shape instead of importing it

All four wave-A stories have empty states (5.1's ranking categories, 5.3's
filter result, 5.4's scope). All three peers asked to match this convention,
and all three deliberately **carry their own strings in their own files**.

The reason is branch mechanics, and alice worked it out first: this module
does not exist on `epic/5-onboarding` until this PR merges, so a cross-branch
import would leave their branches uncompilable and their test commands red —
for a dependency none of them declared (`depends_on: []` on all four stories).

**That duplication is deliberate.** Consolidating the four into this module is
a wave-B tidy-up and belongs to 5.6, which is exactly what these conventions
were written to serve. It should not be read as two conventions drifting
apart — the wording was agreed in writing across all four intents.

## Files

| file | NEW/UPDATE | why |
|---|---|---|
| `packages/viz/src/chrome/empty-state.ts` | NEW | the UX-DR14 conventions 5.6 builds on |
| `packages/viz/src/chrome/empty-state.test.ts` | NEW | asserts the conventions, not the sentences |
| `packages/viz/src/chrome/legend.test.ts` | NEW | the legend had no suite before this story |
| `packages/viz/src/chrome/panel-model.ts` | UPDATE | window-aware rows, the two notice kinds |
| `packages/viz/src/chrome/panel-model.test.ts` | UPDATE | AC-1/2/3 at the model level |
| `packages/viz/src/chrome/panel.ts` | UPDATE | labelled history group, empty row class, notice element |
| `packages/viz/src/chrome/panel.test.ts` | UPDATE | AC-1/2/3 at the DOM level |
| `packages/viz/src/chrome/legend.ts` | UPDATE | document- and mode-aware; the AC-4 notice |
| `packages/viz/src/chrome/chrome.ts` | UPDATE | one hunk: `renderLegend(analysis)` + mode wiring |
| `packages/viz/src/styles.css` | UPDATE | appended `story 5.5` block, no existing selector touched |
| `packages/cli/src/pipeline.ts` | UPDATE | one string literal — the AC-5 summary wording |

`chrome/format.ts` was **not** changed. `formatRelativeTime(null)` still
returns the em dash; the branch lives in `panel-model.ts`, which knows the
window. Keeping the formatter pure left its existing suite green.

`chrome/boundary.test.ts` is byte-unchanged and passing (AC-6).

## Verification

```
pnpm lint                                  # eslint + prettier, exit 0
pnpm --filter @gitnebula/viz test          # 455 passed
pnpm --filter gitnebula test               # 145 passed, unchanged
pnpm build                                 # viz + cli
```

Every new assertion was **watched fail** before being relied on: hardcoding
the window to 90, reverting the empty-state copy to the em dash, and dropping
the legend's mode check produced 6 failures across 3 files. See `DECISIONS.md`.

`MANUAL_TESTING.md` records the walkthrough, which was executed against real
pipeline output at three different windows.

## Two things for the reviewer

- **The spec's cli test command does not exist.** It says
  `pnpm --filter @gitnebula/cli test`; the package is named `gitnebula`, so
  that filter matches no project **and exits 0** — a false green. The real
  command is `pnpm --filter gitnebula test`. Any story using the spec's form
  believes it ran a suite it did not run.
- **The legend has no key for the `other` layer** (reported by pamela, 5.3,
  whose filter exposes all five). Not fixed here: `other` and `infra`
  deliberately share one grey in `LAYER_COLOR`, so adding a fifth entry
  produces two identical swatches and needs a palette decision, not a line of
  code. Out of scope for a story about the analysis window.
