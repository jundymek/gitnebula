# 4.5 — The first npm release

The CLI package is prepared, proven and ready to publish as `gitnebula@0.1.0`.
The publish itself is not done here and must not be: AC-7 is the maintainer's,
from a clean checkout of the merged base with their own npm credentials. The
exact command sequence is in `CONTRIBUTING.md` under **Releasing**, and in the
PR body.

Two things happened in this story. The smaller one is the rename and the
metadata — mechanical, and mostly a sweep. The larger one is AC-6, which turned
out to be three defects rather than one.

## What the package became (AC-1)

`packages/cli/package.json`:

| field         | before               | after                                        |
| ------------- | -------------------- | -------------------------------------------- |
| `name`        | `@gitnebula/cli`     | `gitnebula` — AD-11's one published package   |
| `version`     | `0.0.0`              | `0.1.0`                                       |
| `private`     | `true`               | removed                                       |
| `bin` value   | `./dist/bin/…`       | `dist/bin/…` — see below                      |
| npm-page keys | —                    | `description`, `keywords`, `homepage`, `bugs`, `repository` (with `directory`) |

`license: MIT` and `engines.node: >=20.19` were already there and are unchanged.
No other package lost `private`: `contract`, `scanner`, `deps`, `githist` and
`viz` are source-only internal packages and stay unpublishable by construction
(AD-11).

The `bin` value lost its `./` because npm objected to it out loud —
`npm warn publish "bin[gitnebula]" script name was cleaned`, and `npm pkg fix`
in a scratch copy of the manifest confirmed that leading `./` was the whole
complaint. A first publish that prints a warning is not what AC-1 means by
publishable, so the manifest now says what npm would have rewritten it to. The
tarball is byte-identical either way; only the warning is gone.

`gitnebula` was still unregistered on the registry when this branch was
finished — `curl https://registry.npmjs.org/gitnebula` returned 404 on
2026-08-14, as it did for the supervisor on 2026-08-13.

## The dry run (AC-3)

`npm publish --dry-run`, from `packages/cli`, warning-free:

```
📦  gitnebula@0.1.0
Tarball Contents
    1.1kB  LICENSE
  460.1kB  assets/tree-sitter-python.wasm
  192.4kB  assets/viz/index.html
  435.9kB  dist/bin/gitnebula.js
    1.4kB  package.json
Tarball Details
  package size:   221.5 kB
  unpacked size:  1.1 MB
  total files:    5
```

Five files. `dist/`, both halves of `assets/` and `LICENSE` are present, as
AC-3 asks. **No source file, no test file and no config** — the `files` field
lists `dist`, `assets` and `LICENSE` and nothing else, so `src/`, `tsconfig`,
`tsup.config.ts` and `scripts/` never enter the tarball. The shasum is not
recorded here on purpose: it changes with every rebuild and would read as a
promise this document cannot keep.

## AC-6 — what a fresh clone actually got

The written AC-6 is about a repository containing Python, because that is the
half story 4.4 found while measuring the DoD. At launch the maintainer widened
it, forwarding the epic supervisor's note: in a dev checkout the built binary
could not serve a map **at all**, whatever the repository contained, and the
error it printed misnamed the cause. Three fixes, one story. `DECISIONS.md`
(D-2) records the widening and why the spec text was left alone.

Reproduced on this branch before anything was changed — `pnpm build`, nothing
else:

```
$ ls packages/cli/assets
ls: packages/cli/assets: No such file or directory

$ node packages/cli/dist/bin/gitnebula.js <repo with Python> --no-serve
✖ deps (0.01s)
deps: ENOENT: no such file or directory, open '…/packages/cli/assets/tree-sitter-python.wasm'

$ node packages/cli/dist/bin/gitnebula.js <repo with no Python at all> --no-open
serve: the viewer has not been built — run `pnpm --filter @gitnebula/viz build`,
       then re-run gitnebula — or pass --no-serve …

$ ls packages/viz/dist
index.html            # …it had been built. Both halves of that line were false.
```

### 1. `pnpm build` populates `assets/`

`packages/cli/scripts/prepack.mjs` → `scripts/assemble-assets.mjs`, and it now
has two callers: cli's `build` (after tsup) and cli's `prepack`, unchanged. The
script itself is the same copier 4.1 wrote — it still builds nothing and still
aborts by name when an input is missing.

