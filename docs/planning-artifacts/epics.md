---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/prd.md
  - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/addendum.md
  - docs/planning-artifacts/architecture.md
  - docs/GITNEBULA_PROJECT_BRIEF.md
  - reference/mockup.html
  - CLAUDE.md
epic5:
  stepsCompleted: [1, 2, 3, 4]
  added: 2026-08-15
  branch: epic/5-onboarding
  inputDocuments:
    - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/prd.md
    - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/addendum.md
    - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/reconcile-brief.md
    - docs/planning-artifacts/architecture.md
    - docs/planning-artifacts/architecture/architecture-gitnebula-2026-08-10
    - reference/mockup.html
    - CLAUDE.md
  # The measurements that justify FR-29..FR-31 were taken in-session on a real
  # langgraph checkout (662 nodes) rather than read from a document; they are
  # recorded inline in the Epic 5 section so the reasoning survives the session.
epic6:
  stepsCompleted: [1, 2, 3, 4]
  added: 2026-09-05
  branch: epic/6-assembled-viewer
  inputDocuments:
    - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/prd.md
    - docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/addendum.md
    - docs/planning-artifacts/architecture.md
    - docs/planning-artifacts/architecture/architecture-gitnebula-2026-08-10/ARCHITECTURE-SPINE.md
    - docs/GITNEBULA_PROJECT_BRIEF.md
    - reference/mockup.html
    - CLAUDE.md
    # Specific to this epic: the evidence that motivates it and the
    # conventions the new suite inherits rather than invents.
    # A planning handover written by the SpecWitness side on 2026-09-05 was
    # read as an input and then deleted by the maintainer, because verifying
    # it against the tree showed several of its claims to be stale — picking,
    # the 2D/3D swap and reduced-motion boot are all already covered, and it
    # under-counted the epic-5 manual-testing walk. What survived the check is
    # quoted inline in the Epic 6 section rather than cited to a file that no
    # longer exists.
    - docs/implementation-artifacts/epic-5-onboarding/epic-5-retrospective.md
    - docs/planning-artifacts/human-review-checklist-v2-post-epic-5.md
    - packages/viz/perf/playwright.config.ts
    - packages/viz/bundle/playwright.config.ts
  # This epic introduces NO new FR. It verifies behaviour that FR-26..FR-33
  # already define and that Epic 5 already shipped; each story names the
  # requirement it covers rather than minting one. Decided with the maintainer
  # on 2026-09-05 — the product does not change for the user, so there is no
  # functional requirement to add, and the brief's "do not widen scope" rule
  # applies to verification work as much as to features.
  #
  # Two scope decisions taken at planning time, both of which a story agent
  # must not relitigate:
  #   1. The suite runs OUTSIDE `pnpm test`, as its own script, exactly as
  #      `perf` and `bundle-check` already do. It claims port 4320 and the
  #      env var UI_PORT, continuing the PERF_PORT 4318 / BUNDLE_PORT 4319
  #      series.
  #   2. It covers ONLY what jsdom structurally cannot reach. ~318 jsdom tests
  #      across 21 files in packages/viz/src/chrome/ already assert the
  #      readouts, driving the components with fake engines; re-asserting them
  #      through a browser would be duplication in a slower harness.
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

#### Post-MVP — Epic 5 (onboarding-first map)

Added 2026-08-15. These extend the inventory; FR-1..FR-25 are unchanged. Every
one is derived from `analysis.json` as it already stands — no contract change,
`schemaVersion` remains "1.0" (NFR-11).

FR-26: Start-here ranking — three categories computed from the graph: core (non-test files by in-degree), entry points (non-test, in-degree 0, out-degree > 0), tests-as-documentation (layer `test` by out-degree)
FR-27: Blast radius — a selected node's co-change partners surfaced in the panel, with an explicit empty state naming why it is empty
FR-28: Layer filter — multi-select over backend/frontend/infra/test/other, restricting what the map draws
FR-29: Hover highlights the chain instead of dimming the map
FR-30: Drill-down into a module, plus a connected-only filter hiding edgeless nodes
FR-31: Analysis window made legible in the UI — metrics carry their window, and "no change in window" is distinguishable from "no data"
FR-32: 3D view — a switchable, co-equal alternative to the 2D map
FR-33: README and docs reflect the post-Epic-5 product: changed behaviours, new capabilities, re-recorded demo

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

#### Post-MVP — Epic 5

NFR-11: No contract change — FR-26..FR-31 are computed in the Viewer from the existing `analysis.json`; `schemaVersion` stays "1.0" (a bump would need its own story and an ADR, AD-9)
NFR-12: Rankings and filters are deterministic — ties break on `id`, no `localeCompare` anywhere (AD-4, AD-6)
NFR-13: The 3D view either holds NFR-3's ≥ 55 fps floor on the 2,000-node fixture, or documents its own measured floor and the node count at which it degrades

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

