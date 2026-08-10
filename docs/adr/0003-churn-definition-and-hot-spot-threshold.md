# ADR-0003: Churn = P95-normalized commit activity; hot spot at 0.5

- **Status:** accepted
- **Date:** 2026-08-10
- **Resolves:** brief §11 open question 3 (and the brief's undefined churn semantics)

## Context

The brief displays churn as a percentage (mockup: "churn 61%", hot-spot badge,
heatmap) and asks whether the hot-spot threshold should be a churn percentile
or an absolute value — but never defines churn itself. The definition is a
contract field (the brief's draft names it `churn90d`), so it blocks Epic 1.
Requirements: comparable
across repos of any size and activity level, comparable between the module and
file zoom levels, resistant to pathological outliers, and aligned with the
mockup's `HOT_THRESHOLD = 0.5`.

## Decision

- Raw metric: `commits` — commits in the analysis window (default 90 days)
  touching the node. Module commits counted directly (a commit touching ≥ 2
  files of a module counts once), never summed from files.
- Normalized metric: `churn = min(1, commits / P95(commits))`, where P95 is
  taken over **same-kind** nodes with ≥ 1 commit in the window. Zero-activity
  nodes get 0. The contract carries both fields.
- **Field names are window-neutral** (`churn`, `commits`, not `churn90d`) —
  the window is configurable, so its length lives in
  `repo.analysisWindowDays`, never in field names.
- **Hot spot: `churn ≥ threshold`**, threshold configurable in
  `.gitnebula.yml`, **default 0.5** — an absolute threshold on the normalized
  scale (which answers the percentile-vs-absolute question: normalization is
  percentile-based, the threshold is absolute).

## Consequences

- "61%" reads as "61% of the activity of this repo's busiest nodes" — stable
  meaning in a 50-commit repo and a 50,000-commit repo.
- Same-kind normalization keeps files and modules on comparable scales; a
  heatmap works at both zoom levels without rescaling.
- P95 (not max) stops a single pathological node (changelog, lockfile) from
  flattening everyone else; such a node itself clamps to 1.0.
- Churn is *relative*: a uniformly-active repo still shows differentiation,
  and a near-dead repo shows its few live spots as hot. This is the exploratory
  signal we want; it is not an absolute activity measure (raw `commits`
  remains available for that).
- Rejected: share-of-window-commits (collapses to noise at file level);
  line-based churn (rewards renames/reformat commits, hides the
  many-small-fixes pattern that defines real hot spots).
