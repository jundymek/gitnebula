---
title: "gitnebula MVP PRD"
status: final
created: 2026-08-10
updated: 2026-08-10
---

# PRD: gitnebula (MVP)

## 0. Document Purpose

This PRD turns [docs/GITNEBULA_PROJECT_BRIEF.md](../../GITNEBULA_PROJECT_BRIEF.md) into
implementable requirements for the MVP. Its readers are the downstream planning
workflows (architecture, epic/story breakdown) and the terminal-agents cohort that
will implement the stories. The brief remains the scope source of truth; this
document adds testable requirements, resolves the brief's open questions
(decision trail in `.memlog.md`, rationale in `addendum.md`, formal records in
`docs/adr/`), and fixes the numbers that acceptance criteria will cite. FRs are
numbered globally and stable; downstream artifacts reference them as `FR-n`.
Visual behaviour is grounded in `reference/mockup.html` (behavioural reference,
not an implementation base). Delivery-process requirements (story metadata, git
workflow, multi-agent execution) live in brief section 13 and `CLAUDE.md`, not
here.

## 1. Vision

Onboarding into an unfamiliar codebase is slow because a repo's structure exists
only in people's heads: the README says *what*, never *where and how*. gitnebula
is a CLI that turns any git repository into an interactive architecture map in
under a minute: `npx gitnebula`, no account, no API key, no code leaving the
machine. The map renders as a nebula — dark canvas, glowing nodes, an animated
force layout that visibly settles — and is built for exploration: semantic zoom
from modules to files, dependency-chain highlighting, fuzzy search, a detail
panel with git-history metrics.

What makes the map more than a pretty graph is the history baked into it: churn
glow, hot-spot badges, co-change coupling. The structure tells you where things
are; the history tells you where things *happen*. Both come from fully local,
deterministic analysis — an optional LLM description layer is the first post-MVP
step, and its absence degrades nothing.

The product doubles as its own demo: the result exports as a static bundle, and
the project's README embeds a live map of gitnebula itself. The project is also
a portfolio piece — repo quality (README with a demo, license, CI,
contribution docs) is a product requirement of the same rank as the features
(FR-25), not decoration.

## 2. Target User

### 2.1 Jobs To Be Done

- **Orient fast**: build a mental model of an unfamiliar repo in minutes, not
  days — for onboarding, reviewing a large PR, or auditing a dependency.
- **Find the risk**: locate hot spots and hidden coupling as evidence for
  refactoring conversations ("look at this glow" beats a spreadsheet).
- **Show, don't describe**: give an open source project a live, always-current
  architecture map in its README with zero hosting cost.
- **Stay private**: analyze proprietary code with a guarantee that nothing
  leaves the machine.

### 2.2 Non-Users (v1)

- Teams wanting a hosted dashboard or org-wide analytics — this is a local,
  single-repo tool (see §5 Non-Goals).
- Repos in languages other than Python and JS/TS — they render structure and
  history signals but no import edges (graceful degradation, not support).
- Auditors needing exact security/risk metrics — signals here are exploratory,
  not audit-grade.

### 2.3 Key User Journeys

- **UJ-1. Marta maps the backend on her second day.** Marta joined a team that
  owns a ~1,500-file Python/TS service. She runs `npx gitnebula` in her clone.
  Within a minute the browser opens on a dark canvas; nodes settle into a
  nebula over 2–3 seconds and the camera fits the graph. She sees at a glance
  that `core/` is large and glowing hot, hovers it, and watches its dependency
  chain light up while everything else dims. She zooms into `core/`, the module
  unfolds into files, she clicks `scoring.py`, reads its churn and authors in
  the panel, and opens it on GitHub from there. **Edge case:** the repo has a
  vendored directory the default excludes miss; the map is dominated by it. She
  adds one line to `.gitnebula.yml` and re-runs.
- **UJ-2. Tomek puts a live map in his project's README.** Tomek maintains an
  OSS library. He runs `gitnebula build`, gets a static bundle, publishes it on
  GitHub Pages via the example Actions workflow from the docs, and embeds the
  link (with a PNG preview exported from the tool) in his README. On every push
  the workflow regenerates the bundle; the map stays current with no server and
  no cost.