Post-MVP — Epic 5. The mockup is silent on these: it was drawn for a few dozen
hardcoded nodes, and the behaviours below are what a 650-node repository
demands of it.

- UX-DR12: The map opens on an answer, not an empty canvas — the start-here panel is the default first state, dismissible, and reachable again from the header
- UX-DR13: Filter controls carry `aria-pressed` and match the existing mode-toggle styling (UX-DR6); active filters are visible without opening a menu
- UX-DR14: Empty states name their cause and offer the exit (e.g. "no co-change data in the 90-day window — try `--window-days 365`"), never a bare zero
- UX-DR15: The 3D view honours prefers-reduced-motion — no auto-rotation, no entry animation (extends UX-DR11)
- UX-DR16: README leads with the question the tool answers ("where do I start reading this repo"), not a feature list

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
FR-26: Epic 5 — start-here ranking
FR-27: Epic 5 — blast radius from co-change
FR-28: Epic 5 — layer filter
FR-29: Epic 5 — hover fix
FR-30: Epic 5 — drill-down + connected-only
FR-31: Epic 5 — analysis window in the UI
FR-32: Epic 5 — 3D view
FR-33: Epic 5 — README and docs refresh

**Epic 6 adds no FR row, deliberately.** It verifies behaviour FR-26..FR-33
already define and Epic 5 already shipped; the product does not change for the
reader, so there is no functional requirement to mint. Each of its stories
names the requirement it covers instead. Its verification targets are, by
story: 6.2 → FR-32 + AD-5/AD-6, 6.3 → AD-7/AD-12 + NFR-11, 6.4 → FR-27/FR-26 +
UX-DR14, 6.5 → FR-28 + UX-DR13.

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

### Epic 5: Onboarding-First Map (post-MVP)
The map stops being an inventory and starts being an answer. It opens on
"where do I start reading this repo", makes the history it already collects
legible, and stays readable at 650 nodes instead of strobing under the cursor.
After merge: a developer dropped into an unfamiliar repository gets a reading
order, can trace what changes together, and can filter the map down to the
part they care about — in 2D or in 3D.
**FRs covered:** FR-26, FR-27, FR-28, FR-29, FR-30, FR-31, FR-32, FR-33
**Stories:** 8, in two waves on one shared epic branch (see below).

### Epic 6: The Assembled Viewer, Verified (post-MVP)

Added 2026-09-05. The viewer is well covered part by part and **not covered at
all as an assembled whole**: `boot()` — the ~120 lines that fetch the document,
mount the chrome, parse `?view=3d` and build the engine — is executed by no
test in the repository. Its only caller is `main.ts:9`. After merge, the path a
reader actually takes is verified end to end in a real browser, the first
screen a failed load produces is verified at all, and the two validators that
guard the same document are checked against each other rather than separately.

**FRs covered:** none new — verifies FR-26..FR-33, AD-5, AD-6, AD-7, AD-12,
NFR-11, UX-DR13, UX-DR14.
**Stories:** 5, in two waves on one shared epic branch, `epic/6-assembled-viewer`.

> **Why one epic and not three.** Every story here is `Owner: viz` and most
> touch `chrome/` and `engine/`. Splitting them across epics would be the
> file-churn antipattern — three epics editing the same core files, each
> waiting on the others' merges. One epic with ordered stories is the correct
> shape; the two waves are a launch constraint (≤ 5 agents), not a boundary.

> **Branching (differs from Epic 4).** Epic 4 ran three separate `epic/4-*`
> branches, each merged to `master` on its own. Epic 5 uses **one** branch,
> `epic/5-onboarding`, for both waves: wave A merges into it, wave B starts
> **from it** (`AGENT_PR_BASE_BRANCH=epic/5-onboarding`) with wave A's work
> already in the base, and the whole epic reaches `master` as a single merge
> commit after the maintainer's manual verification. This is what makes
> 5.6's dependency on 5.5 a base-state fact rather than a cross-wave block.

**Wave A — the map becomes readable and answers a question (5 stories)**
5.1 start-here ranking · 5.2 hover fix · 5.3 layer filter · 5.4 drill-down and
connected-only · 5.5 analysis window in the UI. All `Depends_on: []` —
territories are disjoint (new panel / renderer / filter chrome / engine
scoping / panel copy), so the wave runs in intent-sync like 3.3–3.5 did.

