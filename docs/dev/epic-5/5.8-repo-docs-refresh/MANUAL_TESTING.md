# Manual testing — 5.8 README and docs refresh

AC-5 asks that **any command the README instructs a visitor to run has been run
and works as written**. Every executable step below was run in this worktree;
each carries its observed result. AC-6 is the maintainer's own read-through and
is deliberately left unticked.

Unless stated otherwise, `<clean>` is a fresh clone of this repository into a
temp directory — the same thing a visitor has, and the reason the numbers below
differ from a run inside a live worktree. All figures are from the branch with
all of Epic 5 merged.

## Commands the README tells a visitor to run

- [x] `npx gitnebula` — run in `<clean>` against the **published** package.
      Completed in 0.31 s: `368 nodes, 400 edges, 140 co-change pairs`. Note the
      published build predates story 5.5, so its summary line does not yet carry
      the `history over the last 90 days (--window-days)` phrase the README's
      transcript shows; the transcript is a run of **this branch's** CLI, which
      is what the next release ships.
- [x] `npx gitnebula ../some/other/repo` — verified in the equivalent form
      `node packages/cli/dist/bin/gitnebula.js <clean> --no-serve`:
      `397 nodes, 480 edges, 173 co-change pairs … in 0.29s`, which is the
      transcript in the README.
- [x] `npx gitnebula https://github.com/…` — clone-and-analyze against
      `https://github.com/jundymek/gitnebula`: `324 nodes, 338 edges, 115
      co-change pairs … in 0.27s`. (Fewer nodes than the local run because the
      default branch does not carry Epic 5.)
- [x] `npx gitnebula --no-serve` — writes `analysis.json` and exits; used by
      every run above.
- [x] `npx gitnebula --no-open` — serves without opening a browser. Printed
      `serving http://127.0.0.1:4139/`.
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

## Claims in the README that are not commands

- [x] **`?view=3d` opens the 3D view.** Driven against the served viewer: the
      view switch reports `[["2d","false"],["3d","true"]]` on that URL, so the
      deep link selects 3D rather than falling back.
- [x] **"nearly half the files carry no import edge"** — measured on the merged
      epic: 182 of 391 files, 47%.
- [x] **"341 of 397 nodes have no co-change partner"** — measured on the same
      document.
- [x] **`chrome/chrome.ts` and `styles.css` keep changing together with no
      import between them** — the pair is in `cochanges` (9 shared commits at
      the time of writing) and there is **no** edge between them in `edges`.
      The README states the relationship without the count, because that number
      moves with every push.
- [x] **3D holds 55 fps to roughly 840 drawn nodes** — quoted from story 5.7's
      `PERFORMANCE.md`, not re-measured here. The README deliberately does not
      claim the 2D floor for 3D.
- [x] **The 2D unfold threshold (1.8×) and ⌘K search** — re-checked against
      `engine/constants.ts` and `chrome/search.ts`; both unchanged by Epic 5 and
      both still stated correctly.

## The repository's own checks

- [x] `pnpm lint` — exit 0 (ESLint + Prettier).
- [x] `pnpm test` — exit 0 on the merged base: contract 105, scanner 145,
      githist 74, deps 66 (+2 skipped), viz 781, cli 145.
- [x] `pnpm build` — exit 0; viewer bundle 72.02 kB gzipped.

## The demo

- [x] The recorder runs end to end against a served map: 40 s of WebM, encoded
      by the documented ffmpeg command to a **3.7 MiB** GIF — inside the ~5 MB
      ceiling `docs/recording-demo.md` sets, and marginally smaller than the
      asset it replaces.
- [x] Frames extracted and inspected: the start-here panel is the opening state,
      the detail panel shows the history rows with their window **and the blast
      radius section with `show on map` active**, the scope bar appears on
      drill-down stating `36 nodes hidden: no dependencies`, the hovered chain is
      legible while the rest of the map stays visible, and the `2D | 3D` toggle
      shows the graph in perspective before returning to 2D.
- [x] **Recorded from a clean clone** made by the documented recipe, so no
      worktree scratch file is on the map. The committed GIF is that take.
- [x] The recipe was run **verbatim**, including from a detached HEAD, and the
      resulting map reports `name: gitnebula`, `defaultBranch: master` and the
      canonical remote — so the demo's "open on github" links point where a
      visitor would browse.

## For the maintainer

- [ ] **AC-6 — read the README as a stranger would.** Open `README.md` top to
      bottom without reading the code, and confirm it describes the product that
      now exists: that the lead question is the one you would actually arrive
      with, that nothing promised is missing when you run it, and that nothing
      the epic shipped is missing from the page.
- [ ] Watch `docs/assets/demo.gif` at README width and confirm it reads as the
      onboarding path rather than as a feature reel.
