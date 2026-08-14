# Manual testing — 4.5 the first npm release

Every step below was executed on this branch on 2026-08-14 (macOS 15, Node
20.19, pnpm 10.34.5, npm 10) and the observed result is recorded inline. No
step publishes anything; nothing here writes to the npm registry.

`$W` is a scratch directory (`mktemp -d`). Run the whole walk from a clean tree
after `pnpm install`.

## A. The dry run (AC-3)

- [x] **A1.** `pnpm build && cd packages/cli && npm publish --dry-run`

      → `📦 gitnebula@0.1.0`, five files, package size 221.5 kB, unpacked
      1.1 MB. No warnings. The full listing is in this folder's README.

- [x] **A2.** The list contains `dist/bin/gitnebula.js`, `assets/viz/index.html`,
      `assets/tree-sitter-python.wasm`, `LICENSE`, `package.json` — and nothing
      else.

      → confirmed; `tar -tzf … | grep -E '\.test\.|/src/|tsconfig|tsup'`
      matched nothing.

- [x] **A3.** The name is free on the registry:
      `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/gitnebula`

      → `404`. Read-only; this is the only step that touches the network
      besides npm's dependency resolution in B2.

## B. The tarball, installed cold into a temp directory (AC-4)

- [x] **B1.** `cd packages/cli && npm pack --pack-destination $W`

      → `gitnebula-0.1.0.tgz`, 221 462 bytes.

- [x] **B2.** An empty directory with only a manifest — no pnpm, no workspace:

      ```bash
      mkdir -p $W/cold && echo '{"name":"cold","private":true}' > $W/cold/package.json
      cd $W/cold && npm install $W/gitnebula-0.1.0.tgz --no-audit --no-fund
      ```

      → `added 18 packages in 698ms`.

- [x] **B3.** The binary npm linked is named from `bin`, not from the package
      directory: `ls -l node_modules/.bin/`

      → `gitnebula -> ../gitnebula/dist/bin/gitnebula.js`. The installed
      manifest reads `gitnebula 0.1.0 {"gitnebula":"dist/bin/gitnebula.js"}`.

## C. `npx` from that tarball, in an unrelated repository (AC-4, FR-1)

The repository is built in `$W/unrelated-project`: two Python modules with an
import between them, two TypeScript modules with an import between them, two
commits by two different authors. Nothing to do with gitnebula's own checkout
or its fixtures.

- [x] **C1.** `cd $W/cold && npx gitnebula $W/unrelated-project --no-serve --out $W/out.json`

      → exit 0 in **0.92 s** wall clock, npx resolution included. All stages
      green, no warnings.

- [x] **C2.** The emitted document is real: `schemaVersion 1.0`, repo
      `unrelated-project`, 6 nodes, **2 edges**.

      → both imports were resolved — one Python, one TypeScript. The Python
      edge is the one that used to die on
      `ENOENT … tree-sitter-python.wasm`; from an installed package it never
      did, and this confirms the rename did not disturb it.

- [x] **C3.** `npx gitnebula $W/unrelated-project --no-open` serves the map.

      → `serving http://127.0.0.1:4137/`. `GET /` → `200 text/html`,
      192 369 bytes; the page carries `<script type="module">` inline and zero
      `<script src=…>`. `GET /analysis.json` → `200 application/json`, repo
      `unrelated-project`, 6 nodes. Ctrl+C (SIGINT) stopped it cleanly — the
      process was gone within a second.

- [ ] **C4.** `npx gitnebula` **against the real registry**, with no tarball.

      Not executable, and deliberately so: the package is unpublished, and
      AC-7 reserves the publish for the maintainer. C1–C3 prove the artefact
      as far as it can be proved without a registry write. This box closes
      itself the moment the maintainer publishes.

## D. The dev-checkout gap (AC-6)

The point of these is that they need **no** `npm pack` and no prepack.

- [x] **D1.** From a clean tree: `rm -rf packages/cli/assets packages/cli/dist
      packages/viz/dist && pnpm build && ls -R packages/cli/assets`

      → `tree-sitter-python.wasm` and `viz/index.html`. Before this story the
      directory did not exist at all after the same command.

- [x] **D2.** `node packages/cli/dist/bin/gitnebula.js <repo with Python>
      --no-serve --out /tmp/ac6.json`

      → exit 0, valid `analysis.json`, and `core/scoring.py` present among the
      nodes. Before: `✖ deps` and
      `ENOENT … packages/cli/assets/tree-sitter-python.wasm`.

- [x] **D3.** `node packages/cli/dist/bin/gitnebula.js <any repo> --no-open`

      → serves. Before: `serve: the viewer has not been built — run
      \`pnpm --filter @gitnebula/viz build\`` — on a tree where
      `packages/viz/dist/index.html` was sitting right there, so both halves
      of that sentence were false. Verified on a repository containing **no
      Python at all**, which is what makes it the widened AC-6 rather than
      4.4's original finding.

- [x] **D4.** The build order is enforced by a failure that names itself.
      `rm -rf packages/viz/dist packages/cli/dist && pnpm --filter gitnebula build`

      → tsup succeeds, then
      `assets: the built Viewer is missing at …/packages/viz/dist/index.html —
      run \`pnpm build\` first`, exit 1. It refuses rather than producing a
      half-built binary.

- [x] **D5.** `npm pack` on a tree nobody built still fails by name rather than
      shipping an empty `assets/`.

      → `assets: the built Viewer is missing …` and `assets: the cli bundle is
      missing …`, both with `run \`pnpm build\` first`; npm aborts with
      `code 1`.

- [x] **D6.** The new error text, read as a user would read it:

      ```
      serve: no built viewer to serve (looked in …/packages/cli/assets/viz) —
      in a checkout of the repository, run `pnpm build` from the workspace root
      and re-run gitnebula; from an installed copy this is a packaging bug,
      please report it — or pass --no-serve to stop after writing analysis.json
      ```

      → the remedy was followed literally and it worked, which is the whole
      complaint against the old one.

## E. The documents (AC-5)

- [x] **E1.** `README.md`'s quickstart no longer contains the words "Before the
      first npm release" or a `prepack.mjs` line.

      → confirmed by grep; the clone instructions that remain are three lines
      and all three were run in D1–D3.

- [x] **E2.** `CONTRIBUTING.md` has a `## Releasing` section naming the version
      bump, the dry run, `npm publish`, the `v<version>` tag, and the rule that
      CLI semver and `schemaVersion` move independently.

      → present. The dry-run and pack commands in it were run (A1, B1); `npm
      version`, `npm publish` and `git tag` were **not** — they are AC-7.

- [ ] **E3.** The rendered npm package page — description, keywords, repository
      and homepage links as npmjs.com lays them out.

      Not executable before publishing: the page does not exist until the
      maintainer publishes. The underlying fields are asserted in the manifest
      and were read back out of the *installed* package in B3.

## Accessibility

Nothing in this story ships or changes UI. The viewer served in C3 and D3 is
byte-identical to the one story 4.1 shipped and 3.4/4.7 reviewed; this story
only changed where the binary finds it. No new accessibility surface, so no
new checks.

## Summary

Ran 16 of 18. The two left unchecked are C4 and E3, both of which require the
package to exist on the registry — that is AC-7, and it is the maintainer's.