**Wave B — depth and closure (3 stories)**
5.6 blast radius · 5.7 3D view · 5.8 README and docs. Launched only after
wave A has landed on `epic/5-onboarding`, so 5.6 finds 5.5's empty-state
convention and window labelling already in its base.

> **Deliberate deviation — 5.8.** Principle 5 (no story depends on a future
> story) is broken by the README story, which documents what 5.1–5.7 build.
> It is recorded rather than engineered away: the harness stores exactly one
> blocking predecessor, so seven cannot be declared. 5.8 carries
> `Depends_on: []` and the ordering lives in its spec prose and in the
> supervisor's hands — the same treatment story 4.3 got for the same reason.

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

## Epic 5: Onboarding-First Map (post-MVP)

Added 2026-08-15. One branch, `epic/5-onboarding`; wave A (5.1–5.5) merges into
it, wave B (5.6–5.8) starts from it, and the whole epic reaches `master` as one
merge commit after the maintainer's manual walk.

Every criterion below is computable from `analysis.json` as it stands. Where a
number appears it was measured in-session on a real langgraph checkout (662
nodes, 90-day window) — those measurements are the reason these stories exist,
so they are quoted rather than paraphrased.

### Story 5.1: Start-here ranking (`5.1-viz-start-here`)

Owner: `viz` · Touches: — · Depends_on: `[]` · Cohort: wave A, intent-sync

As a developer dropped into an unfamiliar repository,
I want the map to tell me what to read first,
So that I get a reading order instead of an inventory (FR-26, UX-DR12).

**Acceptance Criteria:**

**Given** a loaded `analysis.json`
**When** the ranking is computed
**Then** three categories are produced from the graph alone: **core** = `kind: file`, `layer != test`, ranked by in-degree; **entry points** = `kind: file`, `layer != test`, in-degree 0 and out-degree > 0, ranked by out-degree; **tests as documentation** = `layer == test`, ranked by out-degree
**And** ties break on `id` and no comparison uses `localeCompare`, so the same document always yields the same list (NFR-12, AD-6).

**Given** the langgraph fixture (or an equivalent multi-package Python repo)
**When** the three lists render
**Then** core is headed by the most-imported non-test file, entry points exclude test files entirely, and tests-as-documentation is non-empty — the three lists are disjoint by construction.

**Given** a first load with no prior selection
**When** the viewer finishes settling
**Then** the start-here panel is the default first state, is dismissible, and can be reopened from the header without reloading (UX-DR12)
**And** selecting an entry flies the camera to that node and opens its detail panel, reusing the existing flight and selection path (AD-5 — chrome never moves the camera by hand).

**Given** a repository where a category has no members (e.g. no test layer)
**When** the panel renders
**Then** that category states why it is empty rather than rendering a blank block (UX-DR14).

### Story 5.2: Hover that highlights instead of dimming (`5.2-viz-hover-fix`)

Owner: `viz` · Touches: — · Depends_on: `[]` · Cohort: wave A, intent-sync

As a developer moving the pointer across a dense map,
I want hover to reveal a chain without extinguishing everything else,
So that the map stops strobing under the cursor (FR-29).

**Acceptance Criteria:**

**Given** the measured baseline — a hovered node dims 647 of 650 nodes to `NODE_ALPHA_DIMMED`, because the median 1-hop chain is 3 nodes
**When** a node is hovered after this story
**Then** nodes outside the chain keep a legible resting opacity and the chain is marked by emphasis (brightness, ring, edge alpha) rather than by everything else disappearing
**And** the hovered node and its one-hop chain remain unambiguously identifiable — FR-17's intent survives, its mechanism does not.

**Given** a pointer sweeping across the map at 6× zoom, where hit-areas cover 78% of the viewport
**When** the pointer crosses many nodes in quick succession
**Then** no frame-level flicker is introduced: the transition between hover states is stable, and hover is still suppressed during a pan (existing behaviour, do not regress).

**Given** the isolate action (story 3.4) and the search-arrival pulse (story 3.3)
**When** either is active
**Then** they keep working unchanged — this story changes the hover encoding only, not the selection or isolate semantics.

**Given** `prefers-reduced-motion`
**When** hover state changes
**Then** no animated transition is introduced (NFR-7, UX-DR11).

### Story 5.3: Layer filter (`5.3-viz-layer-filter`)

Owner: `viz` · Touches: — · Depends_on: `[]` · Cohort: wave A, intent-sync

As a developer interested in one side of a mixed repository,
I want to filter the map by layer,
So that I can look at the backend without the frontend and tests on top of it (FR-28).

**Acceptance Criteria:**

**Given** the five contract layers (backend, frontend, infra, test, other)
**When** the filter control renders
**Then** each layer is independently toggleable (multi-select), controls carry `aria-pressed`, and the active set is visible without opening a menu (UX-DR13)
**And** the control's styling matches the existing mode toggle (UX-DR6).

