# Contributing to gitnebula

Thanks for contributing! This document covers the workflow every change —
human- or agent-authored — must follow. The scope source of truth is
[docs/GITNEBULA_PROJECT_BRIEF.md](docs/GITNEBULA_PROJECT_BRIEF.md); process
details live in [CLAUDE.md](CLAUDE.md).

## Getting started

Requirements: Node.js ≥ 20 and pnpm 10 (the exact version is pinned in the
`packageManager` field — with [corepack](https://nodejs.org/api/corepack.html)
enabled, `pnpm` resolves to it automatically).

```bash
pnpm install   # once per clone
pnpm lint      # ESLint 9 (flat config) + Prettier check
pnpm typecheck # tsc --noEmit in every package
pnpm test      # vitest, one suite per package
pnpm build     # tsup (cli) + vite (viz) — the only two build edges
```

`pnpm lint && pnpm test` must both exit 0 before every commit. Run them from
the repository root so the workspace resolves.

## Commit messages: Conventional Commits, scope = module

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
and the **scope is the module** from the workspace
(`contract | scanner | deps | githist | viz | cli`, or `repo` for root-level
changes) — never the story id:

```
feat(deps): parse TypeScript imports

Refs: 2.2-deps-ts-imports
Agent: alice (terminal-agents, claude-opus-5)
```

### Trailers

- `Refs:` — the story id (`<epic>.<n>-<slug>`), identical to the spec
  filename, the branch slug and the sprint-status key. Required on every
  story commit.
- `Agent:` — required on commits authored by a terminal-agents agent:
  `Agent: <name> (terminal-agents, <model-id>)`. Maintainer commits carry no
  `Agent:` trailer. Do **not** use `Co-authored-by:` for agent names — GitHub
  tries to resolve it to a real account and produces junk attributions.

## Pull requests: squash merge

PRs are **squash-merged** — one clean commit per story lands on the base
branch:

- The **PR title becomes the squash commit subject**, so it must itself be a
  valid Conventional Commit (`type(module): subject`).
- **Both trailers (`Refs:`, `Agent:`) must appear in the PR body** — the
  squash body, not the branch commits, is what survives on the base branch.
- The PR description must be understandable without reading the code, and CI
  must be green.

## Determinism

`scanner`, `deps` and `githist` are banned from `Date.now()` and
`Math.random()` by an ESLint rule (AD-4): the same repository at the same
commit must produce a byte-identical `analysis.json`. Timestamps in analysis
output come from git, not from the system clock.

## Package boundaries

Allowed dependency edges (AD-2) are exactly: `cli` → all four Node packages +
`contract`; `scanner`/`deps`/`githist`/`viz` → `contract` only; `contract` →
nothing (and no `node:` imports — it is environment-neutral). Deep imports
(`@gitnebula/contract/src/x`) deliberately do not resolve; if you need
something, export it from the package's `exports` map on purpose.
