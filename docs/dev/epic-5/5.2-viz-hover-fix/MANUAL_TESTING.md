# 5.2 — Manual testing

Everything below was executed on this branch. `- [x]` means it was run and the
observed result is recorded inline; `- [ ]` means it was not, with the reason.

**Machine**: Apple M4 Pro, macOS 26.5.2 (Darwin 25.5.0), Node 22.20.0,
Chromium 151.0.7922.34 headless (Playwright, the copy the repo already
installs for `pnpm --filter @gitnebula/viz perf`).

The Claude-in-Chrome extension was not connected in this environment, so the
browser work below was driven through headless Chromium instead of a hand on a
mouse. Every pointer movement is a real `mouse.move` against a real canvas —
not a call to `setHovered`.

## Setup

```bash
pnpm install
pnpm build                                   # builds viz, then assembles CLI assets
git clone --depth 200 https://github.com/langchain-ai/langgraph.git /tmp/gn52/langgraph
node packages/cli/dist/bin/gitnebula.js build /tmp/gn52/langgraph -o /tmp/gn52/bundle
cd /tmp/gn52/bundle && python3 -m http.server 3002 --bind 127.0.0.1
```

- [x] **The repository the story's baseline was measured on is the one used
      here.** `langgraph` analysed to **662 nodes, 1745 edges, 128 co-change
      pairs** — the spec's "650-node map", give or take the shallow clone depth.
      The header reads `650 files · 178.0k loc · 12 modules · 190 commits`.
- [x] **A second bundle was built from an untouched checkout of
      `origin/epic/5-onboarding` (`9c28344`)** in a separate worktree and served
      on port 8301, so every observation below is a before/after pair against
      the same document on the same machine. A static bundle rather than
      `gitnebula serve`: with five agent worktrees on one host, `serve` picks
      the first free port from 4137 and two of them were already serving
      langgraph. Choosing the port removes any doubt about which build was
      measured.

## 1. The sweep — AC-6's subject, measured rather than eyeballed

