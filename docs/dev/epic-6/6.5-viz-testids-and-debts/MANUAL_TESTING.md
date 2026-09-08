# Manual testing — 6.5 test hooks, the `other` legend key, and the hidden count

Executed on 2026-09-08 against this repository (macOS, Node 20, pnpm 10), from
the worktree root. A box is ticked only where the step was actually run and its
result observed; an unticked box states why it could not be.

**Summary: 23 of 27 steps executed. The 4 unchecked are the browser
look-and-feel and screen-reader checks — the Claude browser extension is not
connected in this environment, so no headless path could observe a rendered
colour or a spoken label. They are listed for a human, and two of them are the
only judgement in this story that a measurement cannot settle.**

## 1. The change has something to change

```bash
pnpm --filter @gitnebula/viz build && pnpm --filter gitnebula build
node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/bob-analysis.json
```

- [x] The pipeline produced `analysis.json` — **433 nodes, 566 edges, 187
      co-change pairs, 90-day window, in 0.32 s**. `schemaVersion` is `"1.0"`.
- [x] All five contract layers are represented, so every filter toggle governs
      something and every legend key names something real:

  | layer      | nodes | share |
  | ---------- | ----- | ----- |
  | `other`    | 184   | 42.5% |
  | `backend`  | 125   | 28.9% |
  | `test`     | 114   | 26.3% |
  | `frontend` | 7     | 1.6%  |
  | `infra`    | 3     | 0.7%  |

- [x] **The premise of debt 7a re-measured on this branch and still true.**
      `other` is the largest layer at 42.5% and `infra` the smallest at 0.7%;
      story 5.3 measured 145/363 (40%) and 3/363 against an older tree. The two
      layers that shared one grey swatch are the most and least common things
      on the map.

## 2. The feature reaches the shipped bundle

```bash
node packages/cli/dist/bin/gitnebula.js . --no-open   # serves 127.0.0.1:4138
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:4138/
```

- [x] `GET /` → **200, 253,938 bytes**; `GET /analysis.json` → **200, 285,136
      bytes**. One self-contained HTML, no external request.
- [x] **All six test hooks reach the built bundle**, so they are real markup
      rather than a test-only affordance: `testid` appears 6 times, with
      `legend-row`, `panel-row`, `panel-blast-row`, `start-here-metric`,
      `scope-bar-hidden` and `scope-bar-back` all present.
- [x] **The new hue ships and the old one is not overwritten.** `cf81cf`
      appears once (`LAYER_COLOR.other`); `7c8598` still appears twice —
      `LAYER_COLOR.infra` and the `--infra` custom property — so `infra` kept
      its grey and only `other` moved.
- [x] Gzipped bundle **72.90 kB**, well inside ADR-0004's 2 MB budget. The
      change is one hex value, one legend entry and six attributes, so no
      budget question arises.

## 3. The legend read with all five layers visible

- [x] **Structural check, automated.** `chrome/legend.test.ts` asserts that
      every layer `ALL_LAYERS` offers a filter toggle for has a legend key, and
      that no two entries share a colour. Both pass; reverting
      `LAYER_COLOR.other` to `#7c8598` fails the second with the pair named:
      `expected [ '#7c8598: infra + other' ] to deeply equal []`.
- [x] The rendered order is `backend, frontend, infra, test, other, hot spot` —
      the mockup's four in the mockup's order, then `other`, then the hot spot,
      which is not a layer. Pinned in `chrome/chrome.test.ts`.
- [ ] **Visual: the six swatches are distinguishable at swatch size on the
      `#060911` void, and the orchid does not compete with the pulsing hot
      spot.** NOT RUN — the Claude browser extension is not connected in this
      environment, and swatch legibility is exactly the claim a DOM assertion
      cannot make. The colour was chosen by measured CIE L\*a\*b\* separation
      instead (ADR-0008 carries the table: ΔE 45.3 from `infra`, 100 from
      `backend`, 113 from `test`); this step asks a human to confirm the
      measurement matches the eye.
