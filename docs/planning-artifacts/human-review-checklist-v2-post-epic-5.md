# Human-review checklist v2 — post-Epic-5

**Supersedes [`human-review-checklist.md`](human-review-checklist.md)** (frozen
`9757de4`, 2026-08-10), and only where stated below. Written 2026-09-05 from
the findings of
[`epic-5-retrospective.md`](../implementation-artifacts/epic-5-onboarding/epic-5-retrospective.md)
observations 13 and 14.

The v1 file predates Epic 5 by five days. It is not wrong about the MVP it was
written for, and it is not rewritten here: it stays exactly as it is, as the
record of what the MVP's owner gate asked for. This file is the list to walk
**from now on**. Where an item's wording is unchanged it is repeated here so
that one document can be walked end to end — the same reason the v1 file exists
as one collection point rather than as criteria scattered across specs
(PRD §13.2.5).

## What changed against v1, and why

| # | v1 item | disposition |
| --- | --- | --- |
| 1 | *"Hover dim/highlight reads instantly at 2,000 files"* | **Superseded.** Story 5.2 replaced dimming with additive chain emphasis: the old encoding dimmed 647 of 650 nodes and deleted 425 of 467 file labels the moment the pointer touched a node. An item asking whether the dimming reads well now asks about behaviour the product deliberately does not have. Replaced by item **V4** below. |
| 2 | *"Map-of-itself on Pages is current with master"* | **Carried unchanged, still unwalkable.** Pages is story `4.2-ci-pages-recipe`, deferred on GitHub Actions billing. It stays on the list so the gap stays visible. |
| 3 | everything else | **Carried unchanged.** |

**Added:** nine items for the Epic 5 features (FR-26..FR-33), which v1 could not
have contained, and one for the 3D view's NFR-13 evidence. Epic 5 shipped eight
user-visible behaviours and the canonical checklist had an item for none of
them.

## How to walk this list

Check an item only with the evidence named, exactly as v1 required. Two rules
this project learned the hard way:

- **An unticked item with a written reason is a result, not a failure.** Epic 5
  left four manual-testing items unticked across nine files — a non-UTF-8
  filename APFS refuses to create, a WebGL-less machine, a global
  `npm install -g`, and one "felt in a browser" — and each records why. That is
  the honest-partial discipline. Do not tick to tidy up.
- **Record where you walked it.** Epic 5's walk happened (34 boxes ticked on
  2026-08-17, commit `f8c9a71`) and this file has no record of it, because the
  walk went into the per-story `docs/dev/epic-5/*/MANUAL_TESTING.md` files
  instead. A walk that leaves no mark on the collection point is a walk the
  next epic cannot build on.

---

## Per demo repo (fastapi @ pinned SHA, excalidraw @ pinned SHA, streamlit @ pinned SHA)

- [ ] Map loads crash-free from `npx gitnebula` (record timing; ≤ 60 s — SM-1)
- [ ] The module map is _visually sensible_: recognizable top-level structure,
      no absurd giant/orphan nodes, no obviously wrong layer colours (FR-9)
- [ ] Layer assignment spot-check: 5 files per repo, rule table verdict matches
      human judgement (ADR-0002)
- [ ] Hot spots point at plausibly active areas (sanity vs `git log` — ADR-0003)
- [ ] Unresolved-import rate recorded and ≤ 20% (FR-11)
- [ ] **No single node dominates the canvas.** Story 5.12's rule drops data
      files over 5,000 lines; confirm no remaining node reads as "one enormous
      disc with the real modules as specks around its edge", and that the
      `data-blob` warning names what it dropped (FR-9, 5.12)

## Onboarding: does the map answer "where do I start reading this?" (FR-26, FR-31)

- [ ] **The start-here `core` list is the five files you would actually hand a
      newcomer.** Ranked by `importers × lines of code` since 5.11 — the metric
      exists because in-degree surfaced four barrels and a fixture helper,
      ~342 lines of `export * from`, while the 1,694-line engine never
      appeared. This item is the one that catches a wrong ranking hypothesis,
      which no test can (retrospective observation 1)
- [ ] Entry points and tests-as-documentation lists read as their names promise
- [ ] **Every history metric states the window it covers**, and "no change in
      window" is visibly distinguishable from "no data" (FR-31). On a repo with
      little recent history, absence reads as absence rather than as zero

## Exploration: filtering and drill-down (FR-28, FR-30)

- [ ] **Layer filter:** excluded layers are not drawn, not hoverable, not
      pickable, and each toggle's state is legible at a glance