**Given** a filter excluding one or more layers
**When** the frame renders
**Then** excluded nodes are not drawn at all — not dimmed — so they cannot be hovered, picked, or counted as hit-area
**And** an edge is drawn only when both endpoints survive the filter.

**Given** a filter that excludes every layer
**When** the map renders
**Then** the empty result is named ("no nodes match the active filters") with a one-click way back (UX-DR14).

**Given** an active filter
**When** the user exports a PNG
**Then** the export matches what is on screen, filters included (FR-22's "matches camera/mode/highlight" extends to filters).

### Story 5.4: Drill-down and connected-only (`5.4-viz-drill-down`)

Owner: `viz` · Touches: — · Depends_on: `[]` · Cohort: wave A, intent-sync

As a developer facing 650 nodes at once,
I want to scope the map to one module and hide the nodes that carry no edges,
So that I can look at a part of the repository instead of all of it (FR-30).

**Acceptance Criteria:**

**Given** a module on the map
**When** the user drills into it via a dedicated gesture (not the single click, which already means "select")
**Then** the map scopes to that module, its member files and the modules it actually imports or is imported by; everything else leaves the frame
**And** the scope is exited by an equally discoverable gesture plus `Escape`, and the current scope is always visible in the chrome — a user must never be unable to tell they are scoped, or how to leave.

**Given** the measured baseline — 232 of 650 files carry no edge at all
**When** the connected-only filter is enabled
**Then** nodes with degree 0 are not drawn, and the count of what was hidden is stated rather than silently dropped.

**Given** a scoped view
**When** the simulation runs
**Then** scoping affects what the frame carries, not what the layout simulates — leaving a scope must not re-run the settle (measured: whole-repo scene 662 nodes / 2388 edges; `libs/langgraph/` scope 169 / 917).

**Given** an active scope
**When** search flies to a node outside it
**Then** the behaviour is defined and implemented — either the scope is left or the target is refused with a reason; a silent no-op is not acceptable.

### Story 5.5: Analysis window made legible (`5.5-viz-history-window`)

Owner: `viz` · Touches: `packages/cli` (terminal summary wording only) · Depends_on: `[]` · Cohort: wave A, intent-sync

As a developer reading a node's metrics,
I want to know that they describe a 90-day window,
So that a zero reads as "quiet lately" rather than "broken tool" (FR-31, UX-DR14).

**Acceptance Criteria:**

**Given** the measured baseline — 386 of 650 files carry `commits: 0` because their last change predates the window, and the panel renders a bare `0`
**When** the panel shows history metrics
**Then** each metric states the window it covers, sourced from `repo.analysisWindowDays` and never hardcoded
**And** the wording works for any window value, not only 90.

**Given** a node with `lastChangedAt: null` (no commit inside the window)
**When** its panel renders
**Then** it is presented as "no change in the last N days" and is visibly distinct from a node that has history in the window
**And** the panel names the way to widen it (`--window-days`), per UX-DR14.

**Given** a repository with no commits at all in the window
**When** the map and panel render
**Then** the zero-history case is stated once, clearly, rather than repeated as a bare zero on every node.

**Given** the heatmap mode
**When** most nodes have zero churn
**Then** the mode's legend or empty state says so, so that a nearly-uniform heatmap is understood as data rather than as a rendering failure.

### Story 5.6: Blast radius from co-change (`5.6-viz-blast-radius`)

Owner: `viz` · Touches: — · Depends_on: `[5.5-viz-history-window]` · Cohort: wave B

As a developer about to change a file,
I want to see what has historically changed together with it,
So that I learn what else I am likely to touch — knowledge no static analysis can give me (FR-27).

**Acceptance Criteria:**

**Given** a selected node and the `cochanges` array already present in the contract
**When** its panel renders
**Then** its co-change partners are listed with their shared-commit counts, ordered by count descending then by `id` (NFR-12)
**And** selecting a partner navigates to it through the existing selection path.

**Given** the measured baseline — 128 pairs exist but only 52 of 662 nodes appear in any pair
**When** a node has no co-change partners
**Then** the panel states why (below the ≥ 3 shared-commit threshold, or no shared commits inside the window) and names `--window-days` as the lever — this is the majority case and must not read as a bug (UX-DR14, consistent with 5.5's conventions already in the base).

**Given** a node with partners
**When** the map is asked to show them
**Then** the partner set is visually distinguishable from the import chain — co-change is not a dependency edge and must not be drawn as one.

**Given** module-level and file-level pairs in the same array
**When** either is displayed
**Then** the level is unambiguous to the reader, and a file's panel never silently shows a module pair as if it were its own.

### Story 5.7: 3D view (`5.7-viz-3d-view`)

Owner: `viz` · Touches: `docs/adr/` · Depends_on: `[]` · Cohort: wave B

As a developer exploring a dense repository,
I want a three-dimensional view of the same graph,
So that a cloud that overlaps in the plane can be separated by depth (FR-32).

**Acceptance Criteria:**

**Given** the AD-5 seam
**When** the 3D view is implemented
**Then** it is a second implementation behind the `GraphEngine` interface, switchable at runtime, with 2D remaining the default
**And** chrome reaches it through the same interface and events — `chrome/boundary.test.ts` keeps passing unchanged.

**Given** AD-6's determinism promise
**When** the same `analysis.json` is loaded twice
**Then** the 3D layout and initial camera orientation are identical, seeded from the document as the 2D layout is — no unseeded randomness anywhere in the view.

**Given** NFR-3's frame budget
**When** the automated perf harness runs against the 2,000-node fixture in 3D
**Then** it either holds the ≥ 55 fps floor, or records a measured floor and the node count at which it degrades, in the story's docs artifact (NFR-13) — an unmeasured 3D view does not satisfy this story.

**Given** ADR-0004's 2 MB gzipped viewer budget and product principle 1 (zero-config, always a useful result)
**When** the bundle is measured and the view runs on a machine without working WebGL
**Then** the budget still passes, and the absence of 3D degrades to the 2D map with a stated reason rather than a blank canvas
**And** an ADR records the decision and its consequences for AD-5, AD-6 and ADR-0004.

**Given** `prefers-reduced-motion`
**When** the 3D view is entered
**Then** there is no auto-rotation and no entry animation (UX-DR15, NFR-7).

### Story 5.8: README and docs refresh (`5.8-repo-docs-refresh`)

Owner: `cli` · Touches: repo root, `docs/` · Depends_on: `[]` · Cohort: wave B, merges last

As a visitor deciding whether gitnebula is worth running,
I want the README to describe the tool as it now behaves,
So that the documentation does not promise the previous version's product (FR-33, UX-DR16).

> **Ordering note.** This story documents what 5.1–5.7 build, so it is worked
> and merged last. `Depends_on` is `[]` because the harness stores exactly one
> blocking predecessor and seven cannot be declared — the ordering is the
> supervisor's to enforce, exactly as it was for story 4.3.

**Acceptance Criteria:**

**Given** the README's current claims
**When** it is revised
**Then** every statement contradicted by Epic 5 is corrected — specifically the "everything outside the hovered node's one-hop chain dims to ~0.2 opacity" line, which 5.2 replaces, and the navigation description, which 5.4 extends with drill-down
**And** no claim is made that the shipped code does not support.

**Given** the capabilities added by this epic
**When** the README describes the product
**Then** start-here, blast radius, layer filtering and the 3D view are documented, and the document leads with the question the tool answers rather than a feature list (UX-DR16).

**Given** the demo GIF, which shows the pre-Epic-5 flow
**When** the README is finished
**Then** the demo reflects the onboarding-first flow, and `docs/recording-demo.md` is updated to match the recipe actually used (a placeholder is forbidden at story close, as in 4.3).

**Given** `CLAUDE.md`'s frozen-artifact rule
**When** documentation is updated
**Then** completed-work sections are appended to, never rewritten, and the epic's ADRs are listed in `docs/adr/`.

## Epic 6: The Assembled Viewer, Verified (post-MVP)

Added 2026-09-05. One branch, `epic/6-assembled-viewer`; wave A (6.1, 6.5)
merges into it, wave B (6.2–6.4) starts from it, and the whole epic reaches
`master` as one merge commit after the maintainer's walk — the shape Epic 5
used.

**Why this epic exists, stated precisely.** An earlier framing — "nothing
drives the chrome through a real browser" — was checked against the tree and is
false. `packages/viz/perf/` and `packages/viz/bundle/` already carry 14
Playwright tests covering frame rate, reduced-motion boot, export pixel parity
and the built bundle; `engine.pick()` is tested against real geometry by a grid
scan over a settled map (`engine.test.ts:290-305`); the 2D↔3D state carry-over
has 15 tests (`app-view-swap.test.ts`); the 3D view is a perspective projection
onto a 2D canvas, so **no WebGL path exists to fall back from**. Roughly 318
jsdom tests across 21 files in `packages/viz/src/chrome/` already assert the
readouts. **Re-asserting any of that through a browser would be duplication in
a slower harness**, and this epic must not do it.

What is true is narrower and worse:

- **`boot()` is executed by no test in the repository.** Its only caller is
  `main.ts:9`. That is ~120 lines that fetch the document, render the error
  screen on failure, mount the chrome, parse `?view=3d`, and build the engine.
- **The real `swapEngine()` is never called either.** Its four ordering
  constraints — the switch reflecting what was *built* rather than requested,
  the probe not erasing a constructor's reason, `publishHarnessHandle` **before**
  `load()` because reduced motion settles synchronously inside it, and
  `restoreState` after `load()` but before `connectEngine` — each document a
  defect they exist to prevent, and each is guarded only by a **hand-maintained
  duplicate** of the carry logic in the test file (`app-view-swap.test.ts:50-69`,
  whose own comment says it must be "kept in step with" `app.ts`). Deleting a
  field from `restoreState` would fail nothing.
- **`renderErrorScreen` has no test at all**, in any harness, while being the
  first and only thing a reader sees when a load fails — from three call sites
  and six distinct failure constructions.
- **Two validators guard the same document and nothing checks them against each
  other.** `packages/cli/src/assemble.ts` validates with ajv against a schema
  that is `additionalProperties: false` throughout; `packages/viz/src/loader.ts`
  re-checks with hand-written predicates over a subset — deliberately, to keep
  the bundle self-contained. Measured: the schema requires **12** node fields,
  `isNodeShaped` checks **6**; the schema requires **4** edge fields,
  `isEdgeShaped` checks **2**; `cochanges` is `required` at document level and
  the loader asserts only that it is an array, never inspecting an element.
- **Control reachability under real layout is guarded by a regex over the
  stylesheet.** `blast-radius.test.ts:412-431` asserts that `max-height:` and
  `overflow-y: auto` appear in the `.p-blast-list` and `#panel` rules, and its
  own comment calls this "a weaker check than a rendered one". It would pass
  with `max-height: 0`. Three regions depend on real viewport height (`#panel`,
  `#start-here`, `.p-blast-list`), and `body` is `overflow: hidden`, so content
  past the fold is **unreachable rather than merely off-screen** — the risk
  `styles.css:874-881` documents and story 5.6 left unticked.

**Two planning decisions a story agent must not relitigate.**

1. **The suite runs outside `pnpm test`**, as its own script, exactly as `perf`
   and `bundle-check` do. It claims port **4320** and the env var **`UI_PORT`**,
   continuing the `PERF_PORT` 4318 / `BUNDLE_PORT` 4319 series, and keeps that
   series' `reuseExistingServer: false` + `--strictPort` rule, which exists
   because a green run was once traced by `lsof` to another worktree entirely.
2. **It covers only what jsdom structurally cannot reach.** Every acceptance
   criterion below names what makes its subject unreachable in jsdom. A
   criterion that could be satisfied by a vitest test does not belong here.

**Fixtures.** No new fixture is needed and none may be added: `root-files`
carries 6 nodes across **three** layers (`backend` 2, `infra` 2, `test` 1) with
**3** cross-layer file edges and the only committed co-change pair
(`fp/proxy.py` ↔ `test_proxy.py`, 7 commits), which covers the layer filter and
blast radius together. `module-zero-files` is the only fixture carrying layer
`other`. `GITNEBULA_FIXTURE` selects the document and a missing one 404s loudly
by design.

### Story 6.1: The `ui` suite skeleton (`6.1-viz-ui-suite`)

Owner: `viz` · Touches: `packages/viz/perf/src/` (helper promotion) ·
Depends_on: `[]` · Cohort: wave A

As the maintainer,
I want a browser suite that can be run on demand and is proven able to fail,
So that later stories add coverage instead of each inventing a harness
(retrospective observation 7: a check that can quietly report clean is not a
check).

**Acceptance Criteria:**

**Given** the conventions the `perf` and `bundle` suites already established
**When** the `ui` suite is created
**Then** it lives at `packages/viz/ui/` with `testDir: "./tests"`,
`testMatch: "**/*.pw.ts"`, `workers: 1`, `fullyParallel: false`, `retries: 0`, a
fixed viewport and `deviceScaleFactor: 1`
**And** its dev server is started with `reuseExistingServer: false` and
`--strictPort` on port **4320**, overridable by `UI_PORT`
**And** it is invoked by `pnpm --filter @gitnebula/viz ui` and is **not** part
of `pnpm test`, matching `perf` and `bundle-check`.

**Given** that `openViewer` today lives in `packages/viz/perf/src/page-helpers.ts`
and is needed by two suites
**When** the `ui` suite needs it
**Then** it is promoted to a location both suites import, the `perf` suite is
updated to the new path, and `pnpm --filter @gitnebula/viz perf` still passes
**And** no spec calls `page.goto` directly, because navigation resolves before
the viewer publishes its handle.

**Given** the house rule that a suite must be shown able to fail
**When** the suite ships
**Then** it carries at least one negative control in the shape
`export.pw.ts:165` uses ("the parity check can fail: a stale export stops
matching a changed screen") — a test that asserts the positive check would go
red against a deliberately wrong expectation
**And** `HARNESS_HANDLE_KEY` is imported rather than the string `"__gitnebula"`
being written out
**And** every `expect` carries a prose failure message as its second argument.

**Given** `CLAUDE.md`'s rule against unasked-for additions
**When** the suite is wired
**Then** no dependency is added beyond what `perf` and `bundle` already use,
and `docs/dev/epic-6/6.1-viz-ui-suite/README.md` states how to run it and why
it is not in `pnpm test`.

### Story 6.2: `boot()` and the real view swap, end to end (`6.2-viz-boot-e2e`)

Owner: `viz` · Touches: — · Depends_on: `[6.1-viz-ui-suite]` · Cohort: wave B

As a reader switching between 2D and 3D,
I want the view change to keep what I was looking at,
So that the map is a view of my frame rather than a reset (FR-32, AD-5, AD-6).

**Acceptance Criteria:**

**Given** that `boot()` is called by `main.ts:9` alone and by no test
**When** the viewer is opened in a browser against the `root-files` fixture
**Then** a test exercises the real `boot()` — not a reconstruction — and
asserts through the harness handle that an engine was built and `settled`
resolved
**And** the same test proves `?view=3d` boots the 3D view directly, which no
jsdom test can, since `boot()` fetches `analysis.json`.

**Given** a reader who has set a mode, a layer filter, a scope, connected-only
and a selection
**When** they click the view switch and then switch back
**Then** every one of those is carried in both directions, asserted through the
handle after each swap
**And** the assertions run against the real `captureState`/`restoreState` in
`app.ts`, so the duplicate `carry()` helper in `app-view-swap.test.ts` is no
longer the only thing proving the carry — the story states in its record which
of the two is now authoritative.

**Given** that `swapEngine` republishes the harness handle on every swap
**When** a test holds a reference to the handle across a view change
**Then** the suite documents and demonstrates the trap: the cached `engine` is
destroyed, and the correct pattern is re-reading `globalThis[HARNESS_HANDLE_KEY]`
after the swap.

**Given** the ordering constraints inside `swapEngine`
**When** a 3D swap succeeds
**Then** the view switch's pressed state reflects the view that was **built**
**And** when the 3D constructor fails, the reader is left on a working 2D map
with the constructor's own reason shown rather than a probe's verdict — the
case `unavailabilityAfterSwap` exists for.

**Given** that jsdom pins `getBoundingClientRect` to a fixed 1200×800 at origin
(0,0) for every element (`test-support/fake-canvas.ts:113-123`)
**When** a node is clicked at real screen coordinates in a browser, with the
canvas sitting below the header
**Then** the node the reader aimed at is the node that becomes selected,
asserted through `getSelected()` — the one class of hit-testing bug the jsdom
grid scan structurally cannot see.

### Story 6.3: The first screen of a failed load, and the seam between two validators (`6.3-viz-load-failure`)

Owner: `viz` · Touches: `packages/cli` (fixture generation only, no source
change) · Depends_on: `[6.1-viz-ui-suite]` · Cohort: wave B

As a reader whose document is missing or stale,
I want the viewer to tell me what went wrong and what to do,
So that a failed load is a message rather than a blank page (AD-7, AD-12).

**Acceptance Criteria:**

**Given** that `renderErrorScreen` has no test in any harness and three call
sites
**When** `analysis.json` cannot be loaded
**Then** each of the loader's failure kinds — `unreachable`, `malformed`,
`unsupported-version` — renders a screen carrying its title and its detail
**And** the `file://` case shows the protocol hint, which is the one a reader
hits by double-clicking the bundle.

**Given** that the screen is built with `textContent` rather than `innerHTML`,
deliberately
**When** a failure detail contains markup
**Then** it is displayed as text and no element is created from it.

**Given** two validators over one document — ajv in `packages/cli/src/assemble.ts`
against a schema that is `additionalProperties: false` throughout, and
hand-written predicates in `packages/viz/src/loader.ts`
**When** the seam is measured
**Then** the story records the exact difference: the schema requires **12**
node fields and `isNodeShaped` checks **6** (`parent`, `commits`, `authors`,
`lastChangedAt`, `description`, `descriptionSource` unchecked); the schema
requires **4** edge fields and `isEdgeShaped` checks **2** (`kind`, `weight`
unchecked); `cochanges` is `required` at document level and the loader asserts
only that it is an array, never inspecting an element
**And** a test demonstrates the consequence in the browser: a document that ajv
would reject loads and renders, and the story states for each unchecked field
whether the viewer degrades safely or misreads it
**And** the finding is reported, not silently patched — widening the loader is
a contract-adjacent decision and would need its own story, per `CLAUDE.md`.

**Given** `NFR-11`
**When** this story closes
**Then** `analysis.schema.json` is byte-unchanged and `schemaVersion` is still
`"1.0"`.

### Story 6.4: Every control stays reachable at a real window size (`6.4-viz-reachability`)

Owner: `viz` · Touches: — · Depends_on: `[6.1-viz-ui-suite]` · Cohort: wave B

As a reader on a short screen looking at a file with many co-change partners,
I want the panel's actions to stay reachable,
So that content past the fold is scrollable rather than lost (FR-27, FR-26,
UX-DR14).

**Acceptance Criteria:**

**Given** that `body` is `overflow: hidden`, so anything past the fold is
unreachable rather than off-screen, and that the current guard
(`blast-radius.test.ts:412-431`) is a regex over the stylesheet its own comment
calls "a weaker check than a rendered one"
**When** the panel is opened on the node with the most co-change partners, at
a viewport of 1280×800 and again at a height of ~600 px
**Then** the `show on map` control and the panel's actions are inside the
viewport and clickable at both sizes
**And** the check is a rendered one — element boxes measured in the browser —
not a match against CSS text.

**Given** the three regions bounded by real viewport height — `#panel`,
`#start-here` and `.p-blast-list`
**When** each is filled past its cap
**Then** each scrolls its own content and none pushes a control outside the
window
**And** the test would fail if the `max-height` were removed, demonstrated by
the negative control 6.1 established.

**Given** that jsdom reports `offsetWidth`/`offsetHeight` as 0, so the tooltip's
flip has never run against a measured box (`tooltip.ts:104-107`)
**When** a node with a long path is hovered near the right and bottom edges
**Then** the tooltip's rendered rectangle stays inside the viewport
**And** the pure `tooltipPosition` function is left unchanged — this story
tests its real inputs, not its logic, which `tooltip.test.ts` already proves.

**Given** the human-review checklist v2
**When** this story closes
**Then** the "scrolling felt in a browser" item that story 5.6 left unticked is
either ticked with the evidence named, or restated as what remains genuinely
subjective.

### Story 6.5: Stable hooks for the readouts, and two defects Epic 5 left unowned (`6.5-viz-testids-and-debts`)

Owner: `viz` · Touches: `docs/adr/` · Depends_on: `[]` · Cohort: wave A

As a maintainer restyling the chrome,
I want the tests to survive a class rename, and the two reported defects closed,
So that the suite asserts behaviour rather than styling (FR-28, UX-DR13).

**Acceptance Criteria:**

**Given** that existing jsdom tests are pinned to styling classes — `.p-row`
carries 5 rules in `styles.css`, `.p-badge` 2, `.sh-metric` 1 — so a restyle
breaks tests that are not about styling
**When** `data-testid` is added
**Then** it is added **only** where the current hook is a CSS class **and** the
value is unreachable from the `GraphEngine` interface: the panel metric rows,
`.sh-metric`, the legend rows, `.scope-bar-hidden`, `.scope-bar-back` and
`.p-blast-row`
**And** controls that already carry an `id`, a `role` + `aria-label` or a
`data-*` are left alone, and `header.ts`'s two slot ids marked **Do not
rename** are untouched
**And** the existing jsdom tests for those regions are moved onto the new hooks,
so the pass is a net simplification rather than an addition.

**Given** the retrospective's debt 7a: the legend names four layers and `other`
is the largest layer on this repository (145 of 363 nodes) while `infra` is 3,
and both currently share the grey `#7c8598`
**When** the legend is corrected
**Then** `other` gains its own entry with a fifth hue distinguishable from
`infra`'s, so every layer-filter toggle has a legend key
**And** because `reference/mockup.html` knows only four layers, the fifth hue
is a deliberate departure and lands as an ADR in `docs/adr/` stating context,
decision and consequences.

**Given** the retrospective's debt 7b: `hiddenCount().visible` short-circuits to
`graph.nodes.length` when no scope and no connected-only filter is active, so
it ignores the layer filter, in both the 2D and 3D engines, while the interface
documents it as the survivors of every filter
**When** the count is corrected
**Then** it counts the survivors of the layer filter on that path too, in both
engines, pinned by a test watched red first
**And** any readout that displayed the wrong number is corrected with it.

**Given** that this story runs in wave A alongside 6.1
**When** it is worked
**Then** it touches no file under `packages/viz/ui/`, so the two branches
cannot conflict.
