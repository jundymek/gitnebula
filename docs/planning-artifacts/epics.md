---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/prd.md
  - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/addendum.md
  - docs/planning-artifacts/architecture.md
  - docs/GITNEBULA_PROJECT_BRIEF.md
  - reference/mockup.html
  - CLAUDE.md
---

# gitnebula - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for gitnebula,
decomposing the requirements from the PRD, the architecture spine, the visual
reference (`reference/mockup.html`, standing in for a UX design contract), and
the delivery-process constraints (brief §13, CLAUDE.md) into implementable
stories for parallel execution by terminal-agents.

## Requirements Inventory

### Functional Requirements

FR-1: Zero-config launch — `npx gitnebula` → working map, no config/key/network
FR-2: URL analysis — shallow clone to temp, clone-only network use
FR-3: Staged terminal progress — start/end lines, elapsed, actionable failures
FR-4: Configuration file — `.gitnebula.yml`: excludes, window, layers, hot-spot threshold, LLM key (parsed+notice)
FR-5: Local server — 127.0.0.1 only, auto port, clean shutdown, opens browser
FR-6: Versioned, validatable Contract — JSON Schema, schemaVersion, viewer refusal screen, edge-case fixtures
FR-7: Contract content — repo meta + analysisWindowDays, nodes (churn/commits/…), two-level edges, bounded cochanges, determinism
FR-8: describe extension point — `enrich()` identity hook, nullable description fields
FR-9: Scan and classify — tree walk, LOC, languages, module derivation (descent heuristic), layer rule table + override
FR-10: Git history metrics — commits, churn (P95 formula), authors, lastChangedAt, co-change; direct module counting; rename mapping
FR-11: Import parsing — TS/JS via compiler API (aliases, re-exports), Python via tree-sitter WASM; unresolved counted, >20% = failure
FR-12: First render and settling — visible settle 2–3 s (Settled definition), camera fit ≤ 800 ms, reduced-motion, replay
FR-13: Visual encoding — size∝LOC, colour=layer, glow∝churn, hot override colour, pulse, starfield, stats bar + module count, legend, hint overlay, exact palette
FR-14: 60 fps interaction budget — ≥55 fps automated on 2,000-node fixture; GraphEngine swap seam
FR-15: Pan and zoom — cursor-centred, clamp [0.4, 6.0]
FR-16: Semantic zoom — 1.8× threshold, viewport-scoped unfold, file labels at 3.0×
FR-17: Hover highlight — one-hop chain, dim ≤0.2, tooltip name+churn
FR-18: Search — persistent box, ⌘K and `/`, fuzzy, top 7, fly-to 620±50 ms → 2×/3×, reduced-motion jump
FR-19: Panel content — metrics, top-3 co-changing, hot badge (configurable threshold), churn bar, selection ring, inert description slot
FR-20: Panel actions — GitHub link, isolate, empty-canvas deselect, drag≠click
FR-21: Structure and Heatmap modes — cold→hot interpolation, pressed state
FR-22: PNG export — ≥2× via engine re-render, matches camera/mode/highlight
FR-23: Static bundle — one self-contained index.html + sibling analysis.json, ≤2 MB gz, zero external requests
FR-24: CI recipe — Actions workflow, green on this repo (dogfooding)
FR-25: Launch-ready repository — README demo GIF + map link, MIT LICENSE, CONTRIBUTING.md, CI badge

### NonFunctional Requirements

NFR-1: Local-first/offline — no data leaves the machine; only URL-mode clone touches the network (AD-8)
NFR-2: Analysis ≤ 60 s on a 500–2,000-file repo (reference hardware, SM-1)
NFR-3: 60 fps target / ≥55 fps automated floor at 100 modules / 2,000 files (SM-2)
NFR-4: Determinism — byte-identical output except analyzedAt; seeded layout (AD-4, AD-6)
NFR-5: Contract ≤ 5 MB @ 2,000 files; viewer bundle ≤ 2 MB gzipped
NFR-6: Zero-config, no native compilation anywhere in the npx path (AD-11, ADR-0001)
NFR-7: Accessibility floor — prefers-reduced-motion honoured everywhere (settle, pulse, fly-to); keyboard-navigable search
NFR-8: Visual fidelity — palette/constants match mockup exactly (SM-6); wow is a requirement
NFR-9: No telemetry, no accounts, no GitHub API
NFR-10: Node ≥ 20; pure ESM; pnpm workspaces

