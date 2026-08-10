# CLAUDE.md

Operational guide for any session or agent working in this repository. Read this
first, then read `docs/GITNEBULA_PROJECT_BRIEF.md` for scope.

## Project

gitnebula is a CLI that turns any git repository into an interactive architecture
map: a graph of modules and files rendered as a "nebula" on a dark canvas with an
animated force layout, enriched with git history signals (churn, hot spots,
co-change). The pipeline is fully deterministic and runs offline. It produces a
single `analysis.json` file, which the frontend consumes on its own — no backend,
no account, no code leaving the machine. The project is open source (MIT) and
doubles as a portfolio piece: visual quality, repo quality and commit history are
product requirements, not decoration.

**Scope source of truth: [docs/GITNEBULA_PROJECT_BRIEF.md](docs/GITNEBULA_PROJECT_BRIEF.md).**
Where this file and the brief disagree on scope, the brief wins. Where a story
spec and this file disagree, the spec wins — and flag the divergence.

### Non-negotiable product principles

1. **Zero-config** — `npx gitnebula` in a repo directory produces a fully useful
   result with no configuration and no API key.
2. **Local-first** — all static and git analysis runs 100% locally and offline.
   No data leaves the machine unless the user explicitly configures an external
   LLM backend.
3. **AI is an optional layer** — the absence of an LLM backend must not degrade
   anything beyond the content of the descriptions themselves.
4. **Wow is a requirement** — interaction smoothness (60 fps target), the
   animated settling and a coherent nebula aesthetic are acceptance criteria.
5. **No backend** — the result exports as a static bundle hostable on GitHub Pages.

## Language protocol

- **Conversation with the maintainer: Polish.**
- **Everything in the repository: English, without exception.** Code, comments,
  file and directory names, branch names, commit messages, PR titles and bodies,
  README, ADRs, everything under `docs/`, issues. Never mix languages inside a
  single repo artifact. A Polish instruction that is destined to become repo
  content gets translated, not committed verbatim.

## Repo layout

- `docs/GITNEBULA_PROJECT_BRIEF.md` — the brief. Scope source of truth.
- `docs/planning-artifacts/` — PRD, architecture, epics.
- `docs/implementation-artifacts/` — story specs and sprint status. This is the
  `TASK_SOURCE_DIR` terminal-agents reads; a story file must be committed and
  pushed to `origin/master` before its agent can be launched.
- Both artifact directories are **append-only once frozen**: a frozen artifact is
  never edited in place; changes land as a new versioned file.
- `docs/adr/` — architectural decision records, format: context → decision →
  consequences. Every resolved open question gets one.
- `_bmad/` and `.claude/skills/` — the BMAD v6 installation used for the planning
  phase, committed deliberately so the process is reproducible. Not project
  source; excluded from the map gitnebula draws of itself.
- `reference/mockup.html` — the visual reference for the `viz` module. It defines
  palette, interaction behaviour and named constants (`HOT_THRESHOLD = 0.5`,
  `UNFOLD_ZOOM = 1.8`, dim opacity, settle duration). **It is not an
  implementation base**: its data is hardcoded and its simulation is O(n²).
  Read it for behaviour, never copy its architecture.
- Source layout is decided in the architecture phase and documented here once
  settled.

## Data contract

`analysis.json` is the single interface between all modules. It is built first
(Epic 1) and everything else depends on it at the interface level only.

- Versioned via `schemaVersion`; a breaking change is a deliberate, versioned act.
- Validatable against a JSON Schema, with tests.
- Self-sufficient: the frontend needs nothing but this file.
- Ships with fixture `analysis.json` files so `viz` can be built against the
  contract, not against the analyzers.

Changing the contract is never a side effect of another story. It requires its
own story, a schema version decision, and an ADR if the change is structural.

## Modules

One module = one owner. From section 9 of the brief:

| module     | responsibility                                                  |
| ---------- | --------------------------------------------------------------- |
| `scanner`  | file tree, LOC, language and layer detection                     |
| `deps`     | import parsing (Python, JS/TS) → edges                           |
| `githist`  | churn, authors, co-change from `git log`                         |
| `viz`      | frontend: renderer, navigation, panel, view modes, PNG export    |
| `cli`      | pipeline orchestration, progress, local server, `build`, config  |
| `describe` | POST-MVP: the LLM layer. Boundary reserved, not implemented.     |

`viz` depends on the contract and the fixtures — never on the analyzer modules.
That is the precondition for parallel work; do not introduce such a dependency.

## Git workflow

Base branch is `master`. The commit history is part of the portfolio and must
read cleanly to an outside observer.

**Conventional Commits are mandatory, scope = module** from the table above:

```
feat(deps): parse TypeScript imports
test(githist): add churn fixtures
fix(viz): clamp zoom at module level
```

**Trailers.** Every commit and PR body carries:

```
Refs: 1.1-contract-json-schema
Agent: alice (terminal-agents, claude-opus-5)
```

- `Refs:` — the story id, dot-separated `<epic>.<n>-<slug>` form. This is the
  same string used as the task id, the branch name and the spec filename.
