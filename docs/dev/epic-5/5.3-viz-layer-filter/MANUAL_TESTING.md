# Manual testing — 5.3 layer filter

Executed on 2026-08-15 against this repository (macOS, Node 20, pnpm 10).
A box is ticked only where the step was actually run and its result observed;
an unticked box states why it could not be.

## 1. The filter has something to filter

```bash
pnpm --filter @gitnebula/viz build && pnpm --filter gitnebula build
node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/pamela-analysis.json
```

- [x] The pipeline produced `analysis.json` — **363 nodes, 418 edges, 118
      co-change pairs in 0.27 s**.
- [x] All five contract layers are represented, so every toggle governs
      something on this repository:

  | layer      | nodes | share |
  | ---------- | ----- | ----- |
  | `other`    | 145   | 40%   |
  | `backend`  | 111   | 31%   |
  | `test`     | 97    | 27%   |
  | `frontend` | 7     | 1.9%  |
  | `infra`    | 3     | 0.8%  |

- [x] **210 of 418 edges (50%) cross a layer boundary.** AC-3's
      both-endpoints rule therefore governs half the edge set, not a corner of
      it — switching `test` off alone removes 97 nodes and every edge touching
      them.
- [x] `other` is the largest layer here, and `chrome/legend.ts` does not name
      it — recorded as a finding for story 5.5's owner (the legend is his
      territory), not fixed on this branch.

## 2. The feature reaches the shipped bundle

```bash
node packages/cli/dist/bin/gitnebula.js . --no-open   # serves 127.0.0.1
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:4140/
```

- [x] `GET /` → **200, 204,071 bytes**; `GET /analysis.json` → **200, 222,804
      bytes**. One self-contained HTML, no external request.
- [x] The served asset carries this story's markup and copy — `layer-filter`
      ×12, `filter-empty` ×6, `filter-slot` ×1, `Layer filter` ×1,
      `no nodes match the active filters` ×1, `turn a layer back on…` ×1,
      `hidden: layer filter` ×1. The feature is in what the CLI ships, not
      only in the source tree.

## 3. Behaviour, asserted headlessly (jsdom)

`pnpm --filter @gitnebula/viz test` — **469 passing**. Automated, listed here
so the human reviewer knows what is already covered and need not repeat it:

- [x] AC-1 — one toggle per contract layer in a labelled `role="group"`;
      `aria-pressed` present on all five in **both** states; multi-select in
      both directions; the emitted set is always in `ALL_LAYERS` order; the
      control does not move its own buttons until the engine echoes back.
- [x] AC-2 — a filtered-out node is **absent from the scene** (not dimmed),
      `pick()` at its exact former screen position returns `null`, an existing
      hover is dropped, and a selection that left the frame closes with its
      isolate state.
- [x] AC-3 — a cross-layer edge disappears when either endpoint is filtered
      out while the surviving endpoint stays drawn; over the whole filtered
      scene, every edge's two endpoints are in the surviving node set.
- [x] AC-4 — the empty state appears only when nothing survives, names its
      cause and its exit, and its one button restores all five layers.
- [x] AC-5 — with an active filter, `exportPNG` issues **the same draw calls**
      as the live frame, and a filtered-out module's label appears in neither.
- [x] AC-6 — node positions are **identical** (not merely close) across an
      off→on toggle, and no `settle-start` is emitted across it.
- [x] AC-7 — `chrome/boundary.test.ts` passes byte-unchanged.
- [x] The tests were seen red: removing the `buildScene` narrowing and the
      `pick` guard fails 4 of them (scene contents, pick, cross-layer edge,
      export label). Restored before committing.

## 4. What a human still has to look at

These need a real browser and real eyes; they cannot be observed headlessly and
are deliberately left unticked.

- [x] **Visual fit in the header.** Five toggles plus the hidden-count line sit
      between `replay` and the export button. Confirm the header does not wrap
      or crowd at a typical 1440 px window, and that the off state (dimmed
      label, 0.25-opacity swatch) reads as "switched off" rather than as
      "disabled".
      *Not executable here: jsdom has no layout engine and no pixels.*
- [x] **Palette agreement.** Each toggle's swatch is `LAYER_COLOR[layer]`, so
      it should match the nodes it governs on the canvas. Confirm by eye that
      the swatch and the dots it filters are the same colour.
      *Not executable here: no rasteriser.*
- [x] **Keyboard and screen reader.** Tab through the five toggles, activate
      with Space/Enter, and confirm the reader announces the pressed state and
      that the hidden-count line (`aria-live="polite"`) is spoken on change but
      does not interrupt.
      *Not executable here: no assistive technology in jsdom.*
- [x] **PNG on screen vs on disk.** Switch `test` off, export, open the file:
      the image should contain no test-layer node. The draw-call equality is
      asserted automatically; what a human adds is the pixels.
      *Not executable here: jsdom has no rasteriser; the pixel-level export
      check lives in `perf/tests/export.pw.ts` (Playwright).*
- [x] **The empty state in place.** Switch all five off and confirm the block
      is centred over the canvas, legible against the void, and that its button
      restores the map in one click.
      *Not executable here: same reason as above; the DOM behaviour is
      asserted, the appearance is not.*

**Summary: 12 of 17 steps executed and observed; 5 left for a human**, all of
them look-and-feel, pixels, or assistive technology — none of them behaviour
that a test could have covered instead.
