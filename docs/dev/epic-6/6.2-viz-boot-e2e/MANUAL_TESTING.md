# Manual testing — story 6.2

Every step below that can be executed headless **was executed**, and the
observed result is recorded inline. AC-8 is a human-review item and stays
unticked, with its reason stated.

Ran **7 of 8** steps. Step 8 is the owner's.

## Setup used for steps 2-6

The `ui` suite pins the 6-node `root-files` fixture, which is right for a test
and wrong for judging how the view switch *feels*. AC-8 asks for "a real
repository's map", so these steps ran against **gitnebula analysing itself**:

```bash
node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/real-analysis.json
# → 485 nodes, 602 edges, 195 co-change pairs, history over the last 90 days

cd packages/viz
GITNEBULA_FIXTURE=/tmp/real-analysis.json pnpm vite --port 4351 --strictPort
```

Viewport 1440x900, DPR 1, headless Chromium — the same geometry the `ui` suite
uses, so the numbers below are comparable to it.

---

- [x] **1. The suite passes.**
      `UI_PORT=4321 pnpm --filter @gitnebula/viz ui`
      → **12 passed** (9 mine, 3 story 6.1's smoke), 16.6 s.
      `UI_PORT` is not decoration: 6.1's config sets `--strictPort` and
      `reuseExistingServer: false`, so two worktrees running at once fail
      loudly instead of one silently measuring the other's code.

- [x] **2. A real repository's map boots in 2D.**
      Opened `http://localhost:4351/`.
      → repo `gitnebula`, **485 nodes**, 2D engine, `2D` pressed / `3D` not
      pressed, the 3D button **offered** (enabled, no reason attached).
      The nebula rendered with `packages/`, `docs/`, `test-fixtures/`,
      `scripts/` as labelled module discs. No console errors.

- [x] **3. A frame built in 2D survives the swap to 3D.**
      Set heat mode, layer filter `[backend, infra]`, connected-only on, and
      selected `packages/viz/src/app.ts`. Clicked `3D`.
      → 3D engine running, `3D` pressed / `2D` not pressed, and **every field
      carried**: `mode=heat`, `layers=[backend,infra]`, `connectedOnly=true`,
      `selected=packages/viz/src/app.ts`. The header still read
      "358 nodes hidden: layer filter" and the scope bar "19 nodes hidden: no
      dependencies"; the selection panel stayed open on `app.ts` with its blast
      radius intact.

      *Observation, not a defect.* With that filter the canvas is empty — but it
      is **equally empty in 2D**, before the swap. 358 of 485 nodes are removed
      by the layer filter and the survivors sit outside the current camera,
      which does not refit on a filter change by design (filtering is a frame
      concern; positions do not move, story 5.4 AC-4). The two views agreeing is
      the property under test, so this is correct behaviour and merely a poor
      screenshot. Step 4 exists because of it.

- [x] **4. The same swap with a frame that leaves the map visible.**
      Re-ran with heat mode and a selection only, after `fit()`:
      `packages/viz/src/engine/engine.ts` selected.
      → 2D: `mode=heat`, selected `engine.ts`, camera `k=0.74`.
      → after clicking `3D`: 3D engine, `mode=heat`, **same selection**, camera
      `k=3.50`. The full nebula rendered with depth, hot spots in orange, the
      panel open on `engine.ts` with its 11-commit blast radius.
      → after clicking `2D`: back to the 2D engine, `mode=heat`, same
      selection, and the camera **returned to exactly
      `k=0.7359860716109371`, `x=8.287331657394986`, `y=-6.682981383283703`** —
      identical to before the round trip, to the last digit. Both layouts are
      seeded from the document (AD-6), so the map returns to itself.
      No console errors at any point.

- [x] **5. `?view=3d` opens straight into 3D.**
      Opened `http://localhost:4351/?view=3d`.
      → 3D engine, `3D` pressed / `2D` not pressed, 485 nodes. This is the URL
      the perf harness and a human both use to reproduce a 3D run.

- [x] **6. A click at real screen coordinates selects what it is aimed at.**
      Measured the stage canvas: **top offset 103 px** below the header.
      Scanned with `pick()` for a node, aimed at `pr-summary.approved` at canvas
      point (729, 84), clicked at page point (729, 187).
      → `getSelected()` returned `pr-summary.approved`. The aim matched.
      (That node exists because the directory analysed is this agent worktree,
      which carries harness scratch files. Harmless here.)

- [x] **7. The suites that must not regress.**

      | command | result |
      | --- | --- |
      | `pnpm lint` | pass — eslint clean, "All matched files use Prettier code style" |
      | `pnpm test` (whole workspace) | pass — viz 827/827, cli 145/145, tooling checks all ok |
      | `pnpm --filter @gitnebula/viz test` | **827 passed**, 56 files |
      | `pnpm --filter @gitnebula/viz perf` | **10 passed**, 1.4 min — 119 fps sustained frozen pan/zoom, 91 fps unfold+pan, against a 55 fps floor |
      | `pnpm --filter @gitnebula/viz ui` | **12 passed** |
      | `pnpm build` | pass — viz `dist/index.html` 253.93 kB (72.90 kB gzip); cli bundle built |

- [ ] **8. (AC-8, human review) Watching the swap by eye on a real
      repository's map.** — **for the owner, deliberately unticked.**
      Not tickable by me. Steps 3-5 prove the state carries and the control
      agrees with the engine, and the map renders coherently in both views; what
      they cannot establish is whether the transition *reads* right to a
      person — whether the 3D map is recognisably the same map from another
      angle, whether the switch feels instant, whether the selection staying put
      is reassuring or jarring. That is a judgement, and the project's rule is
      that criteria which cannot be verified automatically are human-review
      items.

      To reproduce in a real window:

      ```bash
      node packages/cli/dist/bin/gitnebula.js . --no-serve -o /tmp/real-analysis.json
      cd packages/viz
      GITNEBULA_FIXTURE=/tmp/real-analysis.json pnpm vite --port 4351 --strictPort
      # open http://localhost:4351/ , select a node, click 3D, click 2D
      ```

      Or watch the suite itself against a real window:
      `UI_HEADED=1 UI_PORT=4321 pnpm --filter @gitnebula/viz ui`.

## Accessibility notes observed while testing

Not new assertions — story 5.7 owns the control and epic 5 owns its
accessibility — recorded because they were visible during the walkthrough and a
reviewer may want them:

- The view switch is a `role="group"` labelled "Map view" holding two
  `aria-pressed` buttons: the repository's established segmented-control
  pattern, the same one the mode toggle and the layer filter use.
- `aria-pressed` tracked the engine that was actually **built** in every swap
  above. That is the AC-5 property, and it is asserted mechanically in
  `ui/tests/view-swap.pw.ts` rather than resting on this observation.
- When 3D is unavailable the button is disabled **with the reason attached**
  rather than hidden: `aria-disabled`, the reason in a `role="status"` element
  referenced by `aria-describedby`, and the same text as the `title`. Exercised
  in the AC-5 constructor-throw test, where the reason read
  "The 3D view could not be started (viz: canvas 2D context unavailable).
  Showing the 2D map instead."

## Nothing was left behind

The walkthrough scripts ran from the scratchpad and were deleted; the generated
`analysis.json` is outside the repository. `git status` after the run shows only
this story's new files, and `git diff` against the base for `packages/viz/src/`
is empty.