- `Agent:` — only on commits authored by a terminal-agents agent. `<name>` is the
  real agent name from the pool (`alice`, `bob`, `pamela`, `arnold`, `rambo`,
  `chuck`, `superman`), and `<model-id>` is the model that actually did the work
  (e.g. `claude-opus-5`). Commits written by the maintainer carry no `Agent:`
  trailer.
- This deliberately overrides the terminal-agents default rule banning AI
  attribution footers. `Co-authored-by:` is **not** used for agent names: it
  expects a `Name <email>` pair that GitHub tries to map to a real account and
  produces junk attributions. `Agent:` stays greppable
  (`git log --grep="Agent: alice"`) and makes per-agent stats derivable from
  history.
- Note the two axes are independent: the **module** lives in the commit scope,
  the **agent** in the trailer. Agent names are assigned positionally per launch,
  so an agent name does not identify a module.

**Both trailers must also appear in the PR body.** PRs are squash-merged, and the
squash body — not the branch commits — is what lands on `master`. Trailers that
exist only in branch commits are discarded on merge.

**Squash merge on PRs.** One clean commit per story lands on the base branch. The
PR title becomes that commit's subject, so the PR title must itself be a valid
Conventional Commit. The epic → `master` integration merge is a merge commit, not
a squash.

**Real history from day one.** No bulk "initial commit" dumps. Each planning
artifact is committed separately as it is produced. Trailer conventions are fixed
before the first agent commit — adding them retroactively means rewriting history.

## Planning toolchain

The planning phase runs on [BMAD](https://github.com/bmad-code-org/BMAD-METHOD)
v6.10.0 (`bmm` module), installed into this repo so the process is reproducible
by anyone who clones it. Configuration lives in `_bmad/config.toml`; personal
settings (`config.user.toml`) are gitignored. Artifact paths are already wired to
`docs/planning-artifacts` and `docs/implementation-artifacts`.

BMAD's defaults do not satisfy this project on their own. Story specs must carry
the section 13 metadata (`owner`, `touches`, `depends_on`) and the fields the
terminal-agents gates check — see below. Where a BMAD template and this file
disagree, this file wins.

## Multi-agent execution

Implementation is carried out by [terminal-agents](https://github.com/jundymek/terminal-agents):
many agents in parallel on one repo, each in its own git worktree and branch,
able to message each other, overseen by a `superman` supervisor. We run in
**supervised mode, supervisor stage 2**.

What this imposes on planning artifacts:

- Stories carry `owner` (lead module), `touches` (modules/paths affected beyond
  the owner module) and `depends_on` (story ids that must be merged first; record
  the absence explicitly as `[]`). These fields are for humans and the supervisor
  — **the harness does not parse them.** Every dependency must ALSO be stated in
  prose in the spec, or the agent will never configure it.
- **At most one blocking predecessor per story.** The harness stores a single
  `waiting_for` marker and successive calls overwrite it rather than accumulate.
- **Story ids are dot-separated**, `<epic>.<n>-<slug>`. The epic number is derived
  from the digits before the first dot; a dash-separated id breaks supervised mode.
- **One launch = one epic.** The launcher refuses a cohort spanning two epics.
- Max 6 agents in the name pool, practically 5. Cohorts are sized accordingly.
- Specs must be committed and pushed to `origin/master` before launch — the
  launcher creates worktrees from origin and refuses otherwise.
- **No agent merges anything**, including `superman`. Merges are the maintainer's
  click. Integration milestones are human checkpoints, not automated ones.
- Story specs must contain what the harness gates check: numbered `AC-1`/`AC-2`
  acceptance criteria, a `## Tasks / Subtasks` checkbox list, an empty-but-present
  `## Dev Agent Record` section, the exact test command to run, and the docs
  artifacts the pre-PR gate looks for.

## Acceptance criteria

Unverifiable criteria are forbidden — no "looks attractive", no "runs smoothly".
Ground aesthetics and UX in numbers and reference artifacts: the settling
animation lasts 2–3 s; pan/zoom sustains 60 fps at 100 modules / 2000 files; on
hover, elements outside the dependency chain dim to ~0.2 opacity; palette and
behaviours match `reference/mockup.html`. Criteria that cannot be verified
automatically are marked as human-review items and collected in a separate
checklist.

Story-level definition of done: tests pass locally, branch is current with its
base, contract validation passes if the story touches data, and the PR
description is understandable without reading the code.

## What not to do

- **Do not widen MVP scope.** Section 6 of the brief is deliberate.
- **Do not add a backend or a hosted service.** This is a local tool.
- **Do not implement the `describe`/LLM layer in MVP.** Reserve its boundary
  (nullable contract fields, a pipeline extension point) and stop there.
- **Do not treat `reference/mockup.html` as code to build on.**
- **Do not rewrite frozen artifacts** in `docs/planning-artifacts/` or
  `docs/implementation-artifacts/`.
- **Do not add features, files, dependencies or abstractions no story asks for.**
- **Do not introduce a dependency from `viz` to the analyzer modules.**