- **UJ-3. Ola arrives at a refactoring argument with evidence.** Ola, tech
  lead, suspects two modules are secretly coupled. She opens the map in
  Heatmap mode, sees both burn hot, clicks one, and the panel's top co-changing
  modules confirms they change together (co-change count from the last 90
  days). She exports a PNG of the isolated neighbourhood and drops it into the
  refactoring proposal.

## 3. Glossary

- **Repository** — the git repository under analysis (local path or shallow
  clone of a URL).
- **Node** — an entry in the map: a **Module** (`kind: "module"`) or a **File**
  (`kind: "file"`). Files reference their Module via `parent`.
- **Module** — a directory-level grouping of Files, derived from the top-level
  directory structure (with a descent heuristic for `src/`-style repos).
- **Layer** — a Node's classification: `backend | frontend | infra | test |
  other`. Drives node colour in Structure mode.
- **Import edge** — a directed dependency between two Nodes derived from static
  import/dependency parsing; module-level edges are aggregations of file-level
  edges. `weight` = number of underlying file-level import pairs.
- **Churn** (field `churn`) — a Node's commit activity in the Analysis window,
  normalized to `[0, 1]` against the 95th percentile of same-kind Nodes (see
  FR-10). Displayed as a percentage. Field names are window-neutral — the
  window length lives in repo metadata (`analysisWindowDays`), never in field
  names.
- **Commits** (field `commits`) — the raw count of commits touching a Node
  within the Analysis window; the un-normalized input to Churn.
- **Analysis window** — the trailing period over which git history is analyzed.
  Default 90 days, configurable; recorded in the Contract as
  `repo.analysisWindowDays`.
- **Hot spot** — a Node whose Churn is ≥ the hot-spot threshold (configurable,
  default 0.5).
- **Co-change** — a pair of Nodes modified together in the same commit;
  `count` = number of such commits in the analysis window.
- **Contract** — the `analysis.json` file: the single, versioned, validatable
  interface between the analysis pipeline and the Viewer.
- **Viewer** — the browser frontend (the `viz` module's product) that renders
  the Contract.
- **Bundle** — the static export (`gitnebula build`): Viewer assets +
  `analysis.json`, hostable on any static host.
- **Structure mode / Heatmap mode** — the two view modes: colour by Layer vs
  colour by Churn.
- **Dependency chain** — for a hovered/isolated Node: the Node itself plus all
  Nodes connected to it by an Import edge in either direction (one hop), plus a
  hovered Module's member Files when unfolded. One hop is deliberate (mockup
  behaviour): transitive chains on a dense graph are noise; a transitive mode
  is a v2 candidate.
- **Settled** — the state of the force simulation when the maximum node
  displacement stays below a fixed pixel bound for a fixed number of
  consecutive frames [ASSUMPTION: bound and frame count fixed in architecture;
  the definition — displacement-based, not feel-based — is fixed here].
- **describe layer** — the post-MVP LLM enrichment stage. In MVP it exists only
  as Contract fields (`description`, `descriptionSource`, both nullable) and a
  pipeline extension point.

## 4. Features

### 4.1 CLI and analysis pipeline

**Description:** The single entry point. `npx gitnebula` analyzes the current
directory; `npx gitnebula <github-url>` shallow-clones to a temp directory
first. The pipeline runs three deterministic stages — file scan, import
parsing, git history — reporting staged progress in the terminal, writes the
Contract, then serves the Viewer locally and opens the browser. Realizes UJ-1.

#### FR-1: Zero-config launch

A user can run `npx gitnebula` in any git repository and reach a working map
with no configuration, no API key, and no network access.

**Consequences (testable):**
- Exit code 0 and a served map on a freshly cloned demo repo (fastapi,
  excalidraw, streamlit) with no flags and no `.gitnebula.yml`.
- With network disabled, local-path analysis completes and the map loads
  (offline run is part of CI or the human-review checklist).
- Total time from invocation to browser-ready map ≤ 60 s on a 500–2,000-file
  repo on reference hardware [ASSUMPTION: reference hardware = the maintainer's
  laptop, recorded with the measurement in the DoD checklist; the same machine
  anchors FR-14's 60 fps human target]. [NOTE FOR PM: the maintainer's laptop
  is an unvalidated proxy for "average user hardware" — acceptable for MVP,
  revisit if users report slower results.]

#### FR-2: URL analysis

A user can run `npx gitnebula <github-url>` to analyze a remote repository via
shallow clone into a temp directory.

**Consequences (testable):**
- A `--depth`-limited clone is used; clone depth covers at least the analysis
  window of history [ASSUMPTION: `git clone --shallow-since=<window start>`,
  falling back to full clone if the server refuses].
- The temp directory is removed on process exit (success or failure).
- Network is used for the clone only; every later stage is identical to the
  local path.

#### FR-3: Staged terminal progress

A user watching the terminal can tell which stage is running (scan, deps, git
history, serve) and see per-stage completion.

**Consequences (testable):**
- Each stage emits a start line and an end line with elapsed time.
- A stage failure names the stage, the cause, and a suggested remedy (e.g.
  `deps: cannot read tsconfig.json — check "extends" path`), and exits
  non-zero.

#### FR-4: Configuration file

A user can create `.gitnebula.yml` in the repo root to override: excluded
paths, analysis window, layer rules, hot-spot threshold, LLM backend (post-MVP
field, parsed and ignored in MVP with a notice).

**Consequences (testable):**
- Exclusion globs remove matching files from every stage (scan, deps, history).
- Default excludes ship without config: at minimum `node_modules`, `.venv`,
  `venv`, `dist`, `build`, `.git`, lockfiles, minified/bundled artifacts
  (`*.min.js`, `*.map`), binary assets, and this project's own tooling dirs
  (`_bmad`, `.claude`) [ASSUMPTION: full default list fixed in architecture].
- An invalid config fails fast with the offending key and line.

#### FR-5: Local server

The CLI serves the Viewer over a local HTTP server bound to the loopback
interface only, and opens the default browser.

**Consequences (testable):**
- The server listens on `127.0.0.1` (never `0.0.0.0`).
- Port is auto-selected if the default is taken; the chosen URL is printed.
- `Ctrl+C` shuts down cleanly.

### 4.2 The Contract (`analysis.json`)

**Description:** The heart of the system and its only inter-module interface.
Produced by the pipeline, consumed by the Viewer, validated against a JSON
Schema. Built first so the Viewer can be developed against fixtures. Brief §7's
draft is the starting shape; the fields below are the deltas this PRD fixes.

#### FR-6: Versioned, validatable Contract

The pipeline emits a single `analysis.json` conforming to a published JSON
Schema with a `schemaVersion` field; breaking changes require a version bump.

**Consequences (testable):**
- Schema validation of pipeline output passes in CI for the fixture repo and
  the demo repos.
- The Viewer refuses (with a clear error screen) a file whose major
  `schemaVersion` it does not support.
- Fixture `analysis.json` files (hand-authored, covering edge cases: empty
  graph, single module, cyclic imports, module with no files, zero-history
  repo, 100-module/2,000-file synthetic) live in the repo and validate.

#### FR-7: Contract content

`analysis.json` carries: repo metadata and stats (name, remote URL, analyzed-at
timestamp, default branch, `analysisWindowDays`, file/LOC/commit counts,
language shares); Nodes with `id`, `kind`, `parent`, `path`, `layer`, `loc`,
`churn`, `commits`, `authors`, `lastChangedAt`, `description: null`,
`descriptionSource: null`;
Import edges (both levels, `source`, `target`, `kind: "import"`, `weight`);
bounded Co-change pairs (file-file and module-module).

**Consequences (testable):**
- Membership is expressed only via `parent` — no membership edges exist.
- Determinism: two runs on the same repo state, config, and analysis window
  produce byte-identical output except `analyzedAt` (stable ordering of nodes,
  edges, cochanges).
- Co-change lists are bounded: pairs with `count ≥ 3` only, top 500 per kind
  [ASSUMPTION: bounds validated against demo repos in architecture; the intent
  — `analysis.json` for a 2,000-file repo stays ≤ 5 MB — is the requirement,
  the numbers are tunable].

#### FR-8: describe extension point

The pipeline exposes a post-analysis enrichment hook: a stage that receives a
completed `analysis.json` and may return an enriched one.

**Consequences (testable):**
- In MVP the hook is a no-op; with no LLM configuration the pipeline emits no
  warnings and nothing degrades (product principle 3).
- `description`/`descriptionSource` are present and `null` on every Node; the
  schema marks them nullable, not optional.

**Out of Scope:** any LLM backend implementation ([NON-GOAL for MVP], first
post-MVP item).

### 4.3 Analyzers

**Description:** Three independent producers feeding the Contract: scanner
(tree, LOC, language, Layer), deps (import parsing → edges), githist (churn,
authors, co-change). Each is testable in isolation; unit tests plus snapshot
tests against a purpose-built fixture repo committed inside the project.

#### FR-9: Scan and classify

The scanner walks the tree (respecting excludes), counts LOC per File,
detects language shares, derives Modules, and assigns each Node a Layer.

**Consequences (testable):**
- Module derivation: top-level directories; when a single directory holds
  > 80% of analyzable files (the `src/` pattern), descend one level; maximum
  descent 2 [ASSUMPTION: thresholds refined in architecture against the demo
  repos].
- Layer assignment uses an ordered rule table over path segments and
  extensions; `.gitnebula.yml` `layers:` (glob → layer) overrides it; the demo
  repos produce visually sensible layer maps (human-review checklist item).
- Unknown-language files are counted (LOC, history) and layered `other`.

#### FR-10: Git history metrics

githist computes per-Node: `commits` (commits in the Analysis window touching
the Node), `churn` (normalized: `min(1, commits / P95(commits over same-kind
Nodes with ≥ 1 commit))`), `authors` (distinct), `lastChangedAt` (most
recent), and Co-change pairs. Module metrics are computed directly (a commit
touching ≥ 2 files of one module counts once), never by summing file metrics.

**Consequences (testable):**
- Uses local `git` invocations only; no GitHub API.
- Unit-tested against a fixture repo with known history (crafted commits).
- A repo with zero commits in the window produces `churn: 0` everywhere and a
  functioning map (no NaN, no division by zero).
- Renames are followed [ASSUMPTION: `git log --follow` for files where
  feasible; exact rename handling fixed in architecture].

#### FR-11: Import parsing

deps parses Python and JS/TS import/require statements and resolves them to
repo-relative Files, emitting file-level Import edges; module-level edges are
aggregated from them.

**Consequences (testable):**
- TS/JS: resolves relative imports, `tsconfig.json` path aliases, `index.*`
  and re-export chains; external packages (node_modules) are ignored as edge
  targets.
- Python: resolves absolute and relative intra-repo imports; site-packages
  ignored.
- Unresolvable imports are dropped and counted (a summary line reports the
  drop rate; > 20% unresolved on a demo repo is a test failure).
- Parse errors in individual files never abort the stage.

### 4.4 The nebula map

**Description:** The first thing the user sees, and the product's "wow"
surface. Dark canvas, stars, glowing nodes, curved translucent edges. Nodes
appear and settle live — the simulation is deliberately visible — then the
camera fits the graph. Palette, glow, and constants come from
`reference/mockup.html`. Realizes UJ-1, UJ-3.

#### FR-12: First render and settling

On load, the Viewer starts at Module level, runs a visible force simulation
that settles in 2–3 s, then smoothly fits the camera to the whole graph.

**Consequences (testable):**
- The simulation reaches Settled (Glossary definition — displacement-based)
  within 2–3 s on the 100-module fixture, measured from first render.
- Camera fit animation completes ≤ 800 ms after Settled.
- With `prefers-reduced-motion`, settling is skipped (layout appears settled)
  — parity with the mockup's behaviour.
- A "replay" control re-runs the settling animation.

#### FR-13: Visual encoding

Node size ∝ LOC, colour = Layer (Structure mode), glow intensity ∝ Churn; hot
spots pulse. Edges are thin, semi-transparent, curved, directed.

**Consequences (testable):**
- Palette matches the mockup's CSS custom properties exactly (`--backend
  #3fcfa0`, `--frontend #9b8cff`, `--infra #7c8598`, `--test #a8cf52`, `--hot
  #ff7a3d`, background `#060911`).
