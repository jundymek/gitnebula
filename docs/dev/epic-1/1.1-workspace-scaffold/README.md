# 1.1-workspace-scaffold — what the scaffold provides

This story created the pnpm workspace every later story builds on. On a fresh
clone (Node ≥ 20.19 — Vite 8's floor within the Node 20 line — and pnpm 10 via
corepack):

```bash
pnpm install
pnpm lint       # ESLint 9 flat config + Prettier check
pnpm typecheck  # tsc --noEmit in every package
pnpm test       # vitest — one trivial suite per package
pnpm build      # tsup (cli) + vite (viz) — the only two build edges (AD-11)
```

## What exists now

- **Six packages** under `packages/`: `@gitnebula/{contract,scanner,deps,githist,viz,cli}`.
  All pure ESM (`"type": "module"`), NodeNext resolution, source-only internals
  (`exports` maps point at `./src/index.ts`; no build step for
  contract/scanner/deps/githist).
- **Narrow `exports` maps** — deep imports like `@gitnebula/contract/src/x`
  fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. If you need a symbol, export it
  from the package's `src/index.ts` deliberately.
- **AD-2 dependency edges, physically declared**: `cli` depends on
  contract + scanner + deps + githist; the four spokes depend on `contract`
  only; `contract` depends on nothing and must stay free of `node:` imports.
- **AD-4 determinism lint**: `Date.now()` / `Math.random()` are lint errors
  inside `packages/{scanner,deps,githist}` (rule: `no-restricted-properties`
  in `eslint.config.js`). viz and cli are exempt.
- **tsconfig layout**: shared `tsconfig.base.json` (strict, NodeNext, noEmit);
  `viz` compiles against DOM lib with no `node:` types; `contract` has neither
  DOM nor node types (environment-neutral); scanner/deps/githist/cli are
  Node-side.
- **CI**: `.github/workflows/ci.yml` runs install + lint + typecheck + test on
  every push and PR (Node 20, pnpm from the `packageManager` field).
- **Repo hygiene**: MIT `LICENSE`, `CONTRIBUTING.md` (commit convention,
  trailers, squash policy), `.gitignore` covers `dist/` and
  `test-fixtures/.generated/`.

## How to add a dependency correctly

1. **Workspace package → workspace package**: only along an AD-2 edge, as
   `"@gitnebula/<name>": "workspace:*"` in `dependencies`. Any other edge
   (viz → analyzer, analyzer → analyzer, anything → cli) is an architecture
   violation — stop and escalate rather than declaring it.
2. **External runtime dependency**: add it to the one package that needs it
   (`pnpm --filter @gitnebula/<pkg> add <dep>`), pinning the minor at the
   package's first story per the architecture stack table.
3. **Shared dev tooling** (used by several packages): add the version to the
   `catalog:` section of `pnpm-workspace.yaml` once, then reference it as
   `"<dep>": "catalog:"` in each package — versions never drift.
4. **A dependency with an install script**: pnpm 10 blocks install scripts by
   default; if the dependency genuinely needs one (like esbuild), add it to
   `onlyBuiltDependencies` in `pnpm-workspace.yaml` and say so in your PR.

## Placeholders that later stories replace

- `packages/*/src/index.ts` stubs (each exports `packageName`; spokes
  re-export the contract name to smoke-test resolution) — replaced by real
  implementations from story 1.2 onward.
- `packages/cli/dist/gitnebula.js` — placeholder binary printing the wired
  pipeline packages; story 2.4 builds the real pipeline.
- `packages/viz` placeholder page — story 2.5 builds the GraphEngine;
  story 4.1 turns the vite build into the single self-contained bundle.
