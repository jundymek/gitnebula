# gitnebula — Project Brief

> Name: `gitnebula` (npm package, `gitnebula` binary, `.gitnebula.yml` config). The name is fixed — do not propose alternatives. A short binary alias (`gn`) is worth considering during the architecture phase.

> Input document for the planning phase (BMAD: Analyst → PM → Architect). It describes WHAT I want to build and WHY, with open decisions explicitly flagged. Do not design implementation beyond the stated constraints — architectural detail should come out of the planning phase. Section 13 contains mandatory requirements about the FORMAT of the plan (multi-agent execution) — read it before generating the PRD.

## 1. One sentence

A CLI that turns any repository into a beautiful, interactive architecture map in under a minute — a graph of modules and files rendered like a "nebula" (dark mode, WebGL/canvas, animated force layout), enriched with git history signals (hot spots, churn). Fully deterministic and offline; an optional LLM description layer is the first step on the post-MVP roadmap.

## 2. Motivation and problem

- Onboarding into an unfamiliar codebase is slow: the README describes "what", not "where and how" — the structure has to be reconstructed in your head, file by file.
- Existing tools are either static and ugly (SVG with no interaction), or map all of GitHub instead of a single repo, or show file structure with no semantics and no change history.
- The niche: an interactive map of ONE repo + git history signals (hot spots, coupling) + zero barrier to entry (no account, no key, no code leaving the machine). The LLM semantic layer comes after MVP.

The project is open source (public repo, MIT license) and serves as a portfolio piece — visual quality and repo quality (README, demo, CI) are product requirements, not decoration.

### 2.1 Landscape and positioning

The category is crowded. Below are the closest neighbours and how gitnebula is meant to differ. Do not copy their scope; the difference is deliberate.

- **DeepWiki (Cognition)** — hosted SaaS: turns a repo URL into a wiki with architecture diagrams and an AI assistant. The output is a document, not a map; no git history signals; code goes to an external service.
- **GitGalaxy (gitgalaxy.io)** — the closest visually: maps repos onto star-based dashboards and agent-oriented summaries. Oriented toward "risk exposure" metrics and auditing, with a commercial model (posters/renders). Different goal: risk assessment, not dependency navigation.
- **GitDiagram** — open source, generates a clickable architecture diagram via LLM. Static diagram, no metrics, no history.
- **CodeScene** — commercial behavioural analysis from git history (hot spots, coupling). Rich analytics, but no interactive map and behind a paywall.
- **anvaka/map-of-github, GitHub Next repo-visualization** — aesthetic references (galaxy, circle packing), but they map all of GitHub or file structure alone, without semantics or change history.

**gitnebula's differentiator (hold this at every scoping decision):** a local CLI with no login and no code leaving the machine + an interactive dependency map built for exploration (not a document, not an audit) + git history signals baked into the visualization + LLM as an optional, swappable layer (post-MVP).

## 3. Target users

1. A developer getting to know a new repo (onboarding, reviewing a large PR, auditing).
2. An open source maintainer who wants a live, always-current map of the project in the README.
3. A tech lead looking for hot spots and hidden coupling as input to refactoring.

## 4. Product principles (non-negotiable)

1. **Zero-config**: `npx gitnebula` in a repo directory must produce a fully useful result with no configuration and no API key.
2. **Local-first**: all static analysis and git analysis runs 100% locally and offline. No data leaves the user's machine unless they explicitly configure an external LLM backend.
3. **AI as an optional layer**: LLM descriptions are an enhancement. The absence of an LLM backend must not degrade anything beyond the content of those descriptions.
4. **Wow is a requirement**: interaction smoothness (target: 60 fps on pan/zoom), the animated layout settling, and a coherent "nebula" aesthetic are acceptance criteria, not nice-to-haves.
5. **No backend**: the result can be exported as a static bundle hostable on GitHub Pages.

## 5. Complete user flow (MVP)

### 5.1 Launch

- `npx gitnebula` in a repository directory — analyses the current repo.
- `npx gitnebula <github-url>` — performs a shallow clone into a temp directory and analyses it.
- Optional `.gitnebula.yml`: excluded paths, analysis depth, LLM backend configuration.

### 5.2 Analysis (terminal)

Staged progress in the terminal:

1. Scanning the file tree (with sensible default excludes: node_modules, .venv, dist, etc.).
2. Parsing imports/dependencies between files (MVP: Python and JavaScript/TypeScript).
3. Git history analysis: churn per file (last 90 days, configurable), author count, last-changed date, co-change frequency of file pairs across commits.

