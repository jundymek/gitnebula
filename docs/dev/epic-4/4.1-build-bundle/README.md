# 4.1 — Static bundle and the publishable package

`gitnebula build` now writes a directory containing exactly `index.html` and
`analysis.json`, and the npm package works from a cold `npm install` outside
this workspace.

## What this story actually found

The interesting part of the work was not writing the `build` command. It was
that **the built binary had never been run.** Every test in the workspace
exercised gitnebula through pnpm, through `exports` maps, from source. AC-4
asked for the opposite — a tarball, plain npm, an empty directory — and the
first attempt died immediately:

```
deps: Aborted(Error: ENOENT ... packages/cli/dist/web-tree-sitter.wasm)
```

Four separate defects came out of that thread, none of them visible to any
existing test:

1. **`web-tree-sitter`'s runtime `.wasm` was inlined away from its loader.**
   The emscripten glue loads `web-tree-sitter.wasm` from beside the module that
   imports it; tsup moved the importer into `dist/`, where the file is not. Any
   repository containing Python aborted. Fixed by making the package external,
   exactly as `typescript` already is and for the same reason.

2. **The grammar `.wasm` resolved outside the package.** `@gitnebula/deps`
   locates it as `new URL("../../assets/tree-sitter-python.wasm",
   import.meta.url)` — two directories up from `src/python/parser.ts`. From
   `dist/gitnebula.js` that is `packages/assets/…`, outside `packages/cli`,
   where no `prepack` copy can put it. Fixed by emitting the bundle at
   `dist/bin/gitnebula.js`, two directories below the package root, so the same
   expression means the same thing bundled as it does from source — which is
   what AD-11 says it must.

3. **`npm install <tarball>` failed before the binary existed.** `workspace:*`
   and `catalog:` are pnpm protocols; `pnpm pack` rewrites them and `npm pack`
   does not, so the tarball only installed if it had been packed by the right
   tool. Fixed by moving the four internal packages to `devDependencies` (tsup
   inlines them — nothing resolves them at runtime) and pinning `typescript` to
   a real range.

4. **The single-file inliner corrupted the bundle.** `String.replace` re-reads
   `$&`, `` $` `` and `$'` out of the *replacement*, and minified JS contains
   those sequences: `$'` spliced a second copy of the whole page into the
   middle of the script. The page still rendered, which is what made it worth
   catching — a Playwright network check found it, not a person reading the
   output. Fixed by passing a replacer function.

A fifth came from the `build` command itself: the parent command and the `build`
subcommand both declare `-o`, and commander gives a shared short flag to the
parent. `gitnebula build -o site` silently wrote to `./gitnebula-bundle`.
`enablePositionalOptions()` fixes it; a test asserting *where the files landed*
is what caught it.

A sixth came from review, and it was the most dangerous of the set because it
produced a plausible wrong answer rather than a crash: the reuse rule keyed
only on mtime versus HEAD, so an output directory reused for a second
repository published the first repository's map under the second's name.
Tightening it to check repository identity, remote, window and
`.gitnebula.yml` mtime closed that case and a second review found the next
layer — a checkout moved to an older commit still passes a timestamp test, and
a `.gitnebula.yml` that is deleted rather than edited leaves no mtime to
compare.

That is where the reuse path was removed rather than patched a third time. See
"Decisions" below: the emitted document records nothing that identifies the
analysis it came from, and the two places provenance could be written are both
barred here. Every `gitnebula build` now runs the pipeline.

A seventh, from the review round after that, and the most embarrassing because
it is the default path: **the bundle was in its own map.** The output directory
is created inside the repository being analyzed, and nothing excluded it, so
the second `gitnebula build` in a repository mapped the first one's output —
346 nodes became 349, and the map gained an `index.html` node that is the
viewer drawing it. `build` now contributes one exclusion of its own for the
output directory whenever it lies inside the repository. Three consecutive
runs on this repository now report the same 343 nodes and 402 edges.

An eighth, from the last review round: the manifest advertised
`exports: { ".": "./src/index.ts" }` while `files` ships only `dist`, `assets`
and `LICENSE`, so the tarball promised an entry point it did not carry.
Shipping `src` would not have made the import work and building a library
entry is surface no story asks for, so the field is gone — cli is a binary,
`bin` is its whole public surface, and nothing in the workspace imports it. A
test now asserts the general property: every entry point the manifest
advertises must exist in the tarball.