Because cli's build now consumes `packages/viz/dist`, the workspace `build`
runs **viz before cli**. That reordering is the decision AC-6 asked to have
argued; it is in `DECISIONS.md` (D-3) and in the PR body. In short: the assets
belong to what `packages/cli` builds, so `pnpm --filter gitnebula build` on its
own should produce a binary that runs — a root-level third step would have left
that filtered command producing the same half-built binary the story exists to
kill. It is still exactly two build edges, vite and tsup, now ordered; `pnpm
build` is still the only build entry (4.1's AC-5); `prepack` still exists so
`npm pack` on an unbuilt tree fails by name instead of shipping an empty
`assets/`.

### 2. `missingDistError()` tells the truth

Before: cause `the viewer has not been built`, remedy
`run \`pnpm --filter @gitnebula/viz build\``. In the one situation anybody ever
hit it, **both halves were false** — the viewer was built and sitting in
`packages/viz/dist`, and running that command again changed nothing. What was
missing was the copy under `packages/cli/assets/`.

After: the cause names the directory that was searched, and the remedy names a
command that works.

```
serve: no built viewer to serve (looked in …/packages/cli/assets/viz) — in a
checkout of the repository, run `pnpm build` from the workspace root and re-run
gitnebula; from an installed copy this is a packaging bug, please report it —
or pass --no-serve to stop after writing analysis.json
```

The directory is optional: the other call site reaches the error because
`resolveVizDist` found *no* candidate, and naming one of three there would be a
new lie for an old one. `bundle.ts`'s sibling `missingViewerError` was left
alone — it already pointed at `pnpm build`, which is now correct.

### 3. `resolveVizDist`'s dead candidate

The fallback to the workspace's own `packages/viz/dist` was spelled once, for
the source layout, and the bundle sits one directory deeper than the source
does:

```
packages/cli/src/serve.ts     →  ../../viz/dist        ✔ packages/viz/dist
packages/cli/dist/bin/….js    →  ../../viz/dist        ✘ packages/cli/viz/dist
packages/cli/dist/bin/….js    →  ../../../viz/dist     ✔ packages/viz/dist   (added)
```

So for the built binary there was effectively no fallback at all. Populating
`assets/` is the real fix and the added line is the safety net, but the net is
worth having: it is the difference between "somebody deleted `assets/`" and "no
viewer, no explanation".

## AC-4 — the installed binary is named from `bin`

`pack.test.ts` already looked for `node_modules/.bin/gitnebula`, but it could
not tell *why* that name was there: while the package was `@gitnebula/cli` in
`packages/cli` with `bin: {gitnebula: …}`, the package name, the directory name
and the bin key all pointed at the same string. The rename makes them coincide
again, which is precisely when reading the wrong one stops being detectable. So
the assertion is now explicit — `Object.keys(manifest.bin)` is exactly
`["gitnebula"]`, and that name is what npm linked. `npx gitnebula` (FR-1)
resolves this and nothing else.

## AC-2 — the rename sweep, and what was left alone

Rewritten (anything that is **run**): the workspace `build` script's filter;
`Test command:` lines in four story specs; the test-command comments inside
`packages/cli/src`; `packageName` in `packages/cli/src/index.ts`;
`CONTRIBUTING.md` and `docs/recording-demo.md`.

Left verbatim (anything that is a **record** of what was true on the day it was
written): Dev Agent Records and Completion Notes, the Epic 4 retrospective,
`docs/dod-report.md`, `docs/dev/**` READMEs and MANUAL_TESTING walks, and the
prose of the frozen specs. Rewriting those would falsify them.

`pnpm --filter gitnebula test` is the command from here on. CI needed no change
— it calls `pnpm test`, `pnpm build` and viz's own filters, none of which name
the cli package.

One tension to flag, since CLAUDE.md forbids editing frozen artifacts and AC-2
names "story specs' test commands" outright: four frozen specs were touched, on
exactly one line each, and only the runnable command on it. The spec wins over
CLAUDE.md by CLAUDE.md's own precedence rule; the divergence is flagged here
and in the PR body rather than resolved silently.

## Verification

```bash
pnpm lint        # eslint + prettier, exit 0
pnpm typecheck   # tsc --noEmit in all six packages, exit 0
pnpm test        # 918 tests, 6 packages, exit 0
pnpm --filter gitnebula test          # 15 files, 145 tests passed
cd packages/cli && npm publish --dry-run   # the block quoted above
```

The two lines the spec asks to be quoted separately:

- suite summary — `Test Files  15 passed (15)` / `Tests  145 passed (145)`
- cold install — `cold install: npm-installed tarball analyzed the fixture repo
  and served index.html + analysis.json` (`pack.test.ts`, unchanged by this
  story apart from the AC-4 assertion and the build-lock wrapper)

## Files

| file                                          |        | why                                                            |
| --------------------------------------------- | ------ | -------------------------------------------------------------- |
| `packages/cli/package.json`                    | UPDATE | AC-1: identity, `0.1.0`, npm-page metadata, build script        |
| `package.json`                                 | UPDATE | viz builds before cli (D-3); the filter follows the rename      |
| `packages/cli/scripts/assemble-assets.mjs`     | RENAME | was `prepack.mjs`; two callers now, so the name was a lie       |
| `packages/cli/src/serve.ts`                    | UPDATE | AC-6: the dead candidate, and an error that names the cause     |
| `packages/cli/src/cli.ts`                      | UPDATE | the jsdoc on the abort it rethrows                              |
| `packages/cli/src/index.ts`                    | UPDATE | `packageName`, and the header that named the old package        |
| `packages/cli/src/dev-checkout.test.ts`        | NEW    | AC-6's proof; watched failing first                             |
| `packages/cli/src/test-support.ts`             | UPDATE | build lock reusable + async; `rebuildWithoutAssets`             |
| `packages/cli/src/pack.test.ts`                | UPDATE | AC-4's binary-name assertion; `pack()` under the build lock     |
| `packages/cli/src/serve.test.ts`               | UPDATE | the new error text; `resolveVizDist` across both layouts        |
| `packages/cli/src/cli.test.ts`                 | UPDATE | the new error text                                              |
| `packages/cli/src/{pipeline,e2e,repo}.test.ts` | UPDATE | the test command quoted in their headers                        |
| `README.md`                                    | UPDATE | AC-5: the pre-release fallback is now the real thing            |
| `CONTRIBUTING.md`                              | UPDATE | AC-5: `Releasing`; the prepack workaround is gone               |
| `docs/recording-demo.md`                       | UPDATE | same workaround, same removal                                   |
| four frozen story specs                        | UPDATE | AC-2, one `Test command:` line each                             |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's row                                            |
| `docs/dev/epic-4/4.5-npm-release/*`            | NEW    | this document and the manual walk                               |
