# 4.1 — manual testing

Every step below was executed on this branch unless it says otherwise. Observed
results are recorded inline. Two steps are left unticked with the reason
stated — they need a human looking at a screen.

Environment: darwin 25.5.0 (arm64), Node 22.20.0, pnpm 10.34.5,
`packages/cli/dist/bin/gitnebula.js` built from this branch.

## Build the workspace

- [x] `pnpm build`
      → `dist/bin/gitnebula.js` (429 KB) and `dist/index.html` (187.3 KB, one
      file). Vite reports `191.82 kB │ gzip: 59.60 kB`; the story's own
      measurement, gzip -9, is 57.6 KB.

- [x] `find packages/viz/dist -type f`
      → exactly `packages/viz/dist/index.html`. No `assets/` directory, no
      hashed chunk, no stylesheet.

- [x] `grep -o '<script[^>]*' packages/viz/dist/index.html`
      → one match, `<script type="module"`. `grep -c 'src="/index.js"'` → 0.

## Build a bundle

- [x] `node packages/cli/dist/bin/gitnebula.js build -o .gitnebula-site`
      (run inside this repository — gitnebula mapping itself)
      → `310 nodes, 373 edges, 60 co-change pairs in 0.28s`, then
      `viewer assets: 57.6 KB gzipped of 2.00 MB budget (2.8%)`, then
      `bundle written to …/.gitnebula-site`.

- [x] `ls -l .gitnebula-site`
      → exactly two files: `analysis.json` (187,629 B) and `index.html`
      (191,825 B). Nothing else.

- [x] Run it a second time with no `--force`
      → `reusing …/analysis.json — it describes this repository at HEAD, over
      the same window (pass --force to re-analyze)`; no analysis stages ran.

- [x] Run it again with `--force`
      → all eight pipeline stages ran and the file was rewritten.

- [x] Run it again with `--window-days 30` into the same directory
      → `re-analyzing — the existing analysis.json covers 90 days, not 30`.
      The reuse rule is provenance, not age: the same check refuses a document
      made from another repository, another remote, or before
      `.gitnebula.yml` changed.

- [x] `gitnebula build -o site` writes to `./site`, not to the default
      → verified. This is the commander `-o` collision described in the README;
      before the fix it silently wrote to `./gitnebula-bundle`.

## Serve it with a real static server

- [x] `npx serve -l 4333 .gitnebula-site`
      → `GET /` 200 `text/html; charset=utf-8`;
      `GET /analysis.json` 200 `application/json; charset=utf-8`.

- [x] Ask the server for something the bundle must not need:
      `GET /assets/index.js` → 404. The page never requests it.

- [x] The page requests only its own two files, asserted by a browser rather
      than by reading the HTML: `pnpm --filter @gitnebula/viz bundle-check`
      → 4 passed. The network test collects every request Chromium issues
      through settle and asserts the pathnames are exactly
      `["/", "/analysis.json"]`, and that every host equals the page's own.

- [x] The same check bites when it should: an `<img src="/logo.png">` added to
      the built page made it fail with `+ "/logo.png"` in the request list.
      Removed afterwards.

## Open it from disk (`file://`, unsupported by ADR-0004)

- [x] Navigate to `file:///…/packages/viz/dist/index.html`
      → the error screen reads *"This page has to be served, not opened from
      disk"* and names the fix: `npx serve` (or `python3 -m http.server`).
      Zero failed requests — the loader recognises the scheme instead of
      letting the browser's opaque-origin error reach the user.
      Executed headlessly via `bundle-check`; the assertions are on the visible
      text of the rendered screen.

## Cold start from npm — no pnpm, no workspace

- [x] `pnpm --filter @gitnebula/cli test` (includes the pack e2e)
      → `Test Files 13 passed (13) / Tests 136 passed (136)` in 18.4 s.
      The pack e2e packs the package, installs the tarball into an empty temp
      directory with plain `npm install`, runs the installed binary against the
      fixture repository with `--no-open`, and reads `/` and `/analysis.json`
      off the served map.

- [x] The tarball carries what AD-11 says it must:
      `package/dist/bin/gitnebula.js`, `package/assets/viz/index.html`,
      `package/assets/tree-sitter-python.wasm`, `package/LICENSE` — and the
      viewer inside it is a single file.

- [x] The default (non-`build`) invocation is unaffected:
      `gitnebula <fixture> --no-serve` → `6 nodes, 0 edges, 0 co-change pairs`,
      `analysis.json` written to the working directory.

## Left for a human

- [ ] **Click through the map in a real browser.** Serve `.gitnebula-site`
      with `npx serve` and open the printed address: pan, zoom past
      `UNFOLD_ZOOM`, hover a hot node, run a search, export a PNG. The
      headless checks above prove the bundle *loads and renders* the document
      it fetched (`#stage` visible, no error screen), but interaction feel —
      whether the settle looks right, whether panning is smooth — is not
      something a headless assertion can speak to.

- [ ] **Read the map's aesthetics against `reference/mockup.html`.** Palette,
      glow, label legibility at DPR 2. Same reason: a human eye is the
      instrument.

Neither is a regression risk from this story — it changes how the viewer is
*packaged*, not what it draws — but the bundle is the artefact a stranger will
actually open, so someone should open it once.
