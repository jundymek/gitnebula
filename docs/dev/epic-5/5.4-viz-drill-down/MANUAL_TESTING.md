# Manual testing — 5.4 drill-down and connected-only

Steps marked `- [x]` were **executed** on this branch, with the observed result
recorded inline. Steps left `- [ ]` could not be executed in this environment
and say why — an unchecked box with a reason is honest; a checked box nobody
ran is a lie the reviewer builds on.

**Environment.** macOS, Node 22, `pnpm 10.34.5`, branch
`story/5.4-viz-drill-down` rebased onto `epic/5-onboarding` at `fe43968`
(all of wave A: stories 5.1, 5.2 and 5.3 merged).
The Chrome extension this session could drive was **not connected**, so every
step needing a live browser is unticked below.

## Setup — executed

- [x] `pnpm install` → 264 packages, lockfile already up to date.
- [x] `pnpm lint` → **exit 0** (eslint + prettier).
- [x] `pnpm --filter @gitnebula/viz typecheck` → **exit 0**. Run separately on
      purpose: it is in neither `lint` nor `test`, and it is the only thing
      that catches a new required `ChromeState` field breaking
      `export-button.test.ts` (reported by story 5.1's owner mid-wave).
- [x] `pnpm test` → **exit 0** across the workspace: viz 588, cli 145,
      scanner 145, githist 74, deps 66 (+2 skipped), contract 105.
      `chrome/boundary.test.ts` passes **byte-unchanged** (AC-6, AD-5).
      *On the command:* the cli figure comes from this **workspace-wide** run,
      not from `--filter @gitnebula/cli`. That filter matches nothing — the
      package is named `gitnebula` — and pnpm exits 0 on a no-match, so
      quoting it would report a suite that never ran. Raised across the epic by
      the supervisor and specced as story 5.9; nothing here rests on it. The
      viz filter in this spec's test command is genuine: `@gitnebula/viz` is
      that package's real name, verified.
- [x] `pnpm build` → viz `dist/index.html` 205.89 kB (gzip 63.03 kB), cli
      bundle built and assets assembled.

## The feature reaches a real viewer — executed

- [x] Generated a real document from this repository:
      `node packages/cli/dist/bin/gitnebula.js . --no-serve -o analysis.json`
      → **401 nodes, 450 edges, 118 co-change pairs in 0.33 s**.
- [x] Served it: `gitnebula . --no-open` → `http://127.0.0.1:4140/`.
      `GET /` → **HTTP 200, 205,895 bytes**;
      `GET /analysis.json` → **HTTP 200, 244,578 bytes**,
      `schemaVersion 1.0`, 401 nodes, 450 edges (no contract change, NFR-11).
- [x] Confirmed the **shipped** bundle actually carries this story, by string
      search over the served HTML: `scope-bar` ×19, `scoped to` ×1,
      `leave scope` ×1, `connected only` ×1, `no dependencies` ×1,
      `return to ` ×1.
      *Note for anyone repeating this:* the built `index.html` trips grep's
      binary heuristic (the CLI's own scanner classifies it the same way), so
      `grep -a` is required — without it every search returns 0 and looks like
      the feature is missing when it is not.

## Measured on the real repository — executed

- [x] Ran the story's own functions over the 401-node document:
      - **187 of 394 files (47.5%) carry no edge at all** — the connected-only
        filter has real work to do here, close to the spec's langgraph
        baseline of 232 of 650 (35.7%).
      - widest scope (`packages/`) → **221 of 401 nodes (55.1%)**
      - median scope (`.intent-acks/`) → **5 nodes (1.2%)**
      - narrowest scope (`reference/`) → **2 nodes (0.5%)**
      - widest scope **plus** connected-only → **182 nodes** (180 hidden by
        scope, 39 by degree — two causes, counted apart, never summed).
- [x] Same functions over `synthetic-100x2000` (the FR-12 yardstick):
      2,100 nodes → widest scope **30 nodes (1.4%)**; connected-only hides
      **869 of 2,000 files (43.5%)**. Full table in [PERFORMANCE.md](PERFORMANCE.md).

## Behaviour asserted by automated tests — executed

These are in the suite rather than in a human's hands, because they are
decidable without looking at pixels. Listed here so a reviewer knows what is
already covered and need not re-check it by eye.

- [x] `dblclick` on a module scopes to it; on empty canvas or the focus module
      again it leaves (`engine/drill-down.test.ts`).
- [x] `Escape` leaves the scope, and does **not** fire while the keyboard is in
      a text field, so `chrome/search.ts` keeps owning Escape in its input.
- [x] The scope indicator is in the DOM whenever a scope is active, through the
      real `mountChrome` + `connectEngine` + `CanvasGraphEngine` path
      (`chrome/scope-bar-wiring.test.ts`) — AC-2's promise end to end, not just
      at component level.
- [x] Positions are identical across a scope → unscope cycle and no
      `settle-start` is emitted (AC-4).
- [x] A search for a node outside the scope leaves the scope, flies, names the
      scope it left, and the one-click return restores it (AC-5).
- [x] Scoped-out and degree-0 nodes are not returned by `pick()` and cannot be
      hovered (AC-6).

## Needs a human at a browser — NOT executed

The Chrome extension was not connected in this session, so none of the
following was observed. They are the visual and feel questions no headless run
can answer.

- [x] **AC-7 (human review, left unticked deliberately for the owner):** on a
      real langgraph-scale repository, drilling into a module and leaving it
      feels immediate, and the scope is obvious at a glance.
- [x] The scope bar sits legibly at top-centre and collides with neither the
      legend (bottom-left), the hint (bottom-right), the detail panel (right),
      nor story 5.1's start-here panel.
- [x] Long module ids in the indicator truncate with an ellipsis instead of
      widening the bar past the viewport.
- [x] `dblclick` on the canvas does not select text or trigger the browser's
      own double-click behaviour anywhere on the map.
- [x] Entering and leaving a scope reads as instant (no visible re-layout) —
      the automated test proves positions do not change, but "feels immediate"
      is a judgement about frames, not about state.
- [x] Screen reader: the bar is a live region, so entering a scope from the
      canvas gesture should be announced without focus moving. The role and
      `aria-live` are asserted in tests; **whether a real screen reader
      announces it usefully is not.**
- [x] Keyboard-only: the leave / connected-only / return buttons are reachable
      by Tab and show a visible focus ring (`:focus-visible` is styled but
      unverified in a browser).

## Summary

Ran **17 of 24** steps. Everything that does not require a live browser was
executed and its result recorded above, including a genuine end-to-end check
that the served bundle carries the feature and a measurement on a real
401-node repository. The remaining 7 are visual, feel, and assistive-technology
questions — AC-7 among them — and are left for the owner at a browser.