### Additional Requirements (Architecture)

- AR-1: No starter template — Epic 1 story 1 scaffolds the pnpm workspace per AD-11 (source-only internals, two build edges, ESM/NodeNext, exports maps, ESLint 9 + Prettier, vitest)
- AR-2: Contract package is environment-neutral; JSON Schema is source, TS types generated + CI-checked (AD-9); supported-major constant exported
- AR-3: Analyzer signature `analyze(input, config, onProgress?)`; purity rules; config resolution only in cli; exclude/layer data exported by scanner (AD-3)
- AR-4: ScanResult = closed node universe; picomatch only in scanner; windowAnchor injected by cli; one-pass `git log -M --name-status`, no `--follow` (AD-13)
- AR-5: Fixture repos built by scripts with pinned dates into gitignored `test-fixtures/.generated/`; pretest + CI (AD-14)
- AR-6: viz = GraphEngine (layout+render, one interface) + chrome (DOM only); exportPNG re-renders through engine (AD-5)
- AR-7: Data-loading contract: `./analysis.json` sibling URL in every mode; version check in viz loader (AD-12)
- AR-8: Grammar .wasm built in-repo with pinned tree-sitter-cli (ABI match), committed as deps asset, import.meta.url resolution (AD-11/Stack)
- AR-9: Error/warning shapes fixed (AD-7); `Date.now`/`Math.random` bans lint-enforced (AD-4)
- AR-10: describe boundary: identity `enrich()` + two sanctioned doors only (AD-10)
- AR-11: Perf spike (Barnes–Hut + viewport unfold on 2,000-node fixture) is a dedicated early story gating viz story freeze (spine Deferred; PRD §8 Q4)

### UX Design Requirements

Source: `reference/mockup.html` (behavioural/visual contract; PRD FR consequences already encode most of it). Items below are the mockup behaviours stories must not lose:

- UX-DR1: Exact palette custom properties (--backend #3fcfa0, --frontend #9b8cff, --infra #7c8598, --test #a8cf52, --hot #ff7a3d, void #060911) and dark chrome styling
- UX-DR2: Structure-mode hot nodes render in --hot replacing layer colour; legend carries hot-spot entry
- UX-DR3: Starfield background (~220 faint stars, two dot sizes)
- UX-DR4: Node glow via radial gradients; hot pulse ~380 ms sine; module labels above nodes; file labels ≥3×
- UX-DR5: Curved quadratic edges, member-visibility rules, chain highlight alphas (0.62 chain / 0.03 dimmed / 0.2 base)
- UX-DR6: Header layout: brand, repo name, stats, mode toggle (aria-pressed), replay, PNG buttons
- UX-DR7: Panel layout: name+badge, kind line, metric rows, churn bar, isolate + GitHub actions, × close
- UX-DR8: Search box top-left with ⌘K kbd hint; results listbox, hover/sel states
- UX-DR9: Hint overlay bottom-right (3 lines: pan/zoom, unfold threshold, hover/click)
- UX-DR10: Cursor states (grab/grabbing), tooltip styling (mono, dark, border), focus-visible outlines
- UX-DR11: prefers-reduced-motion: no settle animation, no pulse, instant fly-to

### FR Coverage Map

FR-1: Epic 2 — pipeline produces the map end-to-end (serve half in Epic 3)
FR-2: Epic 3 — URL mode (shallow clone)
FR-3: Epic 2 — staged progress in the cli pipeline
FR-4: Epic 2 — config resolver (excludes/window/layers/threshold/LLM notice)
FR-5: Epic 3 — local server + browser open
FR-6: Epic 1 — schema, versioning, fixtures; viewer refusal in Epic 2 (engine loader)
FR-7: Epic 1 (shape) + Epic 2 (producers honour determinism)
FR-8: Epic 2 — enrich() identity hook in the pipeline
FR-9: Epic 2 — scanner story
FR-10: Epic 2 — githist story
FR-11: Epic 2 (TS/JS) + Epic 3 (Python)
FR-12: Epic 2 — engine core (settle, camera fit, replay, reduced-motion)
FR-13: Epic 2 — engine core (encoding, starfield, stats, legend, hint)
FR-14: Epic 1 (spike proves it) + Epic 3 (automated perf harness)
FR-15: Epic 2 — engine core (pan/zoom)
FR-16: Epic 3 — semantic zoom
FR-17: Epic 3 — hover highlight
FR-18: Epic 3 — search
FR-19: Epic 3 — panel content
FR-20: Epic 3 — panel actions
FR-21: Epic 3 — view modes
FR-22: Epic 3 — PNG export
FR-23: Epic 4 — static bundle
FR-24: Epic 4 — CI recipe (dogfooding)
FR-25: Epic 1 (LICENSE, CONTRIBUTING skeleton, CI) + Epic 4 (README, demo, badge)

## Epic List

> **Deviation note (deliberate):** epics here are integration cohorts for
> terminal-agents (one epic = one supervised launch of ≤ 5 parallel stories,
> merged to an epic branch, then to master at a milestone), per brief §13 —
> which overrides the generic "organize by user value, never technical layers"
> guidance. Each epic still ends in a verifiable capability increment, and the
> viz ∥ analyzers parallelism the contract-first ordering exists for happens
> *inside* Epics 2–3 via mixed-owner cohorts.

### Epic 1: Contract and Foundations (→ M1)
Everything every later story stands on: the workspace skeleton, the frozen
`analysis.json` schema with fixtures, the fixture-repo build mechanism, and
the performance spike that de-risks the viewer budget before any viz story
freezes. After merge: the contract validates, fixtures load, CI runs tests,
and the 2,000-node feasibility question has a measured answer.
**FRs covered:** FR-6, FR-7 (shape), FR-14 (spike), FR-25 (partial: LICENSE,
CONTRIBUTING, CI skeleton)
**Stories:** 4, sequential chain (scaffold → schema → fixtures → spike).

### Epic 2: Analysis Pipeline and Living Map (→ M2)
The mixed-owner parallel cohort: three analyzers, the cli pipeline that
assembles and validates `analysis.json`, and the GraphEngine core rendering
fixtures — nodes settle, glow, pan and zoom at the exact mockup palette.
After merge: `gitnebula` run in a repo emits a valid contract file, and the
viewer renders it (from fixtures during the epic; end-to-end at merge = M2).
**FRs covered:** FR-1 (analysis half), FR-3, FR-4, FR-6 (viewer refusal),
FR-7 (producers), FR-8, FR-9, FR-10, FR-11 (TS/JS), FR-12, FR-13, FR-15
**Stories:** 5 — scanner, deps (TS/JS), githist, cli pipeline, viz engine core.

### Epic 3: Full Exploration Experience
The map becomes the product: semantic zoom, hover chains, search, panel,
modes, PNG export, the automated perf harness, Python imports, and the local
server with URL mode. After merge: the complete §5 user flow works on a real
repo, measured at ≥ 55 fps.
**FRs covered:** FR-1 (serve half), FR-2, FR-5, FR-11 (Python), FR-14
(harness), FR-16, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22
**Stories:** 5 — deps (Python), cli serve+URL, viz navigation, viz panel+modes,
viz PNG+perf harness.

### Epic 4: Ship It (→ M3)
The product leaves the machine: `gitnebula build` bundle, the Actions recipe
publishing this repo's own map, the launch-ready README with demo, and the
DoD validation run on the three demo repos with the human-review checklist.
**FRs covered:** FR-23, FR-24, FR-25 (completion)
**Stories:** 4 — bundle, CI recipe, repo quality, DoD validation.

> **Story metadata.** Per brief §13.2 every story carries `Owner` (lead module;
> `contract` extends the §9 vocabulary — the architecture made it a real
> package), `Touches` (paths beyond the owner package), and `Depends_on`
> (stories that must be merged first; `[]` = none). At most one blocking
> predecessor per story — a terminal-agents runtime constraint. Story ids are
> `<epic>.<n>-<slug>`; the slug is also the task id, branch name, and spec
> filename.

## Epic 1: Contract and Foundations

Everything every later story stands on; sequential chain; merge = M1.

### Story 1.1: Workspace scaffold (`1.1-workspace-scaffold`)

Owner: `cli` · Touches: repo root, all package skeletons, `.github/workflows/`, `LICENSE`, `CONTRIBUTING.md` · Depends_on: `[]`

As a contributor (human or agent),
I want a ready pnpm workspace with lint, tests, CI and the six package skeletons,
So that every later story starts from a green, bounded scaffold instead of inventing one.

**Acceptance Criteria:**

**Given** a fresh clone with Node ≥ 20 and pnpm 10
**When** I run `pnpm install && pnpm lint && pnpm test`
**Then** all three commands exit 0 (tests may be trivial but must run in every package)
**And** the workspace contains `@gitnebula/{contract,scanner,deps,githist,viz,cli}` with `"type": "module"`, `exports` maps (deep imports impossible), and only the AD-2 dependency edges declared.

**Given** the ESLint config
**When** a file in scanner/deps/githist calls `Date.now()` or `Math.random()`
**Then** lint fails (AD-4 ban as `no-restricted-globals`).

**Given** the repo root
**When** I inspect it
**Then** MIT `LICENSE` and a `CONTRIBUTING.md` (commit conventions, trailers, squash policy per CLAUDE.md) exist
**And** `.github/workflows/ci.yml` runs lint + tests on push/PR.

### Story 1.2: Contract schema and validator (`1.2-contract-schema`)

Owner: `contract` · Touches: — · Depends_on: `[1.1-workspace-scaffold]`

As a pipeline or viewer developer,
I want the frozen `analysis.json` JSON Schema with generated types and a validator,
So that every module builds against one machine-checked truth.

**Acceptance Criteria:**

**Given** the schema (draft 2020-12) in `@gitnebula/contract`
**When** I inspect its shape
**Then** it matches PRD FR-7 + ADR-0005 exactly: repo meta with `analysisWindowDays`, nodes (`id`, `kind`, `parent`, `path`, `layer`, `loc`, `churn`, `commits`, `authors`, `lastChangedAt`, nullable `description`/`descriptionSource`), two-level `edges` with `weight`, bounded `cochanges`, `schemaVersion` "1.0".

**Given** the type-generation script
**When** I run it after editing the schema
**Then** committed TS types regenerate, and CI fails if they are stale (AD-9)
**And** the package exports `validateAnalysis()` (ajv) and `SUPPORTED_SCHEMA_MAJOR`.

**Given** the intermediate pipeline types (`ScanResult`, `DepsResult`, `GitResult`, `Config` with `windowAnchor`)
**When** any other package imports cross-module types
**Then** they resolve only from `@gitnebula/contract` (AD-1)
**And** the package contains no `node:` imports (environment-neutral).

### Story 1.3: Fixtures and fixture-repo mechanism (`1.3-contract-fixtures`)

Owner: `contract` · Touches: `test-fixtures/` · Depends_on: `[1.2-contract-schema]`

As an analyzer or viewer developer,
I want committed edge-case `analysis.json` fixtures and deterministic fixture git repos,
So that viz builds against the contract alone and githist tests have known history.

**Acceptance Criteria:**

**Given** `@gitnebula/contract` fixtures
**When** I validate them
**Then** all pass: empty graph, single module, cyclic imports, module with no files, zero-history repo, and a generated 100-module/2,000-file synthetic (generator script committed, output committed)
**And** each fixture file states its purpose in a comment-adjacent README.

**Given** `test-fixtures/` build scripts (AD-14)
**When** I run them twice on any machine
**Then** the produced repos in `test-fixtures/.generated/` (gitignored) have identical commit hashes (pinned dates + identity)
**And** the crafted history covers: renames, multi-file commits (co-change), multi-author files, a file outside the analysis window.

### Story 1.4: Performance spike (`1.4-perf-spike`)

Owner: `viz` · Touches: — · Depends_on: `[1.3-contract-fixtures]`

As the project's planners,
I want a measured answer on d3-force + Barnes–Hut + viewport-scoped unfold at 2,000 nodes,
So that Epic 2/3 viz stories freeze against a proven mechanism, not a hope (AR-11).

**Acceptance Criteria:**

**Given** a spike harness (throwaway code allowed, measurement harness reusable) loading the synthetic fixture
**When** a scripted pan+zoom sequence runs with simulation active, frozen, and viewport-unfolding
**Then** measured fps for each phase is recorded in a committed spike report
**And** the report ends with an explicit verdict: canvas-2d GraphEngine viable (≥ 55 fps) or escalation to the cosmos.gl path with evidence.

**Given** the verdict is negative
**When** the report is delivered
**Then** it names which Epic 2/3 story specs need adjustment before launch — this story is the gate (MUST be left unticked in Tasks only if escalation is unresolved).

## Epic 2: Analysis Pipeline and Living Map

Mixed-owner parallel cohort; merge = M2 (first end-to-end pipeline).

### Story 2.1: Scanner (`2.1-scanner-core`)

Owner: `scanner` · Touches: — · Depends_on: `[]`

As a developer running gitnebula,
I want the repo tree scanned into classified, measured nodes,
So that every downstream stage works from one closed universe (AD-13).

**Acceptance Criteria:**

**Given** the fixture repo
**When** `analyze(input, config)` runs
**Then** the `ScanResult` snapshot matches: excludes applied (picomatch, defaults exported as data + `.gitnebula.yml` merge respected via passed config), LOC per file, language shares, modules derived (top-level; > 80% single-dir descent, max depth 2), layers assigned by the ordered rule table with `layers:` override winning
**And** unknown-language files are counted and layered `other`.

**Given** a repo where `src/` holds 95% of files
**When** scanning runs
**Then** modules descend one level into `src/` (descent heuristic verified on a crafted fixture).

**Given** the demo repos (fastapi, excalidraw, streamlit)
**When** scanning runs locally
**Then** module/layer output is recorded for the human-review checklist (visually sensible check).

### Story 2.2: TS/JS import edges (`2.2-deps-ts-imports`)

Owner: `deps` · Touches: — · Depends_on: `[]`

As a developer exploring a TS/JS repo,
I want import statements resolved to real repo files,
So that edges reflect actual dependencies, not guesses.

**Acceptance Criteria:**

**Given** a crafted TS fixture with path aliases (`@/…`), `baseUrl`, `index.ts`, re-export chains, and JS `require`
**When** `analyze` runs over the ScanResult universe
**Then** file-level edges resolve correctly (compiler API), module-level edges aggregate with `weight` = file-pair count (AD-1/ADR-0005), imports to `node_modules` are ignored, and unresolved imports are dropped + counted (AD-7)
**And** output ordering is stable (AD-4).

**Given** a file with syntax errors
**When** parsing runs
**Then** the stage completes; the file yields no edges and one counted warning.

**Given** the excalidraw demo repo
**When** parsing runs locally
**Then** the unresolved-import rate is recorded and is ≤ 20% (FR-11 failure threshold).

### Story 2.3: Git history metrics (`2.3-githist-metrics`)

Owner: `githist` · Touches: — · Depends_on: `[]`

As a developer hunting hot spots,
I want churn, authors and co-change computed from local git history,
So that the map shows where things happen, deterministically.

**Acceptance Criteria:**

**Given** the fixture repo (crafted history) and a pinned `windowAnchor`
**When** `analyze` runs
**Then** the snapshot matches known values: `commits` per node (module counting direct, not summed), `churn` per the P95 formula (ADR-0003), distinct `authors`, max `lastChangedAt`, co-change pairs bounded (`count ≥ 3`, top 500/kind) including module-module aggregation
**And** renames map old→new via one-pass `git log -M --name-status` (the renamed fixture file keeps its history; no `--follow` anywhere).

**Given** a repo with zero commits in the window
**When** analysis runs
**Then** every `churn` is 0, no NaN/division error (FR-10).

**Given** paths in git history that are outside the ScanResult universe
**When** analysis runs
**Then** they are dropped and counted (AD-13).

### Story 2.4: CLI pipeline (`2.4-cli-pipeline`)

Owner: `cli` · Touches: — · Depends_on: `[2.1-scanner-core]` (integrates 2.2/2.3 as they merge — rebase on epic-updated)

As a developer in a repo directory,
I want one command that runs the staged pipeline and emits a valid `analysis.json`,
So that analysis works end-to-end with visible progress.

**Acceptance Criteria:**

**Given** the fixture repo
**When** the pipeline runs (scan → deps ∥ githist → assemble+validate → enrich no-op → emit)
**Then** the emitted file passes `validateAnalysis()`, `analyzedAt`/`windowAnchor` are injected by cli only, output is byte-identical across two runs except `analyzedAt` (FR-7)
**And** each stage prints start/end lines with elapsed time; a stage failure exits non-zero with `«stage»: «cause» — «remedy»` (FR-3/AD-7).

**Given** `.gitnebula.yml` with excludes, window, layers, hot-spot threshold, and an `llm` key
**When** config resolves (defaults < yml < flags)
**Then** all keys apply, the `llm` key produces the single ignored-in-MVP notice (AD-10), and an invalid config fails fast naming key + line (FR-4).

**Given** the merged epic branch (M2 gate)
**When** `gitnebula` runs in the fixture repo
**Then** scanner + deps + githist all feed the emitted file (end-to-end snapshot committed as the M2 evidence).

### Story 2.5: GraphEngine core (`2.5-viz-engine-core`)

Owner: `viz` · Touches: — · Depends_on: `[]` (builds against 1.3 fixtures from master)

As a developer opening the map,
I want the nebula to render, settle and respond at the mockup's exact look,
So that the first view already delivers the wow (NFR-8).

**Acceptance Criteria:**

**Given** the Vite dev server aliasing a contract fixture at `./analysis.json` (AD-12)
**When** the viewer loads
**Then** nodes appear and visibly settle; Settled (< 0.5 px/frame × 30 frames) is reached in 2–3 s on the 100-module fixture; camera fits ≤ 800 ms after; replay re-runs it; `prefers-reduced-motion` renders pre-settled (FR-12)
**And** the layout is identical across reloads (seeded PRNG, AD-6).

**Given** the rendered frame
**When** compared to the mockup constants
**Then** palette hexes match exactly; size ∝ LOC; glow ∝ churn; hot nodes (≥ configured threshold) render `--hot` replacing layer colour and pulse (~380 ms, off under reduced-motion); starfield ~220 stars; stats bar shows name/files/LOC/modules/commits/languages; legend has 4 layers + hot spot; hint overlay bottom-right (FR-13, UX-DR1–5, 9).

**Given** mouse input
**When** dragging and scrolling
**Then** pan follows, zoom is cursor-centred and clamps at [0.4, 6.0] (FR-15)
**And** chrome components never touch the canvas or simulation directly (AD-5 — verified by module structure).

**Given** a fixture with `schemaVersion` "99.0"
**When** the viewer loads it
**Then** a clear error screen names the version mismatch (FR-6).

## Epic 3: Full Exploration Experience

Cohort note: 3.3/3.4/3.5 share `packages/viz` — territory split (3.3 = engine
interactions, 3.4 = chrome, 3.5 = export + harness) with intent-sync; the only
hard dependency is 3.4 ← 3.3.

### Story 3.1: Python import edges (`3.1-deps-python`)

Owner: `deps` · Touches: `test-fixtures/` (python fixture) · Depends_on: `[]`

As a developer exploring a Python repo,
I want Python imports resolved to repo files via the WASM grammar,
So that mixed and Python repos get real edges with zero native compilation.

**Acceptance Criteria:**

**Given** the grammar build script with pinned tree-sitter-cli (ABI-matched to web-tree-sitter 0.26, AR-8)
**When** it runs
**Then** it reproduces the committed `tree-sitter-python.wasm` byte-identically, and the parser loads it via `import.meta.url` (works source-mode and bundled).

**Given** a crafted Python fixture (absolute imports, relative `from . import`, packages with `__init__.py`)
**When** `analyze` runs
**Then** intra-repo imports resolve to file edges; site-packages/stdlib are ignored; unresolved are counted; ordering stable
**And** a syntax-error file yields no edges + one warning, stage completes.

**Given** the streamlit demo repo (py + ts)
**When** both parsers run
**Then** both languages produce edges and the combined unresolved rate is recorded (≤ 20%).

### Story 3.2: Serve and URL mode (`3.2-cli-serve-url`)

Owner: `cli` · Touches: — · Depends_on: `[]`

As a developer,
I want the CLI to serve the map locally and accept a GitHub URL,
So that `npx gitnebula` ends in an open browser, and remote repos are one command away.

**Acceptance Criteria:**

**Given** a completed analysis
**When** the server starts
**Then** it binds `127.0.0.1` only (never 0.0.0.0), auto-selects a free port, prints the URL, serves the viz dist with `analysis.json` at the sibling URL (AD-12), opens the default browser, and shuts down cleanly on Ctrl+C (FR-5).

**Given** `npx gitnebula https://github.com/<org>/<repo>`
**When** the run starts
**Then** a shallow clone (`--shallow-since` window, full-clone fallback) lands in a temp dir, analysis proceeds identically, and the temp dir is removed on exit — success or failure (FR-2)
**And** no network use occurs after the clone (AD-8).

### Story 3.3: Navigation — semantic zoom, hover, search (`3.3-viz-navigation`)

Owner: `viz` · Touches: — · Depends_on: `[]` · Cohort: intent-sync with 3.4, 3.5

As a developer exploring the map,
I want zoom to unfold modules, hover to reveal dependency chains, and search to fly me anywhere,
So that a 2,000-file repo is navigable in seconds.

**Acceptance Criteria:**

**Given** zoom crossing 1.8×
**When** modules intersect the viewport (+margin)
**Then** only those unfold into files (ADR-0006); panning a collapsed module into view at ≥ 1.8× unfolds it; below threshold all collapse; file labels appear at ≥ 3.0×; member files spawn at their module's position and settle locally without disturbing the global layout (FR-16).

**Given** a hovered node
**When** the frame renders
**Then** the one-hop chain highlights (edges 0.62), everything else dims (nodes ≤ 0.1, edges 0.03 — both ≤ 0.2 per FR-17), and the tooltip (name + churn %) follows the cursor without viewport overflow.

**Given** the persistent search box (⌘K / Ctrl+K / `/` focus)
**When** I type and select among top-7 fuzzy results (arrows + Enter, Esc closes)
**Then** the camera flies 620 ± 50 ms ease-out to 2.0× (module) / 3.0× (file), the target pulses, a file inside a collapsed module unfolds it on arrival, and reduced-motion jumps instantly (FR-18).

### Story 3.4: Panel and view modes (`3.4-viz-panel-modes`)

Owner: `viz` · Touches: — · Depends_on: `[3.3-viz-navigation]` · Cohort: intent-sync with 3.3, 3.5

As a developer inspecting a node,
I want a detail panel with history metrics and a heatmap mode,
So that hot spots and coupling become explorable evidence.

**Acceptance Criteria:**

**Given** a node click
**When** the panel opens
**Then** it shows name, path, kind + layer, files (modules), LOC, churn %, authors, relative last-change, top-3 co-changing modules (sorted from contract module pairs — no analytics in viz), hot badge at the configured threshold, churn bar, and a selection ring on the node; the panel accepts an inert optional `description` slot rendered nowhere (FR-19, AD-10).

**Given** panel actions
**When** used
**Then** "open on GitHub" links default-branch + path (absent for non-GitHub remotes); "isolate" dims all non-chain elements until toggled off or panel closes; clicking empty canvas closes panel + clears selection and isolate; a completed drag never selects (FR-20).

**Given** the mode toggle
**When** switching Structure ↔ Heatmap
**Then** heatmap interpolates cold→hot over `churn` (mockup formula), `aria-pressed` reflects state, and the mode survives unfold/collapse (FR-21).

### Story 3.5: PNG export and perf harness (`3.5-viz-export-perf`)

Owner: `viz` · Touches: `.github/workflows/` (perf job) · Depends_on: `[]` · Cohort: intent-sync with 3.3, 3.4

As a tech lead sharing evidence — and as CI guarding the wow,
I want high-res PNG export and an automated fps measurement,
So that maps travel into documents and 60 fps stays a tested number (SM-2).

**Acceptance Criteria:**

**Given** the export button
**When** clicked
**Then** a PNG downloads at ≥ 2× canvas CSS resolution, re-rendered through the GraphEngine (AD-5), matching current camera, mode, and highlight state (FR-22).

**Given** the Playwright harness on the 2,000-node synthetic fixture
**When** the scripted pan+zoom sequence runs
**Then** measured fps ≥ 55 sustained (FR-14) — runnable locally and wired as a CI job (allowed to be non-blocking/nightly if runner variance demands; decision recorded)
**And** a reduced-motion audit confirms: no settle animation, no pulse, instant fly-to (NFR-7).

## Epic 4: Ship It

### Story 4.1: Static bundle (`4.1-build-bundle`)

Owner: `cli` · Touches: `packages/viz` (build config) · Depends_on: `[]`

As an OSS maintainer,
I want `gitnebula build` to emit a static, self-contained bundle,
So that my repo's map hosts on GitHub Pages with no server.

**Acceptance Criteria:**

**Given** a completed analysis
**When** `gitnebula build` runs
**Then** the output dir holds exactly one self-contained `index.html` (inlined JS/CSS, system fonts) + sibling `analysis.json` (AD-11/12, ADR-0004), viewer assets ≤ 2 MB gzipped (CI-checked)
**And** served statically, the map fully works and the network log shows only the bundle's own files (FR-23).

**Given** the published `gitnebula` package (`npm pack` in CI)
**When** installed cold and run
**Then** the tarball contains the bundled cli, viz dist, and the `.wasm` (AD-11 prepack), and `npx`-equivalent invocation works without pnpm or the workspace.

### Story 4.2: CI recipe and Pages dogfooding (`4.2-ci-pages-recipe`)

Owner: `cli` · Touches: `.github/workflows/`, `docs/` · Depends_on: `[4.1-build-bundle]`

As an OSS maintainer,
I want a ready-made Actions workflow regenerating the map on push,
So that my README's map is always current — proven on gitnebula itself.

**Acceptance Criteria:**

**Given** the documented workflow (docs page with copy-paste YAML)
**When** added to this repository and pushed
**Then** it regenerates the bundle and publishes to GitHub Pages, green (FR-24, SM-5)
**And** the docs state the Pages setup steps and the analysis.json-only refresh property.

### Story 4.3: Launch-ready README (`4.3-repo-quality`)

Owner: `cli` · Touches: repo root, `docs/` · Depends_on: `[]`

As a visitor deciding whether to try gitnebula,
I want a README that shows the product in 30 seconds,
So that the repo itself sells the tool (FR-25, SM-7).

**Acceptance Criteria:**

**Given** the README
**When** viewed on GitHub
**Then** it contains: a 30-second demo GIF/video (external recorder; placeholder forbidden at story close), the live map-of-itself link (4.2's Pages URL), install/usage (`npx gitnebula`), the CI badge, and license note
**And** `CONTRIBUTING.md` is complete (workflow, commit format, trailers, how to run tests)
**And** GIF-recording steps are documented in docs (in-tool recording is a non-goal).

### Story 4.4: DoD validation on demo repos (`4.4-dod-validation`)

Owner: `cli` · Touches: `docs/` · Depends_on: `[4.2-ci-pages-recipe]`

As the maintainer declaring MVP done,
I want the full DoD executed against fastapi, excalidraw and streamlit,
So that "done" is a recorded measurement, not a feeling (SM-1, DoD 7).

**Acceptance Criteria:**

**Given** pinned commits of the three demo repos on reference hardware
**When** `npx gitnebula` runs on each
**Then** each completes ≤ 60 s to a working map, crash-free; timings, hardware spec, and pinned SHAs are recorded in a DoD report in `docs/`
**And** the unresolved-import rates and contract sizes (≤ 5 MB) are recorded.

**Given** the human-review checklist (visual sensibility, layer sanity, mockup fidelity items marked human-review in the PRD)
**When** the maintainer walks it per repo
**Then** every item is checked or has a filed follow-up issue — the checklist walk itself MUST be left unticked for the maintainer (owner gate).