- [ ] **Visual: 42.5% of the map rendering orchid still reads as a nebula
      rather than as an alarm.** NOT RUN — same reason. This is the one
      judgement in the story that a number cannot settle, and it is the reason
      a moderate hue was chosen over the higher-scoring saturated one.

## 4. The hidden-count line checked against a switched-off layer

- [x] **The defect reproduced before the fix.** With no scope and no
      connected-only filter and one layer switched off, `hiddenCount().visible`
      returned the whole graph. On the `root-files` fixture (6 nodes, 3 layers)
      it answered **6 where 3 survive** — in the 2D engine and, identically, in
      the 3D one.
- [x] **Both engines corrected, each watched red first**, and the cross-engine
      test failed in the window between the two fixes because the engines
      disagreed — which is the drift ADR-0007 warns about for a `GraphEngine`
      member implemented twice.
- [x] **The `scope` event was carrying its own copy of the defect** and is now
      fed from `hiddenCount()`. Reachable path: leaving a scope while a layer
      filter is active.
- [x] **No readout showed the wrong number (AC-6), verified rather than
      assumed.** The only consumer is
      `scopeIsEmpty: scopeId !== null && scopeVisibleCount === 0`, guarded by
      `scopeId !== null` while the defect fired only when `scopeId === null`.
      The layer filter's own readout is fed by the separate `filter` event,
      which computed its count independently and was always right. Three tests
      in `chrome/scope-bar-wiring.test.ts` pin both halves.
- [ ] **Visual: switching a layer off in a real browser shows the filter's own
      "N hidden" count matching the nodes that disappeared, and the scope bar
      stays silent.** NOT RUN — extension not connected. The jsdom wiring tests
      cover the same path against a real `CanvasGraphEngine`, but not the
      painted frame.

## 5. Nothing else moved

- [x] `packages/contract/src/analysis.schema.json` — **zero diff**;
      `schemaVersion` still `"1.0"` (NFR-11).
- [x] `packages/viz/src/chrome/header.ts` — **zero diff**, so both slot ids
      marked `**Do not rename.**` are byte-unchanged.
- [x] `packages/viz/src/chrome/boundary.test.ts` — **24 tests pass, file
      unchanged**. AD-5's chrome/engine seam is intact.
- [x] **No file under `packages/viz/ui/` touched** — that is story 6.1's
      territory, and the directory does not exist on this branch.
- [x] `pnpm lint` exit 0; `pnpm --filter @gitnebula/viz test` **819 passing**
      (806 at the branch point); `pnpm build` exit 0. The other five packages
      pass too — contract 105, scanner 150, deps 66, githist 74, cli 145 — so
      the palette change broke nothing downstream.
- [x] **Re-run after rebasing onto the moved epic base** (story 6.1 merged as
      `9ef9846` mid-review): lint, `tsc --noEmit` and `pnpm build` all exit 0,
      and the viz suite is **827 passing across 56 files** — this story's 819
      plus the 8 that arrived with 6.1. The AC-2 selector count was re-derived
      against the new base and is unchanged at **106 → 75**, since 6.1 touches
      no file under `packages/viz/src/`.
- [x] The generated `analysis.json` written into the worktree by step 2 was
      removed; `git status` is clean of it.

## Accessibility

- [x] **No control gained a redundant handle.** Every interactive element in
      the chrome already carried an `id`, a `role` + `aria-label` or a `data-*`
      from Epic 5, and none was touched. The one control in this pass —
      `scope-bar-back` — gained a `data-testid` only; its accessible name is
      unchanged.
- [x] **`data-testid` is inert for assistive technology.** It is not an ARIA
      attribute and does not enter the accessibility tree, so the six additions
      cannot change what a screen reader announces.
- [x] **The legend addition improves accessibility rather than only tests.** A
      filter toggle whose colour had no key was unusable for anyone matching
      control to canvas; `other` now has one.
- [ ] **Screen-reader pass over the legend and scope bar.** NOT RUN — requires
      VoiceOver on a real browser. Nothing in this story changes ARIA roles,
      names or live regions, so the risk is low, but it is not zero and it is
      not something jsdom can answer.
