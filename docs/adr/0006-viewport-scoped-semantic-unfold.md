# ADR-0006: Semantic zoom unfolds only viewport-visible modules

- **Status:** accepted
- **Date:** 2026-08-10
- **Resolves:** performance risk in DoD 2 (60 fps at 100 modules / 2,000 files); user-confirmed deviation from the mockup

## Context

The mockup unfolds **all** modules once zoom crosses `UNFOLD_ZOOM = 1.8` —
at the DoD scale that means 2,000 file nodes entering the simulation at once,
which is exactly the 60 fps worst case. The mockup's O(n²) simulation is a
mockup artifact, but even with Barnes–Hut, simulating and rendering every file
node when the user can only see a handful of modules buys nothing.

## Decision

Past the 1.8× threshold, only modules **intersecting the viewport (plus a
margin)** unfold; off-screen modules stay collapsed. Panning a collapsed
module into view at ≥ 1.8× unfolds it; zooming below the threshold collapses
all. File labels appear from 3.0× (mockup behaviour retained). All other
constants and behaviours follow the mockup.

## Consequences

- Simulated file count drops from "entire repo" to "modules in view" — low
  hundreds worst case — making the 60 fps budget (PRD FR-14) achievable
  without renderer replacement.
- User-visible behaviour is indistinguishable from the mockup: unfolded
  modules outside the viewport would be off-screen anyway.
- Unfold/collapse becomes a pan-triggered event, so the simulation must wake
  and settle *locally* without disturbing the global layout — a real
  implementation constraint for viz (member nodes spawn at their module's
  position; module positions stay pinned during local settle).
- The mockup remains the behavioural reference for everything except this one
  rule; the deviation is documented here and in the PRD (FR-16).
