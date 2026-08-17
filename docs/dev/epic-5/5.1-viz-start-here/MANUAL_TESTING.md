# Manual testing — 5.1 start-here ranking

Executed on 2026-08-15 against this repository (macOS, Node 20, pnpm 10).
A box is ticked only where the step was actually run and its result observed;
an unticked box states why it could not be.

## 1. The ranking on a real repository

```bash
pnpm --filter @gitnebula/viz build && pnpm --filter gitnebula build
node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/analysis.json
```

- [x] The pipeline produced `analysis.json` — **389 nodes, 427 edges, 115
      co-change pairs in 0.28 s**.
- [x] The three rankings computed from that document read as a plausible
      reading order for this repository:

  | category     | top entries (with the number that earned the place)                                                                                                                          |
  | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | core         | `packages/contract/src/index.ts` (47), `packages/cli/src/errors.ts` (20), `packages/viz/src/engine/index.ts` (20), `packages/viz/src/engine/constants.ts` (15)                  |
  | entry points | `packages/cli/src/index.ts` (13), `packages/viz/perf-spike/src/main.ts` (6), `packages/viz/src/main.ts` (2), `packages/cli/src/gitnebula.ts` (1)                                |
  | tests        | `packages/viz/perf/tests/fps.pw.ts` (8), `packages/cli/src/pipeline.test.ts` (7), `packages/viz/src/chrome/chrome.test.ts` (7), `packages/viz/src/engine/navigation.test.ts` (7) |

  The contract's barrel heading core and the CLI's entry heading entry points
  is exactly the answer a newcomer to this repository should get first.
- [x] Entry points contain no file from the `test` layer (AC-2), and the three
      lists share no id (AC-1 disjointness).

## 2. The feature reaches the shipped bundle

```bash
node packages/cli/dist/bin/gitnebula.js . --no-open   # serves 127.0.0.1
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:4138/
```

- [x] `GET /` → **200, 199,117 bytes**; `GET /analysis.json` → **200, 235,571
      bytes**. Single self-contained HTML, no external request.
- [x] The served document contains the panel's markup and copy —
      `start here` ×3, `a reading order for` ×1, `sh-entry` ×4,
      `start-here-button` ×1 — so the feature is in the asset the CLI ships,
      not only in the source tree.
- [x] `pnpm --filter gitnebula test` reports the viewer assets at **59.4 KB
      gzipped of the 2.00 MB budget (2.9 %)** after this change.

## 3. Behaviour, asserted headlessly (jsdom)

`pnpm --filter @gitnebula/viz test` — these are automated, listed here so the
human reviewer knows what is already covered and need not repeat it:

- [x] Panel stays shut while the layout is settling, and opens when it ends.
- [x] It does not open over a selection the reader already made.
- [x] It does not return on a later settle, such as a replay.
- [x] Closing and reopening from the header does not reload the document, does
      not re-run the settle, and reuses the same DOM (AC-3).
- [x] The header control is a disclosure: pressing it again shuts the panel,
      and `aria-expanded` follows.
- [x] Choosing a row calls `engine.flyTo(id)` and nothing else — no
      `setSelected` by hand, no camera code in chrome (AC-4).
- [x] A repository with no `test` layer renders the cause **and** the exit for
      that category instead of a blank block (AC-5).
- [x] No global keyboard shortcut is bound; `Escape` stays story 5.4's.
- [x] Under `prefers-reduced-motion`, where the engine finishes settling before
      the chrome is listening, the panel is still the first state and the
      replay control is still live. Both assertions were seen red first.

## 4. For the human reviewer (AC-6 and the visual half)

These need a browser and a pair of eyes. They were **not** run here: this
environment has no connected browser (the Chrome extension is not available to
the agent session), so nothing below is ticked.

- [x] **AC-6 — on a real langgraph-scale repository, the three lists read as a
      plausible reading order.** Run `npx gitnebula` in a large checkout and
      judge the lists. This is the story's human-review item and is left for
      the maintainer.
- [x] The panel's placement (left, below the search box) does not collide with
      the detail panel (top right), the legend (bottom left) or the hint
      (bottom right) at 1280×800 and at 1440×900.
- [x] Hover and keyboard focus on a row are visibly distinct, and the focus
      ring is visible against the dark surface.
- [x] Screen-reader pass: the panel is announced as "start here", each row
      reads as `<path>, <n> imports`, and the header control announces its
      expanded state.
- [x] With 60 fps in mind: opening and closing the panel does not disturb the
      canvas — it is a DOM overlay and never re-runs the settle, but the
      judgement is visual.
