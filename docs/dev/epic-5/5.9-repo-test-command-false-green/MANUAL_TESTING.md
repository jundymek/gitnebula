# Manual testing — 5.9-repo-test-command-false-green

Executed in `/Users/jundymek/dev/gitnebula-agents/pamela` (worktree of
`story/5.9-repo-test-command-false-green`), pnpm 10.34.5, Node 20, macOS.
Every step below was run; the observed output and exit code are recorded
inline. There is no UI in this story, so there is nothing that needs a human
eye and nothing is left unticked.

## 1. Reproduce the defect — the command that cannot fail

Run with `.npmrc` temporarily moved aside, which is the repository as it stood
before this branch.

- [x] `pnpm --filter @gitnebula/cli test` → **exit 0**

```
No projects matched the filters in "/Users/jundymek/dev/gitnebula-agents/pamela"
```

**Observed:** exit `0`. No suite ran, no test file was loaded, and any gate
reading the exit code would have called this green. This is the defect.

## 2. The same command with the fix in place

- [x] `pnpm --filter @gitnebula/cli test` → **exit 1**

```
No projects matched the filters in "/Users/jundymek/dev/gitnebula-agents/pamela"
```

**Observed:** exit `1`. Same message from pnpm, opposite exit code — which is
the whole point: the message was never the problem, the exit code was.

## 3. It is not specific to `test`

`build` was the shape bob hit during epic 5 (PR #54's manual verification: a
filtered build "exited 0 having done nothing").

- [x] `pnpm --filter @gitnebula/cli build` → **exit 1**

**Observed:** exit `1`. The `.npmrc` setting is global, so `build`,
`typecheck` and `exec` are covered without any wrapper.

## 4. A filter that does match is unaffected

- [x] `pnpm --filter @gitnebula/viz typecheck` → **exit 0**

**Observed:** exit `0`. The setting only changes the empty-selection case; it
does not make correct filters stricter.

## 5. The canonical runner names the offending filter

pnpm's own message names the *directory* it searched. AC-1 wants the *filter*.

- [x] `pnpm test:pkg @gitnebula/cli` → **exit 1**

```
pkg-test: filter "@gitnebula/cli" matched no project in this workspace.
pkg-test: workspace packages: @gitnebula/contract, @gitnebula/deps, @gitnebula/githist, @gitnebula/scanner, @gitnebula/viz, gitnebula
pkg-test: note the cli package is published as "gitnebula", unscoped.
```

**Observed:** exit `1`, and a reader is told both what went wrong and what to
type instead.

## 6. The automated check, and each of its assertions watched fail

- [x] `pnpm test:tooling` → **exit 0**, `6 packages, all checks passed`

Then, one break at a time, each restored afterwards:

- [x] **`.npmrc` moved aside** → `FAIL a filter matching no project exits non-zero`
- [x] **`gitnebula`'s table row rewritten to the stale command** →
      `FAIL row "gitnebula" carries the literal command form` /
      `got: pnpm --filter @gitnebula/cli test`
- [x] **the `canonical-test-commands:start` marker deleted** →
      `FAIL CLAUDE.md carries the canonical command table`

**Observed:** each assertion was seen red against a deliberately broken tree
and green again after restoring it. Exit `1` in each broken state.

## 7. The suites the story is accountable for

- [x] `pnpm lint` → **exit 0** (eslint + prettier --check, all files)
- [x] `pnpm test` → **exit 0**. Per package: contract 3 files / 105 tests ·
      githist 5 / 74 · scanner 8 / 145 · deps 8 passed + 1 skipped /
      66 passed + 2 skipped · viz 45 / 620 · cli 15 / 145. Then
      `verify-test-commands: 6 packages, all checks passed`.
- [x] `pnpm --filter gitnebula test` → **exit 0**,
      `Test Files 15 passed (15)` / `Tests 145 passed (145)`,
      printing `viewer assets: 63.3 KB gzipped of 2.00 MB budget (3.1%)`.