A ninth, narrow but exactly the kind the previous fix invites: the
self-exclusion asked whether `path.relative` *started with* two dots, which is
true both of a path stepping out of the repository and of a directory merely
named `..site`. The second is inside, so its exclusion was dropped and the
bundle went back into its own map. Outside now means exactly `..` or a path
continuing through `../`.

## Files

### `packages/viz`

| file                              | change | why                                                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `vite.config.ts`                  | UPDATE | a local `singleFile` plugin inlines JS and CSS into `index.html` and fails on any leftover |
| `src/loader.ts`                   | UPDATE | `file://` is recognised before the fetch and answered with the ADR-0004 hint               |
| `src/index.ts`                    | UPDATE | exports `FILE_PROTOCOL_HINT`                                                              |
| `src/loader.test.ts`              | UPDATE | the `file://` hint, and that http is unaffected                                            |
| `bundle/playwright.config.ts`     | NEW    | the built bundle served by a plain static host                                             |
| `bundle/tests/bundle.pw.ts`       | NEW    | AC-3: exactly two requests, inline assets, and the `file://` screen                        |
| `scripts/serve-bundle.mjs`        | NEW    | forty lines of `node:http` standing in for GitHub Pages                                    |
| `package.json`                    | UPDATE | the `bundle-check` script                                                                  |

### `packages/cli`

| file                       | change | why                                                                          |
| -------------------------- | ------ | ---------------------------------------------------------------------------- |
| `src/bundle.ts`            | NEW    | output assembly and the gzip measurement                                     |
| `src/bundle.test.ts`       | NEW    | AC-1 and AC-2 at the unit level                                              |
| `src/pack.test.ts`         | NEW    | AC-4's cold install, and AC-2 against the real dist                          |
| `src/cli.ts`               | UPDATE | the `build` subcommand, positional options, shared analysis flags            |
| `src/serve.ts`             | UPDATE | `resolveVizDist` follows the bundle one directory deeper                     |
| `src/index.ts`             | UPDATE | exports the bundle surface                                                    |
| `scripts/prepack.mjs`      | NEW    | copies the viz dist, the grammar and the licence into the package            |
| `tsup.config.ts`           | UPDATE | `dist/bin/gitnebula.js`; `web-tree-sitter` external                          |
| `package.json`             | UPDATE | `files`, `bin`, `prepack`, an npm-resolvable dependency block, no `exports`  |

### Repository

| file                        | change | why                                                    |
| --------------------------- | ------ | ------------------------------------------------------ |
| `.github/workflows/ci.yml`  | UPDATE | a `bundle` job: size budget and the zero-request check |
| `.gitignore`                | UPDATE | the prepack copies and the bundle output directories   |

## Decisions worth knowing about

Full reasoning in `DECISIONS.md` on the branch. The three a reviewer should not
have to rediscover:

- **The package keeps the name `@gitnebula/cli`.** AD-11 says the published
  artefact is `gitnebula`; that rename is a publish-time act the maintainer
  performs, not this story — every spec, doc and CI step (including this
  story's own test command) names the package as it is today, and the package
  is still `"private": true`.
- **`build` never reuses an existing `analysis.json`.** AC-1 permits reusing "a
  fresh `analysis.json`" — permits, not requires — and freshness turned out to
  be unestablishable here. The document records no commit hash, no exclusion
  list, no threshold and no configuration fingerprint, so every check available
  is a proxy, and two rounds of review found a hole behind each one. Writing
  real provenance is barred both ways: into `analysis.json` is a contract
  change (never a side effect of another story), and beside it breaks AC-1's
  own two-file rule. The pipeline costs 0.28 s on this repository; a bundle
  that publishes a different repository's map while reporting success costs
  more. `--force` went with it, having nothing left to escape.
- **The `file://` hint lives in `viz`.** The spec's Touches line scopes viz to
  "build config only", but AC-3 asks for browser-side behaviour that can only
  live in the loader. The AC wins; the divergence is flagged in the PR.

## Running the checks

```bash
pnpm build                                  # the only build entry (AC-5)
pnpm --filter @gitnebula/cli test           # includes the cold-start pack e2e
pnpm --filter @gitnebula/viz bundle-check   # needs Playwright's chromium
```

`bundle-check` reads `packages/viz/dist` as `pnpm build` left it, so build
first. `BUNDLE_PORT=<n>` moves it off 4319 when several worktrees share a
machine.

One caveat worth stating plainly: `pack.test.ts` is the only test in this
workspace that touches the network — `npm install <tarball>` resolves the four
runtime dependencies from the registry. The product is offline; this test of
how the product is *delivered* is not, and cannot be.
