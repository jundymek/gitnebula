# Contributing to gitnebula

Thanks for contributing! This document covers the workflow every change —
human- or agent-authored — must follow. The scope source of truth is
[docs/GITNEBULA_PROJECT_BRIEF.md](docs/GITNEBULA_PROJECT_BRIEF.md); process
details live in [CLAUDE.md](CLAUDE.md).

## Getting started

Requirements: Node.js ≥ 20.19 (Vite's floor within the Node 20 line) and
pnpm 10 (the exact version is pinned in the
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

The workspace is six packages under `packages/`, one per module:
`contract` (the `analysis.json` schema and its types), `scanner`, `deps`,
`githist`, `viz` (the browser viewer) and `cli` (the pipeline and the
`gitnebula` binary). Only `cli` and `viz` have a build step; the rest are
consumed from source inside the workspace.

To try a change end to end, run the tool on this repository:

```bash
pnpm build
node packages/cli/dist/bin/gitnebula.js . # writes analysis.json, serves the map
```

The binary lives one directory deeper than you might expect, and the depth is
load-bearing — `packages/cli/tsup.config.ts` explains why.

`pnpm build` runs the two build edges in order, viz then cli, and cli's ends by
copying the built viewer and `tree-sitter-python.wasm` into
`packages/cli/assets/`, where the binary looks for them. Both are gitignored
regenerated artefacts. Until story 4.5 only `npm pack`'s `prepack` produced
them, so a plain `pnpm build` left a binary that could not serve a map at all
and died on the first Python file it met; `src/dev-checkout.test.ts` is what
keeps that from coming back.

## Tests and fixture repositories

Tests are vitest, one suite per package, and they never reach for the network
or for your own checkouts. Anything that needs a git history builds a
**deterministic fixture repository** into the gitignored
`test-fixtures/.generated/` — same commit hashes on every machine (AD-14):

```sh
./test-fixtures/build-fixture-repo.sh      # githist: prints the HEAD hash
./test-fixtures/build-ts-fixture-repo.sh   # deps, TS/JS
./test-fixtures/build-py-fixture-repo.sh   # deps, Python
```

You rarely run these by hand: the root `pretest` hook and the packages that
need them build them on demand, concurrently and safely. Editing a builder
script changes its checksum, which invalidates the stamp and rebuilds the
fixture on the next test run — so **regenerating a fixture means editing its
script, never editing `.generated/`**, and nothing under `.generated/` is ever
committed. If a fixture looks stale, delete `test-fixtures/.generated/` and run
the tests again.

The performance harness (`pnpm --filter @gitnebula/viz perf`) and the demo
recorder (`node scripts/record-demo.mjs`, see
[docs/recording-demo.md](docs/recording-demo.md)) drive the real viewer through
Playwright. Both are dev tooling: nothing they use enters the bundle.

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

## Releasing

Exactly one package reaches npm: `gitnebula`, the one in `packages/cli`
(AD-11). The other five are `private` and are consumed from source inside the
workspace; `packages/cli`'s build inlines the four Node ones into the binary,
so they have no separate existence on the registry.

Publishing is the maintainer's, from a clean checkout of the merged base with
their own npm credentials:

```bash
git switch master && git pull            # a clean tree; nothing uncommitted
pnpm install && pnpm lint && pnpm test   # the suite includes the cold-install e2e
pnpm build                               # the only build entry

npm version 0.1.0 --workspace packages/cli --no-git-tag-version  # or edit by hand
cd packages/cli && npm publish --dry-run # read the file list before the real one
npm publish                              # add --otp=<code> if 2FA is on
cd ../.. && git commit -am "chore(cli): release v0.1.0"
git tag v0.1.0 && git push && git push --tags
```

The tag is `v<version>` and names the CLI's version, not the contract's.
**The two move independently** (AD-11): `schemaVersion` in `analysis.json` is
the data contract's own version and changes only when the contract does, which
is a deliberate, versioned act with its own story and an ADR (see
`docs/adr/`). A CLI release that changes no contract field leaves
`schemaVersion` exactly where it was, and a `schemaVersion` bump does not
imply a major CLI release.

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