Note: LLM-generated module descriptions (the `describe` layer) are OUT OF MVP SCOPE — see sections 6 and 12. The MVP pipeline is fully deterministic and works offline.

The analysis output: a single `analysis.json` file (the contract — section 7). After analysis the tool starts a local server and opens the browser.

### 5.3 First view

- Dark canvas; nodes appear and settle live over 2–3 s (the force layout simulation is visible to the user), after which the camera smoothly fits the whole graph.
- The starting view is the module level (top-level directories / packages), not files.
- Node: size ∝ LOC, colour = layer (backend / frontend / infra / test — heuristic based on paths and file types), glow intensity ∝ churn.
- Edge: thin, semi-transparent, curved; direction = direction of dependency.
- Repo stats bar (name, files, LOC, commits, languages) + colour legend.

### 5.4 Navigation

- Pan (drag) and zoom (scroll), with map-application physics.
- Semantic zoom, two levels in MVP: modules → files. Past a zoom threshold a module unfolds into its files; zooming out collapses it.
- Hovering a node: highlights the full dependency chain (in + out), dims the rest of the graph to ~20% opacity, tooltip with name and metrics.
- Search (Cmd/Ctrl+K shortcut): fuzzy match on names; selecting a result flies the camera smoothly to the node and pulses it.

### 5.5 Detail panel (node click)

- Name, path, type (module/file).
- Space for a module description: in MVP the `description` field is always `null` and the panel simply does not render it (no "enable AI" placeholders). The UI must nevertheless be designed so a description can be added without rebuilding the panel (the `describe` layer, post-MVP).
- Metrics: files (for a module), LOC, churn %, author count, last change, top 3 co-changing modules.
- "Hot spot" badge above a configurable churn threshold.
- Actions: link to GitHub (if the origin points at GitHub), "show neighbourhood only" (isolates the node and its direct dependencies).

### 5.6 View modes

- **Structure** (default): colour = layer.
- **Change heatmap**: colour = churn (cold → hot).

### 5.7 Export and publishing

- High-resolution PNG export of the current view.
- `gitnebula build` → a static bundle (HTML + JS + analysis.json) for hosting on GitHub Pages.
- A ready-made example GitHub Actions workflow (in docs) that regenerates the bundle on push.
- Meta-trick for launch: the project's README contains a live map of... itself.

## 6. Out of MVP scope (deliberately)

- **The LLM layer (`describe`)** — first item on the post-MVP roadmap (section 12). In MVP: the `description` field exists in the contract as nullable, and no component depends on it being populated. Rationale: all core value (graph, hot spots, coupling, visualization) is deterministic; the LLM is an enhancement, and excluding it from MVP simplifies the pipeline and strengthens the "fully offline" message.
- Coupling mode (edges from commit co-change instead of imports) — v2; the data is already collected in MVP.
- "Time machine" (a slider over history, animated graph evolution) — v2.
- Languages beyond Python and JS/TS; multi-root monorepos; nested zoom levels beyond 2.
- In-tool GIF recording (MVP: instructions in docs, e.g. an external screen recorder).
- A hosted service / SaaS version. This is a local tool.

## 7. Data contract: `analysis.json`

The contract is the heart of the project and MUST be produced as the first implementation artifact (with a JSON Schema and validation tests). All modules communicate exclusively through this file. Draft (to be refined in the architecture phase):

```jsonc
{
  "schemaVersion": "1.0",
  "repo": {
    "name": "",
    "remoteUrl": "",
    "analyzedAt": "",
    "defaultBranch": "",
    "stats": { "files": 0, "loc": 0, "commits": 0, "languages": { "py": 0.6, "ts": 0.4 } },
  },
  "nodes": [
    {
      "id": "core/",
      "kind": "module|file",
      "parent": null,
      "path": "core/",
      "layer": "backend|frontend|infra|test|other",
      "loc": 0,
      "churn90d": 0.0,
      "authors": 0,
      "lastChangedAt": "",
      "description": null,
      "descriptionSource": "llm|null",
    },
  ],
  "edges": [{ "source": "api/", "target": "core/", "kind": "import", "weight": 3 }],
  "cochanges": [{ "a": "core/scoring.py", "b": "tasks/refresh.py", "count": 14 }],
}
```

Requirements for the contract: versioned (`schemaVersion`), validatable, stable (breaking changes = version bump), self-sufficient (the frontend needs nothing but this file).

## 8. Technical constraints and preferences

