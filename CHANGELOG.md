# Changelog

All notable changes to `gitnebula` — the CLI published on npm — are recorded
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions here name the **CLI**, not the data contract. `schemaVersion` inside
`analysis.json` is the contract's own version and moves independently (AD-11):
a CLI release that changes no contract field leaves it exactly where it was.
`schemaVersion` has been `1.0` since the first release and is unchanged in 0.2.1.

## [0.2.1] — 2026-09-10

Epic 6, "the assembled viewer, verified". Almost all of this epic is test and
verification work that never reaches the package; two user-visible defects were
fixed along the way, and those are what this release ships.

### Fixed

- **The `other` layer has its own legend key.** It had a filter toggle and no
  key, because `LAYER_COLOR.other` shared `#7c8598` with `infra` and a fifth
  entry would have drawn two identical swatches. `other` is now `#cf81cf`,
  chosen by measured CIE L\*a\*b\* separation against every colour already on
  the canvas; ADR-0008 carries the method and the rejected alternatives. On
  this repository `other` is 42.5% of nodes and `infra` 0.7%, so the two
  sharing a swatch were the most and the least common things on the map.
- **`hiddenCount().visible` is correct when a layer filter is the only active
  filter.** It short-circuited to `graph.nodes.length`, contradicting its
  documented contract. Fixed in both the 2D and 3D engines. No readout consumed
  the wrong value — the only consumer is guarded by `scopeId !== null` while the
  defect fired only when `scopeId === null` — so nothing on screen was wrong;
  the contract was.

### Added

- Six stable `data-testid` hooks on the panel metric rows, summary metrics,
  legend rows, scope-bar readouts and blast-radius rows, declared in one place
  (`chrome/testids.ts`) with the rule for adding a seventh. They exist so tests
  stop asserting against class names that a restyle would break.

### Internal

Not shipped in the package, and the reason to trust this release:

- **`boot()` is executed by tests for the first time.** The ~120 lines that
  fetch the document, mount the chrome, parse `?view=3d` and build the engine
  had no test execution in this repository — its only caller was `main.ts`. An
  on-demand browser suite now drives it, and the real 2D↔3D view swap, the
  three loader error screens, real-coordinate node picking and control
  reachability at a real window size: **44 tests** under
  `packages/viz/ui/`, run by `pnpm --filter @gitnebula/viz ui`. It is
  deliberately outside `pnpm test`, which must keep passing on a machine with
  no browser installed.
- The epic was verified end to end by SpecWitness against a contract frozen
  before any of its code existed. Final run: 4 gates pass, 17 criteria pass,
  3 fail, 20 need human review. All three failures are adjudicated in
  `docs/implementation-artifacts/epic-6-assembled-viewer/epic-6-verification-adjudication.md`;
  none is a defect in the shipped viewer.

### Known

- **The tooltip is positioned in the wrong coordinate space.** `.tooltip` is
  `position: fixed` (viewport coordinates) while the hover point is
  canvas-relative, so with a 103 px header it renders 89 px above the cursor and
  its bottom-edge flip never fires. Found and measured by this epic's
  reachability work, reported rather than repaired — the story that found it was
  forbidden from touching `packages/viz/src/`. Scheduled as its own story.

## [0.2.0] — 2026-08-17

Epic 5, "the onboarding-first map". 0.1.0 could draw a repository; this release
is about the first five minutes in one you have never seen before — where to
start reading, and what a change would touch.

### Added

- **Start-here ranking** — a panel naming the files worth reading first,
  ranked by how many modules import them weighted by size, so the entry points
  of an unfamiliar repository are the first thing the map offers.
- **Layer filter** — multi-select filtering by detected layer, to isolate one
  tier of the architecture instead of reading the whole nebula at once.
- **Module drill-down and connected-only view** — open a single module and
  keep only what it actually connects to.
- **Blast radius** — select a file and see what historically changed with it,
  derived from the co-change signal `githist` already produced.
- **3D view** — an alternative spatial layout behind the `GraphEngine` seam,
  with the 2D renderer unchanged underneath it.
- **A legible analysis window** — the panel now states the history range the
  churn and co-change figures were computed over, so the numbers are readable
  as claims about a period rather than unlabelled scores.

### Changed

- **Hover highlights the dependency chain** instead of dimming the entire map,
  which had made the surrounding context unreadable at the moment you most
  needed it.
- **README and demo** rewritten around the onboarding-first flow.

### Fixed

- **`scanner`: generated data blobs no longer swallow the map.** A single large
  generated fixture could dominate the layout and crowd out the real source.
- **`scanner`: a NUL byte in a tracked file no longer hides it.** gitnebula's
  own `layout.ts` was invisible in gitnebula's own map because of it.
- **`viz`: the 3D member layout no longer diverges**, and it uses the frame.
- **`viz`: the viewport-scoped 3D unfold** lost in an earlier change is back.
- **`viz`: the pending return offer** is now mirrored on connect as well.

### Repository

- **A pnpm filter that matches no project now fails.** pnpm's default is to
  print `No projects matched the filters` and exit 0, so a stale or mistyped
  filter reported green having run nothing. `.npmrc` sets `fail-if-no-match=true`
  to close it, and `pnpm test:pkg <package name>` validates a package name
  before spawning pnpm. No user-facing change; recorded because it invalidated
  test results quoted in earlier work.

## [0.1.0] — 2026-08-14

First public release: `npx gitnebula` in a git repository writes a validated
`analysis.json` and serves an interactive map of it, with no configuration, no
account and nothing leaving the machine.

### Added

- **`contract`** — the versioned `analysis.json` schema, generated types and a
  validator. The single interface between every module, and the only thing the
  frontend needs.
- **`scanner`** — file tree, LOC, language and layer detection, and module
  derivation.
- **`deps`** — import parsing resolved to file and module edges, for TypeScript
  and JavaScript via the TypeScript compiler API and for Python via a
  `web-tree-sitter` wasm grammar.
- **`githist`** — churn, authors and co-change from a single `git log` pass.
- **`viz`** — the renderer: an animated force-settled nebula on canvas, with
  semantic zoom, hover chains, search, a detail panel, heatmap mode and PNG
  export.
- **`cli`** — the staged pipeline emitting a validated `analysis.json`, a
  loopback server that opens the map in a browser, a shallow-clone URL mode for
  analyzing a repository by URL, and `gitnebula build` for a static,
  self-contained bundle hostable on any static server.

### Notes

- Analysis is deterministic and fully offline: the same repository at the same
  commit produces a byte-identical `analysis.json`.
- `gitnebula` is the only package published to npm. The other five are private
  and are inlined into the binary at build time (AD-11).

[0.2.1]: https://github.com/jundymek/gitnebula/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jundymek/gitnebula/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jundymek/gitnebula/releases/tag/v0.1.0