- [ ] **Every layer toggle has a legend key.** `other` is the largest layer on
      this repository (145 of 363 nodes) — confirm its swatch is
      distinguishable from `infra`'s (retrospective debt 7a)
- [ ] **Drill-down:** double-click scopes to a module and `Escape` leaves it;
      the way back out is offered without describing something that did not
      happen
- [ ] **Connected-only** hides edgeless nodes and names its cause; the count of
      what is hidden is honest about *why* — scope and degree reported
      separately, never as one total

## Blast radius (FR-27)

- [ ] Co-change partners in the panel read as "things that change together"
      to someone who has not read the schema, and the empty state names why it
      is empty. The empty state is the majority case — 330 of 384 nodes on this
      repository — so it must not read as a failure

## 3D view (FR-32, NFR-13)

- [ ] **Is the 3D view worth switching to?** Epic 5's AC-8, left explicitly
      unticked at closure. The cost is published rather than buried: 28 → 22 fps
      on the unfolded 2,000-node fixture, knee between 840 and 1,260 drawn nodes
      (`docs/dev/epic-5/5.7-viz-3d-view/PERFORMANCE.md`). This is a judgement
      about whether the depth pays for the frames, and only the owner makes it
- [ ] Switching 2D↔3D carries state over without losing the scope, the
      selection or the way back out
- [ ] Rotation never carries the cloud far enough past the edge to lose a
      module (measured worst case 45.9 px of 800, asserted at 7%)

## Visual fidelity vs `reference/mockup.html` (SM-6, non-automatable half)

- [ ] Overall nebula impression matches: glow quality, edge curvature, star
      density, dark-void depth (side-by-side eyeball)
- [ ] Settle animation _feels_ like the mockup's (the 2–3 s number is
      automated; the character of the motion is not)
- [ ] Hot-spot pulse reads as a pulse, not a blink
- [ ] **V4 — Hover reads instantly at 2,000 files and marks the chain by
      emphasis, not by extinguishing the map.** _Supersedes v1's "Hover
      dim/highlight reads instantly"._ The chain should gain presence while the
      rest stays legible; label count under hover is now 467 of 467, against 42
      under the old rule (FR-29, story 5.2)
- [ ] Heatmap gradient is legible cold→hot at both zoom levels
- [ ] **Where Epic 5 departs from the mockup, the departure is deliberate and
      defensible.** The mockup knows four layers and a few dozen hardcoded
      nodes; it is silent on start-here, filtering, drill-down, blast radius and
      3D. Judge those against the brief, not against the mockup

## Interaction feel (target 60 fps — the automated floor is 55)

- [ ] Pan/zoom feels smooth on the maintainer's hardware at the synthetic
      fixture (record hardware + subjective verdict)
- [ ] Search fly-to lands where expected and the pulse draws the eye
- [ ] Semantic zoom unfold/collapse never visibly "pops" the global layout

## Accessibility (UX-DR13, and the half no test reaches)

- [ ] A screen reader can reach and operate the layer toggles, the view switch
      and the start-here entries, and announces their state
- [ ] The map is usable under `prefers-reduced-motion` — including the replay
      control, which was silently disabled for reduced-motion readers before
      story 5.1 partially fixed it (retrospective debt 7c)
- [ ] Layer colours remain distinguishable under a common colour-vision
      deficiency

## Repo quality (FR-25 / SM-7)

- [ ] README demo GIF actually shows the wow in ≤ 30 s
- [ ] Map-of-itself on Pages is current with master — **blocked on story 4.2**
      (GitHub Actions billing); leave unticked with that reason until it lands
- [ ] A newcomer can go README → `npx gitnebula` → map without further docs
- [ ] **Read the README as a stranger would.** Epic 5's AC-6, left unticked at
      closure

## Sign-off

- [ ] All above checked, or an unticked item carries a written reason naming
      what blocks it
- Maintainer: \_\_\_\_\_\_ Date: \_\_\_\_\_\_ Hardware: \_\_\_\_\_\_

### Walk log

One line per walk, so the next epic can see what was last verified and when.

| date | walked by | scope | where the evidence lives |
| --- | --- | --- | --- |
| 2026-08-17 | maintainer | The Epic 5 feature walk — visual, keyboard, screen-reader and "does it feel right on a real repository" items | 34 boxes ticked across nine `docs/dev/epic-5/*/MANUAL_TESTING.md` files, commit `f8c9a71`. Recorded here after the fact; this file was not touched at the time |
