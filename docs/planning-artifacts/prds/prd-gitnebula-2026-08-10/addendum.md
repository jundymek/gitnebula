# PRD Addendum — gitnebula MVP

Technical depth and rejected-alternative rationale that informs the
architecture phase but does not belong in the PRD narrative. Formal decisions
get ADRs in `docs/adr/`; this file preserves the *why* behind them.

## A1. Import parsing: why not tree-sitter for TypeScript

The brief (§8) suggests tree-sitter for import parsing. For TS/JS this is the
wrong layer: tree-sitter yields syntax, but edge correctness requires *module
resolution* — `tsconfig.json` path aliases (`@/components`), `baseUrl`,
`index.ts` conventions, and re-export chains. Without resolution, edges in most
modern TS repos are wrong or missing. The TypeScript compiler API
(`ts.resolveModuleName`) does this natively and is a pure-JS dependency.

For Python, tree-sitter-python is appropriate (import statements are
syntactically resolvable against repo layout with modest logic), but the
**WASM build (web-tree-sitter)** should be preferred over native node bindings:
native bindings need node-gyp at install time, which violates the zero-config
`npx` promise on machines without build tools.

Rejected: a separate Python analyzer process (brief's fallback option) —
unnecessary once resolution stays syntax-level; would reintroduce a dual
runtime.

## A2. Churn formula

`churn = min(1, commits / P95(commits over same-kind nodes with ≥ 1 commit in
the window))`. Field names are window-neutral (`churn`, `commits`) with the
window length in `repo.analysisWindowDays` — a name like `churn90d` would lie
whenever the window is reconfigured. Hot-spot threshold is configurable
(`.gitnebula.yml`), default 0.5.

- Same-kind normalization (files vs files, modules vs modules) keeps the two
  zoom levels on comparable scales — a naive global normalization makes every
  file look cold next to modules.
- P95 (not max) prevents one pathological node (e.g. a changelog touched by
  every commit) from flattening the scale.
- Threshold 0.5 on this scale reproduces the mockup's `HOT_THRESHOLD = 0.5`
  and reads naturally: "at least half the activity of the repo's busiest".
- Module metrics counted directly (a commit touching 3 files of a module = 1
  module commit), never summed from files — summing overcounts multi-file
  commits.

Rejected: share-of-window-commits (intuitive for modules, collapses to noise
for files); line-based churn (rewards renames/reformats, hides
many-small-fixes hot spots — the exact signal we want).

## A3. Contract deltas vs the brief's §7 draft

1. `commits` (raw int) added next to `churn` (normalized float) — raw
   data stays available for post-MVP modes; normalization is reconstructible.
2. Membership: `parent` field only. The mockup's `kind: "member"` edges are a
   rendering artifact and would duplicate state in the Contract.
3. `edges[]` holds both file-level and module-level import edges; module edges
   aggregate file edges (`weight` = count of file-level import pairs). The
   Viewer must not compute module edges itself (analyzer responsibility —
   keeps viz free of analytics).
4. `cochanges[]` may hold file-file and module-module pairs; module pairs are
   aggregated by githist. Bounded: `count ≥ 3`, top 500 per kind (tunable —
   the binding requirement is Contract ≤ 5 MB for a 2,000-file repo).
5. All lists sorted stably (by id / by weight desc / by count desc) for
   deterministic output.

## A4. Performance strategy for FR-14/FR-16

- d3-force with `forceManyBody` uses Barnes–Hut (O(n log n)) — the mockup's
  O(n²) loop is a mockup artifact, never to be ported.
- Viewport-scoped unfolding (user-confirmed) bounds simulated file nodes to
  visible modules; worst case drops from 2,000 to low hundreds.
- Freeze the simulation when alpha decays below threshold; wake only on
  layout-changing events (unfold, isolate, replay).
- Render loop and simulation tick decoupled; static frames are cheap.
- If the spike (PRD §8 Q4) still fails on 2,000 nodes: cosmos.gl swap is the
  designed escape hatch (render abstraction is an architecture deliverable).

## A5. Bundle shape

- Single self-contained HTML+JS+CSS (inlined), system font stack — the mockup
  already uses `ui-monospace`/system sans; no webfont cost, no external
  requests, CSP-friendly.
- `analysis.json` deliberately *not* inlined: CI regenerates data without
  rebuilding the app, and the Viewer dev-mode loads fixtures the same way.
- Target host: GitHub Pages (static server). `file://` not supported.

## A6. terminal-agents constraints that shaped this PRD's downstream

Recorded here so the epics/stories phase doesn't rediscover them (full detail
in CLAUDE.md):

- Story ids dot-separated (`1.1-slug`); epic number = digits before first dot.
- One launch = one epic; ≤ 5 parallel stories per cohort.
- At most one blocking predecessor per story (`waiting_for` is a single
  marker); dependency also stated in prose in the spec.
- Harness gates require per-story: `AC-n` numbering, `## Tasks / Subtasks`
  checkboxes, empty `## Dev Agent Record` with four sub-headers, docs README
  per story, named test command.
- Specs must be pushed to `origin/master` before launch.
- Trailers `Refs:` + `Agent:` must be in PR bodies (squash merge discards
  branch-commit trailers).

## A7. Demo repos (user-confirmed)

| repo       | profile          | why                                        |
| ---------- | ---------------- | ------------------------------------------ |
| fastapi    | Python ~100%     | clean module structure, recognizable       |
| excalidraw | TypeScript/React | large frontend, tsconfig aliases stress    |
| streamlit  | Python + TS      | both parsers + layer heuristic in one repo |

Pin exact commits when the DoD checklist is executed, so results are
reproducible.
