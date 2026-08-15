# MANUAL_TESTING — 5.7 3D view

Steps marked `- [x]` were **executed on this branch** and carry the result
observed. Steps left `- [ ]` could not be run headless and state why; **AC-8 is
deliberately left unticked for the maintainer**, since it is a judgement about
whether the view is worth switching to and no automated run can answer it.

## How to run it

```bash
pnpm install
pnpm --filter @gitnebula/viz dev
```

Then open:

- **2D (default):** <http://localhost:5173/>
- **3D:** <http://localhost:5173/?view=3d>

The dev server serves the committed 100-module / 2,000-file fixture at
`/analysis.json`, so what you see is the same document the perf numbers were
measured on. `GITNEBULA_FIXTURE=root-files pnpm --filter @gitnebula/viz dev`
swaps in a smaller one.

Steps M1–M7 below were executed against this dev server through Playwright
(Chromium 151, 1440 × 900, DPR 1), driving the real page rather than a stub.

## Executed

- [x] **M1 — 2D is the default.** Opened `/`. The engine has no
      `getOrientation`, i.e. it is `CanvasGraphEngine`; the header's `2D`
      button reports `aria-pressed="true"`. 2,100 nodes loaded.
      **Observed:** `is3D: false`, `2D aria-pressed: true`. ✅
- [x] **M2 — `?view=3d` opens the 3D view.** Opened `/?view=3d`.
      **Observed:** `is3D: true`, initial orientation
      `{yaw: 0.884, pitch: -0.128}`, `3D` reports `aria-pressed="true"`. ✅
- [x] **M3 — the switch swaps the engine at runtime, both ways.** From `/`,
      clicked `3D`, then clicked `2D` again.
      **Observed:** the published engine gained `getOrientation` after the
      first click and lost it after the second — the engine is genuinely
      rebuilt, not a mode flag. No page error either way. ✅
- [x] **M4 — the 3D canvas actually draws.** Waited 2.5 s after settle and
      sampled the canvas pixels, counting anything that is not the void
      (`#060911`).
      **Observed:** 122,638 of 1,147,680 pixels non-void (**10.7 %**). Not a
      blank canvas. Screenshot inspected: the cloud reads as a volume, near
      nodes are visibly larger and brighter than far ones, module labels are
      budgeted and do not overprint. ✅
- [x] **M5 — determinism (AC-2).** Loaded `/?view=3d` twice in one session and
      compared the seeded initial orientation and the first five node
      positions.
      **Observed:** identical on both loads — orientation
      `{yaw: 0.8840785212361602, pitch: -0.1281053403625265}` twice, positions
      equal. ✅
      **Note:** an earlier version of this step compared `getOrientation()` and
      saw yaw differ by 0.0016 rad between loads. That was idle auto-rotation
      advancing the live camera between load and read — one frame of drift, not
      a seeding defect. The engine now exposes `getInitialOrientation()`, which
      is the pose AC-2 is actually about, and that is what this step compares.
- [x] **M6 — reduced motion (AC-6).** Opened `/?view=3d` in a context with
      `prefers-reduced-motion: reduce`, then waited 1.5 s.
      **Observed:** `isAutoRotating(): false`; settle reported
      `{frames: 193, durationMs: 0}` — i.e. already settled, no entry
      animation; orientation identical before and after the wait, so nothing
      rotated. ✅
- [x] **M7 — hover and selection go through the same events.** Subscribed to
      `select` and `hover` on the 3D engine and set both.
      **Observed:** `events: ["select", "hover"]`, `selected: "mod-000/"`. The
      same events chrome already listens to, from the second implementation. ✅
- [x] **M8 — the 2D view's behaviour is unchanged.** `git diff` against the
      epic base for `packages/viz/src/engine/{engine,layout,render,camera}.ts`
      and every 2D test file.
      **Observed:** `layout.ts`, `render.ts` and `camera.ts` unchanged; every
      existing 2D test file unchanged; `chrome/boundary.test.ts` **zero-line
      diff** and passing. `engine.ts` carries **+13 lines and 0 changed
      lines** — the additive `setReturnScope` the maintainer approved in review
      round seven. No existing 2D code path is modified. ✅
- [x] **M9 — the whole suite and the toolchain.**
      **Observed:** `pnpm --filter @gitnebula/viz test` → **708 passed**;
      `pnpm lint` → clean; `pnpm build` → succeeds;
      `pnpm --filter @gitnebula/viz perf` → 9 passed. ✅
- [x] **M10 — bundle budget (AC-4).** Built and measured.
      **Observed:** 70,814 B gzipped against a 2,097,152 B budget — **3.37 %**,
      up from 3.13 % on the epic base (measured after rebasing onto the epic
      with 5.6 merged). `packages/cli`'s 17 budget tests pass.
      See [PERFORMANCE.md](PERFORMANCE.md) §2. ✅

## For a human, at a real machine

These need eyes, a pointer, or assistive technology, and are honestly not
answerable from a headless run.

- [ ] **AC-8 (human review, the story's own) — on a real dense repository,
      does depth separate clusters that overlap in the plane, and is the 3D
      view worth switching to?** Run `npx gitnebula` in a large checkout (the
      brief suggests something on the scale of langgraph), open the result,
      switch to 3D and orbit it. The question is not "does it render" — M4
      settles that — but whether the third dimension *tells you something the
      2D map does not*. **Left unticked for the maintainer; this is the
      story's stated human-review item.**
- [ ] **Drag feel.** Rotate by dragging, pan with shift-drag, zoom with the
      wheel. Does the rotation track the pointer at a sensible rate, and does
      the pitch clamp stop short of tumbling? *(Not run: pointer feel is not
      observable from synthetic events.)*
- [ ] **The switch's pressed state, visually.** With the map open, confirm the
      selected view is legibly highlighted in the header. It relies on the
      shared `.modes button[aria-pressed="true"]` rule, which this story reuses
      rather than adding new CSS for — `styles.css` belongs to another story
      this wave. *(Not run: a colour-contrast judgement.)*
- [ ] **Screen reader.** With VoiceOver or NVDA, tab to the view switch. It
      should announce a group labelled "Map view" and two toggle buttons with
      their pressed state. With 3D unavailable it should also announce the
      reason, which is wired through `aria-describedby`. *(Not run: no
      assistive technology in this environment.)*
- [ ] **Real unavailable-3D machine.** AC-5's path is covered by a test that
      simulates it, and by the probe. Seeing it on a machine that genuinely
      refuses a canvas context (a hardened browser profile, an aggressive
      privacy extension) would confirm the reason text reads sensibly in situ.
      *(Not run: no such machine here.)*

## Summary

**Ran 10 of 15.** The five outstanding items are a visual/UX judgement
(AC-8, the story's own human-review item), drag feel, a colour-contrast check,
a screen-reader pass, and confirmation on a genuinely 3D-hostile machine —
each stated above with its reason. Everything mechanically checkable on this
branch was executed and passed.
