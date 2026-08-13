# Manual testing — 4.6-docs-path-drift

The story's subject is documented commands, so the test is the obvious one:
clone the branch into an empty directory and run everything the three documents
print, verbatim.

Walked on 2026-08-13, macOS 15 (darwin 25.5.0), Node 20, pnpm 10.34.5, from
`git clone --branch story/4.6-docs-path-drift` into `/tmp/gn-walk` — no
`node_modules`, no `dist/`, nothing carried over from the worktree.

## The pre-fix observation (why the extra step is documented)

- [x] **A clean clone with `pnpm install && pnpm build` and no prepack step.**
      Serving stops at `serve: the viewer has not been built`, and `curl` gets
      `index=404 analysis=404`; `gitnebula build` refuses with `bundle: the
      viewer has not been built` and writes nothing; a one-file Python
      repository fails its `deps` stage with `ENOENT … packages/cli/assets/
      tree-sitter-python.wasm`. All three are the same cause, and all three
      disappear after `node packages/cli/scripts/prepack.mjs`. This is why the
      recipe in README/CONTRIBUTING/recording-demo prints that line.

## README quickstart

- [x] `pnpm install` → ok. `pnpm build` → ok;
      `packages/cli/dist/bin/gitnebula.js` exists, and
      `packages/cli/dist/gitnebula.js` does not.
- [x] `node packages/cli/scripts/prepack.mjs` → `prepack: assets/viz`,
      `prepack: assets/tree-sitter-python.wasm`, `prepack: LICENSE`.
- [x] `node packages/cli/dist/bin/gitnebula.js .` → `analysis.json — 315 nodes,
      375 edges, 76 co-change pairs in 0.26s`, then `serving
      http://127.0.0.1:4137/`. `curl` → `index=200 analysis=200`. The browser
      opened, as documented.
- [x] `… --no-serve` → writes `analysis.json` and exits.
- [x] `… --no-open` → serves without opening a browser.
- [x] `… ../gn-clean-clone --no-serve` (analyze a different checkout) → 316
      nodes; `analysis.json` lands in the working directory, as documented.
- [x] `… https://github.com/octocat/Hello-World --no-serve` (clone into a temp
      dir and analyze that) → 1 node, 0 edges. Needs the network, by design.
- [x] `… --window-days 180` → accepted, 319 nodes.
- [ ] `npx gitnebula` — **not executable today**: nothing is published until
      story 4.5. This is exactly why the README prints the from-a-clone
      fallback, and why that fallback had to work.

## README — "A static bundle you can host"

- [x] `node packages/cli/dist/bin/gitnebula.js build .` → `bundle written to
      /private/tmp/gn-walk/gitnebula-bundle`. Directory contains exactly
      `index.html` and `analysis.json` — nothing else, as the text claims.
- [x] `… build . -o /tmp/gn-walk-bundle` → same two files at the given path.
- [x] Hosting the result: `python3 -m http.server` in the bundle directory →
      `index=200 analysis=200`. Confirms the "copy it to any static host" line
      and the parenthetical about `file://` (the viewer fetches its sibling
      `analysis.json`, so HTTP is required).
- [ ] Rendering the hosted bundle in a browser (layout settles, module opens,
      heatmap) — not executed here: viewer behaviour is 3.x's and 4.3's ground,
      unchanged by this story, and there is no headless assertion to add for it
      in a docs change.

## CONTRIBUTING — "try a change end to end"

- [x] The block as printed (`pnpm build`, prepack, then
      `node packages/cli/dist/bin/gitnebula.js .`) — run above; writes
      `analysis.json` and serves the map.

## docs/recording-demo.md — re-recording

- [x] Terminal 1 as printed:
      `node packages/cli/dist/bin/gitnebula.js . --no-open` → `serving
      http://127.0.0.1:4137/`, no browser opened.
- [ ] `node scripts/record-demo.mjs` and the `ffmpeg` encode — not executed:
      re-recording the committed demo GIF is not this story's change, and doing
      it would replace `docs/assets/demo.gif` with a different take. The path
      this story fixed is the one on the line above it.

## The check itself (AC-3)

- [x] Watched failing against the pre-fix tree —
      `pnpm --filter @gitnebula/cli exec vitest run src/docs-paths.test.ts`
      listed exactly `CONTRIBUTING.md:36`, `README.md:54` and
      `docs/recording-demo.md:56`, each `→ packages/cli/dist/gitnebula.js`.
- [x] Green after the fix, and green under the full `pnpm test`.
- [x] It really builds: deleting `packages/cli/dist`, `packages/viz/dist` and
      the build stamp, then running the suite alone, recreated both.
- [x] The exemption marker is per-occurrence, not per-document: a scratch edit
      adding a guarded reference plus a second, unguarded one to
      `docs/recording-demo.md` failed on exactly the second
      (`docs/recording-demo.md:96 → packages/cli/dist/ghost.js`). Edit reverted.
- [x] Orphaned lock recovery: a lock directory owned by a dead pid, planted by
      hand with the build stamp deleted, was reclaimed — suite green in 1.55s
      rather than stalling on the five-minute timeout.

**Outcome: 19 of 23 steps executed, all passing.** The four left unchecked are
`npx gitnebula` (unpublished until 4.5), the browser rendering of a hosted
bundle, and the two demo-recording steps that would overwrite a committed
asset — each with its reason above.
