# Manual testing — 5.8 README and docs refresh

AC-5 asks that **any command the README instructs a visitor to run has been run
and works as written**. Every executable step below was run in this worktree;
each carries its observed result. AC-6 is the maintainer's own read-through and
is deliberately left unticked.

Unless stated otherwise, `<clean>` is a fresh `git clone` of this repository
into a temp directory — the same thing a visitor has, and the reason the numbers
below differ from a run inside a live worktree.

## Commands the README tells a visitor to run

- [x] `npx gitnebula` — run in `<clean>` against the **published** package.
      Completed in 0.31 s: `368 nodes, 400 edges, 140 co-change pairs`. Note the
      published build predates story 5.5, so its summary line does not yet carry
      the `history over the last 90 days (--window-days)` phrase the README's
      transcript shows; the transcript is a run of **this commit's** CLI, which
      is what the next release ships.
- [x] `npx gitnebula ../some/other/repo` — verified in the equivalent form
      `node packages/cli/dist/bin/gitnebula.js <clean> --no-serve`:
      `368 nodes, 400 edges, 140 co-change pairs … in 0.27s`.
- [x] `npx gitnebula https://github.com/…` — clone-and-analyze against
      `https://github.com/jundymek/gitnebula`: `324 nodes, 338 edges, 115
      co-change pairs … in 0.27s`. (Fewer nodes than the local run because the
      default branch does not carry Epic 5.)
- [x] `npx gitnebula --no-serve` — writes `analysis.json` and exits; used by
      every run above.
- [x] `npx gitnebula --no-open` — serves without opening a browser. Printed
      `serving http://127.0.0.1:4140/`.
- [x] `npx gitnebula --window-days 365` — summary line reported `history over
      the last 365 days (--window-days)`, i.e. the flag reaches the copy story
      5.5 added.
- [x] **Port fallback**, which the README now states: with 4137 and 4138 already
      taken by other processes on this machine, the server bound 4139 and
      printed that URL.
- [x] `npx gitnebula build -o ./site` — wrote **exactly two files**,
      `index.html` (212 KB) and `analysis.json`, and nothing else. Reported
      `viewer assets: 63.3 KB gzipped of 2.00 MB budget (3.1%)`.
- [x] Serving that bundle over HTTP — `python3 -m http.server`, then
      `curl`: `index.html 200`, `analysis.json 200`. The README's warning about
      `file://` is why this was checked over HTTP rather than off disk.
- [x] `pnpm install` → `pnpm build` → `node packages/cli/dist/bin/gitnebula.js .`
      — the from-a-clone path. All three exit 0.
- [ ] `npm install -g gitnebula` — **not run.** It mutates the machine's global
      npm prefix, which is not this worktree's to change. The same published
      artefact was exercised through `npx` above, which resolves the identical
      tarball.

## The repository's own checks

- [x] `pnpm lint` — exit 0 (ESLint + Prettier).
- [x] `pnpm test` — exit 0. contract, scanner 145, deps 66 (+2 skipped),
      githist 74, viz 620, cli 145.
- [x] `pnpm build` — exit 0; viz and cli both build.

## The demo

- [x] The recorder runs end to end against a served map:
      `node scripts/record-demo.mjs` produced a 28 s WebM, and the ffmpeg encode
      in `docs/recording-demo.md` produced a 2.6 MB GIF — inside the ~5 MB
      ceiling that document sets.
- [x] Frames were extracted and inspected: the start-here panel is the opening
      state, the detail panel shows the history rows with their window, the
      scope bar appears on drill-down with the hidden count stated, and the
      hovered chain is legible while the rest of the map stays visible (the
      point of story 5.2).
- [ ] Re-recorded from a **clean clone** after the wave-B stories merged, so no
      worktree scratch file is on the map, and the committed GIF is that take.
      _(Ticked when the final take is committed; the dry runs above are on the
      pre-merge base.)_

## For the maintainer

- [ ] **AC-6 — read the README as a stranger would.** Open `README.md` top to
      bottom without reading the code, and confirm it describes the product that
      now exists: that the lead question is the one you would actually arrive
      with, that nothing promised is missing when you run it, and that nothing
      the epic shipped is missing from the page.
- [ ] Watch `docs/assets/demo.gif` at README width and confirm it reads as the
      onboarding path rather than as a feature reel.
