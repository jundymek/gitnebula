# ADR-0005: Contract shape — parent-only membership, two-level edges, bounded co-changes

- **Status:** accepted
- **Date:** 2026-08-10
- **Resolves:** ambiguities in the brief's §7 draft found during PRD work

## Context

The brief's `analysis.json` draft left four structural questions open:
(1) how file↔module membership is represented (the mockup uses `member` edges,
the draft has a `parent` field — two encodings of one fact); (2) whether
`edges[]` carries one or both graph levels, and what `weight` means; (3) who
aggregates the panel's "top 3 co-changing modules" from file-level pairs;
(4) `cochanges[]` is unbounded — on a 2,000-file repo, pairs with count ≥ 1
can reach hundreds of thousands of entries in a file the Viewer loads whole.

## Decision

1. **Membership: `parent` field only.** No membership edges in the contract;
   the Viewer derives member relations for rendering.
2. **`edges[]` carries both levels**, all `kind: "import"`. Module-level edges
   are aggregated by the analyzers; `weight` = number of underlying file-level
   import pairs. The Viewer never computes module edges.
3. **`cochanges[]` carries file-file and module-module pairs**; module pairs
   are aggregated by githist. The Viewer only filters and sorts (top 3 for the
   panel). No analytics in viz.
4. **Bounds:** pairs with `count ≥ 3` only, top 500 per kind — tunable numbers
   serving a binding budget: contract ≤ 5 MB for a 2,000-file repo.
5. **Determinism:** all lists stably sorted (nodes by id, edges by
   source/target, cochanges by count desc then ids); two runs on identical
   repo state + config differ only in `analyzedAt`.

## Consequences

- One encoding per fact: no `member`-edge/`parent` divergence class of bugs;
  the mockup's member edges are recognized as a rendering artifact.
- viz stays a pure consumer (its module boundary requires it — it must work
  from fixtures alone), and analyzer outputs are snapshot-testable.
- Aggregated module edges mean the Viewer at module zoom never touches
  file-level data — relevant to the 60 fps budget.
- The co-change bound discards long-tail pairs; post-MVP coupling mode may
  need a raised cap → that is a `schemaVersion` discussion by design, not a
  silent change.
- Determinism makes snapshot tests trivial and CI diffs meaningful.