- In Structure mode, a Hot spot renders in `--hot` *instead of* its Layer
  colour (mockup `nodeColor` behaviour), and the legend carries a hot-spot
  entry alongside the four Layers.
- Hot-spot pulse disabled under `prefers-reduced-motion`.
- A starfield background (faint stars behind the graph, per mockup
  `seedStars`) is present — part of the nebula aesthetic, not optional chrome.
- A stats bar (repo name, files, LOC, module count, commits, language shares)
  and the colour legend are visible; module count is derived from Nodes by the
  Viewer (no Contract change).
- A controls hint overlay (bottom corner, per mockup) names pan/zoom, the
  unfold threshold, hover, and click — the only in-UI discovery of semantic
  zoom.

#### FR-14: 60 fps interaction budget

Pan and zoom sustain 60 fps at 100 Modules / 2,000 Files on the reference
hardware (FR-1's assumption).

**Consequences (testable):**
- An automated performance harness (headless or scripted browser) over the
  100-module/2,000-file synthetic fixture reports ≥ 55 fps sustained during a
  scripted pan+zoom sequence [ASSUMPTION: 55 as the automated floor to absorb
  CI noise; 60 remains the target on real hardware].
- Rendering is decoupled from data such that the render engine can be swapped
  (cosmos.gl path) without Contract or Viewer-logic changes — verified by an
  architecture-level interface, not a runtime test.

### 4.5 Navigation

**Description:** Map-app physics: drag to pan, scroll to zoom toward the
cursor. Two-level semantic zoom. Hover lights up the dependency chain. Search
flies the camera. Realizes UJ-1.

#### FR-15: Pan and zoom

A user can drag to pan and scroll to zoom, with zoom centred on the cursor and
clamped to a sane range.

**Consequences (testable):**
- Zoom clamps at [0.4, 6.0]× (mockup constants).
- Zooming at a fixed cursor point keeps the world point under the cursor
  stationary (map-application behaviour).

#### FR-16: Semantic zoom (two levels)

Past a zoom threshold, Modules intersecting the viewport unfold into their
Files; zooming back out collapses them. Off-viewport Modules stay collapsed
(deliberate deviation from the mockup, which unfolds everything — the
user-visible behaviour is identical, the simulation cost is not).

**Consequences (testable):**
- Unfold threshold = 1.8× (mockup `UNFOLD_ZOOM`).
- Only Modules intersecting the viewport (plus a margin) contribute Files to
  the simulation; panning a collapsed Module into view at ≥ 1.8× unfolds it.
- File labels appear from 3.0× (mockup behaviour).

#### FR-17: Hover highlight

Hovering a Node highlights its Dependency chain and dims everything else; a
tooltip shows name and churn.

**Consequences (testable):**
- Non-chain elements render at ≤ 0.2 of full opacity (brief's "~20%"; mockup
  uses 0.1 for nodes, 0.03 for edges — both comply).
- Chain edges brighten (mockup: 0.62 alpha vs 0.2 base).
- Tooltip shows name + churn only — a deliberate reduction of the brief's
  "name and metrics"; full metrics live in the panel (FR-19).
- Tooltip follows the cursor and never overflows the viewport.

#### FR-18: Search

A persistent search box (with a visible `⌘K` hint) sits on the map;
`Cmd/Ctrl+K` (and `/`) focuses it. Fuzzy search over Node names; selecting a
result flies the camera to the Node and pulses it.

**Consequences (testable):**
- The search input is always visible on the map (mockup top-left), not
  shortcut-only.
- Fuzzy match (subsequence or better), top 7 results, keyboard navigable
  (arrows + Enter, Esc closes).
- Fly-to animation 620 ms ± 50 ms with ease-out (mockup constant), arriving at
  2.0× zoom for a Module, 3.0× for a File (≥ unfold threshold, so the target
  is unfolded and labelled); then the detail panel opens.
- Under `prefers-reduced-motion` the fly-to jumps without animation (mockup
  parity).
- Searching a File inside a collapsed Module unfolds that Module on arrival.

### 4.6 Detail panel

**Description:** Click a Node → a panel with identity, metrics, and actions.
Designed so a `description` can be added post-MVP without rebuilding the panel.
Realizes UJ-1, UJ-3.

#### FR-19: Panel content

The panel shows: name, path, kind + Layer; metrics — files (Modules only),
LOC, churn %, authors, last change (relative time), top 3 co-changing Modules
with counts; a hot-spot badge when the Node is a Hot spot (configured
threshold, default 0.5); a churn bar.

**Consequences (testable):**
- `description` is not rendered in MVP (no placeholder, no "enable AI" hint) —
  but the panel component accepts an optional description field (prop/slot)
  today.
- Top co-changing Modules come from the Contract's module-level Co-change
  pairs; the Viewer only sorts and takes 3.
- While the panel is open, the selected Node carries a visible selection ring
  (mockup: light stroke at radius + 5).

#### FR-20: Panel actions

From the panel a user can (a) open the Node on GitHub when `remoteUrl` points
at GitHub, (b) isolate the Node — show only its Dependency chain.

**Consequences (testable):**
- GitHub links target the default branch and the Node's path; the button is
  absent for non-GitHub remotes.
- Isolate dims all non-chain elements to the hover-dim level and persists
  until toggled off or the panel closes.
- Clicking empty canvas closes the panel and clears selection and isolate
  (mockup behaviour) — the panel's × is not the only exit.
- A completed drag is not a click: pans never trigger selection.

### 4.7 View modes

#### FR-21: Structure and Heatmap modes

A user can switch between Structure mode (colour = Layer) and Heatmap mode
(colour = Churn, cold → hot).

**Consequences (testable):**
- Heatmap colour scale interpolates cold (blue) → hot (orange/red) over
  `churn` (mockup's formula is the reference).
- Mode state is reflected in the UI (pressed state) and survives
  unfold/collapse.

### 4.8 Export and publishing

**Description:** Two paths out: a PNG of the current view, and a static Bundle
for GitHub Pages. The project's own README uses both (map of itself). Realizes
UJ-2, UJ-3.

#### FR-22: PNG export

A user can export the current view as a high-resolution PNG.

**Consequences (testable):**
- Export renders at ≥ 2× the canvas CSS resolution.
- The exported image matches the current camera, mode, and highlight state.

#### FR-23: Static bundle (`gitnebula build`)

`gitnebula build` writes a directory: Viewer assets (self-contained HTML/JS/
CSS, system font stack, no external requests) plus `analysis.json` as a
separate file.

**Consequences (testable):**
- Opening the bundle from a static server shows the full working map
  (`file://` support not required [ASSUMPTION: fetch of analysis.json breaks
  on file:// in some browsers; GitHub Pages is the target]).
- Viewer assets ≤ 2 MB gzipped, excluding `analysis.json`.
- The bundle makes zero network requests beyond its own files (verifiable via
  the network log).
- `analysis.json` is a sibling file, so CI can refresh data without
  rebuilding the Viewer.

#### FR-24: CI recipe

The docs include a ready-made GitHub Actions workflow that regenerates the
Bundle on push and publishes it to GitHub Pages.

**Consequences (testable):**
- The workflow runs green on this repository itself (dogfooding: the README's
  map-of-itself is produced by it).

### 4.9 Repo quality (launch readiness)

**Description:** The brief (§2, §10.6) elevates repo quality to a product
requirement: this project is a portfolio piece, and its own repository is part
of the product surface. These deliverables belong to the MVP, not to a
"later polish" phase.

#### FR-25: Launch-ready repository

The public repository ships with: a README containing a 30-second demo
(GIF/video, recorded with an external tool — the in-tool recorder is a
non-goal) and the live map-of-itself link; a MIT `LICENSE` file;
`CONTRIBUTING.md`; CI running the full test suite on every push/PR.

**Consequences (testable):**
- `LICENSE` (MIT) and `CONTRIBUTING.md` exist at the repo root.
- The README embeds the demo asset and the map link; both render on GitHub.
- CI is green on `master` at release, and the badge is in the README.

## 5. Non-Goals (Explicit)

- **No hosted service, no SaaS, no telemetry.** Local tool, full stop.
- **No LLM calls in MVP** — the describe layer is contract fields + a no-op
  hook.
- **No coupling view mode** (edges from co-change) — v2; the data is already
  collected.
- **No time machine** (history slider) — v2.
- **No languages beyond Python and JS/TS**, no multi-root monorepos, no third
  zoom level.
- **No in-tool GIF recording** — docs point at external recorders.
- **No GitHub API usage** — git history comes from local `git` only.
- **No accounts, keys, or cloud config of any kind.**

## 6. MVP Scope

### 6.1 In Scope

Everything in §4: CLI (local + URL), three analyzers, Contract + schema +
fixtures, Viewer (nebula render, navigation, semantic zoom, hover, search,
panel, two modes), PNG export, static bundle, Actions recipe, `.gitnebula.yml`
(excludes, window, layers, hot-spot threshold), describe extension point
(no-op), launch-ready repository (FR-25).

### 6.2 Out of Scope for MVP

- describe layer implementation (Claude Code headless / BYOK / Ollama) —
  first post-MVP item; the Contract and pipeline hook ship ready for it.
- Coupling mode, time machine, additional languages, cosmos.gl renderer swap —
  v2+, in the brief's §12 order.
- `gn` binary alias — collides with Google's GN build tool on PATH; revisit
  post-MVP with a collision check.

## 7. Success Metrics

*FRs without an SM (search, panel, modes, PNG export) are validated by their
own testable consequences; SMs validate the product thesis, not every
capability.*

**Primary**

- **SM-1**: Time-to-map — `npx gitnebula` on each demo repo (fastapi,
  excalidraw, streamlit) completes to a working map in ≤ 60 s, crash-free,
  with a visually sensible result (the latter a human-review checklist item —
  brief DoD 7). Validates FR-1, FR-9–11.
- **SM-2**: Interaction smoothness — ≥ 55 fps automated floor (60 target) on
  the 2,000-file fixture during scripted pan/zoom. Validates FR-14–16.
- **SM-3**: Offline integrity — full local flow with networking disabled; the
  bundle makes zero external requests. Validates FR-1, FR-23.
- **SM-4**: Contract stability — pipeline output validates against the schema
  on all demo repos; Viewer runs on fixtures alone. Validates FR-6, FR-7.

**Secondary**

- **SM-5**: Dogfooding — the repo's README shows a current map of gitnebula
  produced by the Actions workflow. Validates FR-23, FR-24.
- **SM-6**: Visual fidelity — palette and interaction constants match the
  mockup (automated where checkable: colour values, thresholds, durations;
  rest in the human-review checklist). Validates FR-12, FR-13, FR-17.
- **SM-7**: Launch readiness — LICENSE, CONTRIBUTING.md, green CI, README
  demo GIF/video all present at release. Validates FR-25.

**Counter-metrics (do not optimize)**

- **SM-C1**: Analysis speed at the cost of edge correctness — the unresolved-
  import rate (FR-11) must not rise to buy SM-1.
- **SM-C2**: Frame rate at the cost of the aesthetic — glow, curves, and
  settling animation are requirements; stripping them to hit SM-2 fails SM-6.
- **SM-C3**: Bundle size at the cost of visual quality — 2 MB is a budget, not
  a race; the nebula look wins over further shrinking.

## 8. Open Questions

1. Exact default-exclude list and layer rule table (architecture, with demo
   repos as the test bed) — FR-4, FR-9.
2. Module descent heuristic thresholds (80% / depth 2) — validate against
   demo repos (architecture) — FR-9.
3. Co-change bounds (count ≥ 3, top 500) vs the ≤ 5 MB Contract budget —
   validate on excalidraw/streamlit (architecture) — FR-7.
4. Performance spike: d3-force with Barnes-Hut + viewport-scoped unfold on
   the 2,000-file fixture — confirms FR-14/FR-16 feasibility before viz
   stories are frozen (architecture, spike story in Epic 1 or 2).
5. Rename handling depth in githist (`--follow` cost on large repos) — FR-10.
6. Whether the force layout should be seeded (deterministic layout per repo
   state) — nice for README diffs, not required by the brief (architecture).

## 9. Assumptions Index

- §3 Glossary — "Settled" constants (pixel bound, frame count) fixed in
  architecture; the displacement-based definition is fixed here.
- §4.1 FR-1 — reference hardware for the 60 s budget *and* FR-14's 60 fps
  human target = maintainer's laptop, recorded alongside the measurements.
- §4.1 FR-2 — shallow clone via `--shallow-since=<window>`, full-clone
  fallback.
- §4.1 FR-4 — full default-exclude list fixed in architecture.
- §4.2 FR-7 — co-change bounds tunable; the ≤ 5 MB budget is the requirement.
- §4.3 FR-9 — module descent thresholds (80%, depth 2) refined in
  architecture.
- §4.3 FR-10 — rename handling via `git log --follow` where feasible.
- §4.4 FR-14 — 55 fps automated floor vs 60 fps human target.
- §4.8 FR-23 — `file://` opening unsupported; static server assumed.