A strobing map swings in overall brightness as the pointer crosses it. The
pointer was walked across 90 positions on a horizontal line through the map at
**4.87× zoom** (62 of the 90 landed on a node — the spec's "hit-areas cover 78%
of the viewport" reproduced), reading the mean luminance of the canvas after
each step. Resting luminance is measured at a position the **engine confirms**
is over no node, because a pointer parked under a chrome overlay keeps its last
hover and would otherwise be read as "resting".

| | resting | sweep min | sweep mean | sweep max | swing, % of resting | worst single step |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| before (`9c28344`) | 70.84 | 18.51 | 37.48 | 72.16 | **75.7%** | **71.8%** |
| after (this branch) | 70.13 | 51.49 | 58.34 | 71.99 | **29.2%** | **24.6%** |

- [x] **The map no longer goes dark under the cursor.** Before, a hover took the
      whole canvas down to **26% of its resting brightness**; after, the floor
      is **73%**. The mean during the sweep moved from *below* half of resting
      (37.5) to comfortably above it (58.3).
- [x] **The worst frame-to-frame jump fell from 72% of resting brightness to
      25%** — that jump is the strobe, and it is now a third of what it was.
- [x] **Resting frames are unchanged**: 70.84 before vs 70.13 after (~1%,
      sampling noise). This story changes what a *hovered* frame looks like and
      nothing else.

## 2. The chain is still findable — AC-1

The pointer was parked on the node with the richest one-hop chain a 22 × 12
probe grid could find (`libs/cli/`, chain of 145 with the module unfolded) in
both builds, and a 680 × 520 crop captured around it.

- [x] **After**: the chain's nodes carry a visible ring and a brighter glow, and
      the chain's edges stand out at `EDGE_ALPHA_CHAIN` against the 0.12 rest.
      The surrounding map — module discs, neighbouring files, labels — is fully
      readable at the same time.
- [x] **Before**: the chain is equally identifiable, but everything else is
      essentially black. That is the trade this story reverses: identifiability
      was bought by deleting the map, and it no longer has to be.
- [x] **The hovered node is not confusable with a selected one**: the chain ring
      sits at `screenRadius + 3` px, inside the selection ring's `+5`, and only
      the selected node carries the brighter `0.85` stroke.

## 3. Hover behaviour on the real map

- [x] **Crossing between nodes does not flash the map.** Moving the pointer from
      a node, across background, onto another node holds the previous chain for
      120 ms and swaps it for the new one. Measured in section 1 as the drop in
      the worst single step; asserted deterministically in
      `hover-encoding.test.ts` on the frame clock.
- [x] **Leaving a node restores the map.** With the pointer parked on empty
      canvas, the engine reports `getHovered() === null` and the frame returns
      to resting brightness — that is exactly how the resting figures in
      section 1 were obtained.
- [x] **Hover is suppressed during a pan.** A press at the map's centre followed
      by a 12-step drag across a populated region lit **no new node**: the
      hovered id stayed the one from before the press for all 12 positions
      (`libs/langgraph/langgraph/typing.py`), and the same drag on the base
      build behaves identically. Note what this means and does not mean: a press
      that begins *over* a node carries that node's chain through the gesture,
      because `onPointerDown` does not clear the hover on either build. That is
      story 3.3's behaviour, which AC-2 asks to still hold rather than to
      change; it is pinned by a test and offered as a follow-up in the PR body.
- [x] **The tooltip and the detail panel behave as before.** The tooltip named
      the hovered node (`libs/langgraph/ · churn 100%`), a click opened the
      panel (`#p-isolate` present) and selected that node — byte-for-byte the
      same sequence on the base build.

## 4. Regression pass on the real map

Each item below was executed in the browser on **both** builds, so "unchanged"
is a comparison rather than an assertion.

- [x] **Isolate (story 3.4) is unchanged.** With the map zoomed to ~3×, mean
      canvas luminance at rest was **45.64** (base: 45.60); pressing *isolate*
      on `libs/langgraph/` took it to **32.40** (base: **32.39**) and releasing
      it returned **44.79** (base: 44.82). `aria-pressed` went
      `true` → `false` on both. Isolate still extinguishes the map, to within
      a hundredth of a luminance unit of the build that predates this story.
- [x] **Search arrival (story 3.3) is unchanged**: typing `typing.py` and
      pressing Enter flew the camera (position moved, zoom settled at the
      file's 3.0×) and selected
      `libs/langgraph/langgraph/typing.py` — identical on both builds.
- [x] **PNG export (story 3.5)** still re-renders through the same scene:
      `exportPNG()` returned an `image/png` blob of 5,381 KB (base: 5,401 KB;
      the difference is the ring and the labels this story keeps, which is the
      export doing its job of reproducing what is on screen).
- [x] **Automated suites**: `pnpm --filter @gitnebula/viz test` → **39 files,
      488 tests** pass (36/439 before the rebase onto pamela's 5.3, plus her
      suite and the pan-behaviour test this branch added afterwards).
      `pnpm lint` and `pnpm build` exit 0, and so does the workspace-wide
      `pnpm test` — which is what covers `cli` here, 15 files / 145 tests.
      Note for anyone reproducing: the **`pnpm --filter @gitnebula/cli` form
      matches no project and exits 0** — the package is named `gitnebula` — so a
      cli result quoted from that filter is a run that never happened. Nothing
      in this story rests on it; it is specced separately as
      `5.9-repo-test-command-false-green`.
- [x] **`pnpm --filter @gitnebula/viz perf`**: the fps floor holds (see
      [`PERFORMANCE.md`](PERFORMANCE.md)). One test in that suite,
      `export.pw.ts`, fails **identically on the untouched base checkout** —
      pre-existing, reported, not fixed.

## 5. Reduced motion — AC-5

- [x] **No transition is introduced.** The held chain is the same chain at the
      same alphas for every frame of the hold; nothing interpolates and no drawn
      hover value is a function of elapsed time, so there is nothing for
      `prefers-reduced-motion` to suppress. Asserted in `hover-encoding.test.ts`
      by comparing alphas at t=0 and t=5000 under both settings, and the perf
      suite's `reduced-motion.pw.ts` (canvas byte-identical over time, no settle
      animation, instant fly-to) passes on this branch.

## 6. AC-6 — the human-review item

- [ ] **Sweeping the pointer across a real 650-node map no longer reads as
      strobing, and the chain is still findable at a glance.**
      *Left unticked deliberately: the spec files AC-6 as a human-review item,
      and "reads as strobing" is a judgement a person makes with their own eyes,
      not something a luminance integral can close.* The measurements in
      sections 1 and 2 are the evidence offered towards it — the brightness
      swing is down to 29% of resting from 76%, and the chain is ringed and
      brighter rather than merely last-one-standing — but the call is the
      maintainer's. To reproduce in a real browser:

      ```bash
      pnpm build
      node packages/cli/dist/bin/gitnebula.js /path/to/langgraph
      ```

      then sweep the pointer across the map at 4–6× zoom and hover a module
      with a wide chain, e.g. `libs/cli/`.