- **Distribution via `npx` is a product requirement.** Preference: the whole project in TypeScript (monorepo: CLI + analyzers + frontend), to avoid a dual runtime on the user's machine. Import parsing: tree-sitter (node bindings) or comparable. → OPEN QUESTION for the architect: confirm the feasibility of Python analysis in TS (tree-sitter-python) vs. alternatives; if TS-only proves impractical, propose a variant with a separate Python analyzer and justify it.
- **Rendering**: MVP on d3-force + canvas 2D (full aesthetic control at tens–hundreds of nodes). The rendering layer must be decoupled from data such that at thousands of nodes the engine can be swapped for cosmos.gl with no changes elsewhere in the system.
- **The LLM layer (`describe`) — POST-MVP, but the MVP architecture must not block it**: the contract carries a nullable `description` + `descriptionSource`, and the CLI pipeline has an extension point for an enrichment stage over a completed `analysis.json`. Target shape (to implement after MVP): swappable backends behind a common interface — (a) Claude Code in headless mode (`claude -p --output-format json`, spawned as a CLI child process), (b) Anthropic API key (BYOK), (c) Ollama. Backend selected in `.gitnebula.yml`; no configuration = layer disabled, with no errors and no degradation elsewhere. Implementation requirements for `describe`: batching (descriptions for many modules in 1–3 bulk prompts returning JSON, not one call per module), description caching by module content hash (regenerate only what changed), and for the Claude Code backend — restricted permissions (`--allowedTools` limited to reads).
- Git history exclusively through local `git` invocations (no GitHub API in MVP).
- Testing: unit tests for the analyzers and the contract; snapshot tests of the generated `analysis.json` against a purpose-built test repo (fixture inside the project repository).

## 9. Module breakdown (for multi-agent implementation)

Implementation will be carried out by a multi-agent system working in parallel on one repo. The architecture MUST support this split — modules with clean boundaries, communicating through the contract from section 7:

1. **scanner** — file tree, LOC, language and layer detection.
2. **deps** — import parsing (Python, JS/TS) → edges.
3. **githist** — churn, authors, co-change (from `git log`).
4. **describe** _(POST-MVP)_ — the LLM layer (interface + 3 backends), enriches a completed `analysis.json` with `description`. Not built in MVP; we reserve its boundary (pipeline extension point + contract fields).
5. **viz** — frontend: graph renderer, navigation, panel, view modes, PNG export.
6. **cli** — pipeline orchestration, progress, local server, `build`, configuration.

Principle: one module = one owner. Order: contract + fixture `analysis.json` files first, after which viz and the analyzers can proceed in parallel (viz works against fixtures).

## 10. MVP success criteria (definition of done)

1. `npx gitnebula` on a freshly cloned, medium-sized Python/TS repo (~500–2000 files) completes analysis in < 60 s and opens a working map.
2. Pan/zoom is smooth (target 60 fps) at 100 modules / 2000 files on an average laptop.
3. The full flow from section 5 works: animated settling, semantic zoom, hover highlight, search, panel, heatmap, PNG export, `gitnebula build`.
4. Everything works fully offline, with no API key and no configuration.
5. `analysis.json` validates against a schema in which `description`/`descriptionSource` are present (nullable) — readiness for the `describe` layer.
6. Project repo: README with a 30-second demo (GIF/video) and a map of itself (dogfooding), MIT license, CI with tests, CONTRIBUTING.md.
7. Runs on 3 popular public repositories (different structures) without crashing and with a visually sensible result.

## 11. Open questions for the planning phase

1. TS-only vs. a TS+Python hybrid for the analyzers (section 8).
2. Layer assignment heuristics (backend/frontend/infra/test) — default rules and override support in `.gitnebula.yml`.
3. The exact "hot spot" threshold algorithm (churn percentile vs. absolute threshold).
4. The format and limits of `gitnebula build` (whether to bundle fonts/assets, target size).

## 12. Post-MVP roadmap (in order)

1. **describe** — the LLM layer per section 8 (backends: Claude Code headless, BYOK, Ollama; batching, hash-based caching, restricted permissions). Prompt details and granularity (per module vs. per file) to be planned in that phase, not now.
2. Coupling mode (edges from commit co-change).
3. "Time machine" (animated graph evolution over history).
4. Additional languages; swapping the renderer for cosmos.gl on large graphs.

## 13. Operating instructions for the planning phase (IMPORTANT — read before creating the PRD and stories)

### 13.1 Execution context: terminal-agents

Implementation will NOT be carried out by a single sequential dev agent. It will use **terminal-agents** — a custom multi-agent system in which:

- many agents work in parallel on one repository, each on a **separate branch**;
- agents can **communicate with each other** during work (questions, agreements, signalling blockers);
- a supervising agent, **superman**, oversees the whole thing: monitoring progress, resolving conflicts, coordinating merges.

We will work in **supervised mode with superman at stage 2/3**.

System documentation: https://github.com/jundymek/terminal-agents (a private repository you will be granted access to). **Read that documentation before producing the plan** — the plan must be tailored to this execution model, not to sequential work. If you cannot access the repository, say so and ask, rather than guessing how the system behaves.

### 13.2 Requirements for the PRD, epics and stories

1. **An owner on every story.** Every story has an `owner` field naming the lead module from section 9 (scanner / deps / githist / viz / cli; describe is post-MVP) — used for routing the story to an agent, naming the branch, and assigning responsibility for the result. Slice stories so they align WHERE PRACTICAL with module boundaries — not because agents can't handle conflicts (the system supports inter-agent communication and rebasing), but because every shared file adds coordination cost that reduces real parallelism. If a story inherently spans modules, do NOT split it artificially into fragments with no business meaning — instead add a `touches` field (list of modules/paths the story affects beyond its owner module). Superman uses `owner` + `touches` to decide: run in parallel, sequence, or supervise a rebase.
2. **Explicit dependencies.** Every story has a `depends_on` field listing the IDs of stories that must be completed and merged first. Agents use this field to know what is blocking them; superman uses it to sequence merges. Record the absence of dependencies explicitly as `depends_on: []`. Do not add dependencies "just in case" — every unnecessary dependency kills parallelism.
3. **Synchronization points.** Mark explicit integration milestones in the plan (at minimum: M1 = contract + fixtures merged to main; M2 = first full end-to-end pipeline over fixtures; M3 = MVP DoD). After each milestone superman integrates branches and runs the full test suite.
4. **Epic ordering.** Epic 1 = the `analysis.json` contract (JSON Schema, validator, fixture analysis.json files for a test repo). All other epics depend on Epic 1 only, at the interface level. In particular: the viz epic depends ONLY on Epic 1 (it works against fixtures), never on the analyzer epics — this is the precondition for parallel work.
5. **Measurable acceptance criteria.** Unverifiable criteria are forbidden ("looks attractive", "runs smoothly"). Ground aesthetics and UX in numbers and reference artifacts, e.g.: the settling animation lasts 2–3 s; pan/zoom sustains 60 fps at 100 modules / 2000 files; on hover, elements outside the dependency chain dim to ~0.2 opacity; palette and behaviours match `reference/mockup.html` (reference file in the repo). Mark criteria that cannot be verified automatically as human-review items and collect them in a separate checklist.
6. **Story-level definition of done** must include: tests pass locally, branch is current with main, contract validation passes (if the story touches data), and the PR description is understandable to superman without reading the code.
7. **Architectural decisions** from the planning phase are recorded as ADRs in `docs/adr/` (format: context → decision → consequences). Process artifacts (PRD, epics, stories) go to `docs/process/` and are append-only once frozen.

### 13.3 Git workflow and commit history

The project's commit history is part of the portfolio — it must read cleanly to an outside observer. Bake the following into stories, `CONTRIBUTING.md` and agent instructions:

1. **Language: English everywhere in the repo.** Code, comments, branch names, commit messages, PR descriptions, README, ADRs, `docs/process/`, issues. No mixed-language artifacts.
2. **Conventional Commits are mandatory**, with the scope set to a module from section 9: `feat(deps): parse TypeScript imports`, `test(githist): add churn fixtures`, `fix(viz): clamp zoom at module level`. Bonus: the history then shows at a glance which module (and therefore which agent) did what.
3. **Squash merge on PRs.** An agent may accumulate 30 "fix test" commits on its branch; exactly one clean commit per story lands on main. This is the simplest way to keep history readable despite in-progress mess.
4. **Story reference in every commit/PR**: a `Refs: STORY-014` trailer, so history can be traced back to the plan. For a project that is itself about process, this is especially valuable.
5. **Real `git init` from day one.** Do not dump finished code as a single "initial commit". The history must show how the project grew.
6. **Agent attribution in commits.** Every commit produced by an agent carries an `Agent: <name> (terminal-agents)` trailer — e.g. `Agent: viz (terminal-agents)` — identifying the implementing agent. Use this custom trailer rather than `Co-authored-by:` for agent names: `Co-authored-by:` expects a `Name <email>` pair that GitHub tries to map to a real account, so agent names there produce junk attributions. The `Agent:` trailer stays greppable (`git log --grep="Agent: viz"`) and makes per-agent contribution stats derivable straight from history. This must be settled before the first commit; adding trailers retroactively requires rewriting history.
