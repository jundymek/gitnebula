# ADR-0004: Bundle = self-contained viewer + sibling analysis.json

- **Status:** accepted
- **Date:** 2026-08-10
- **Resolves:** brief §11 open question 4

## Context

`gitnebula build` must produce a static bundle hostable on GitHub Pages (no
backend — product principle 5). Open points: whether to bundle fonts/assets,
whether to inline the data, and what size budget applies. The CI recipe
(regenerate on push) and the README map-of-itself depend on this shape.

## Decision

- The Viewer builds to a **self-contained page**: HTML with inlined JS and
  CSS, **system font stack** (the nebula aesthetic already uses
  `ui-monospace` / system sans — no webfonts), zero external requests.
- **`analysis.json` stays a separate sibling file**, fetched by the Viewer.
- Budgets: Viewer assets **≤ 2 MB gzipped** (excluding data);
  `analysis.json` **≤ 5 MB** for a 2,000-file repo (enforced by the co-change
  bounds, ADR-0005).
- Target host: any static HTTP server (GitHub Pages). `file://` is not
  supported.

## Consequences

- CI can refresh the map by regenerating one JSON file — no Viewer rebuild,
  faster workflow, smaller diffs on the Pages branch.
- The same data-loading path serves dev mode (fixtures), local serve, and the
  bundle — one code path, no embed/extract special case.
- Zero external requests makes the bundle CSP-friendly and keeps the
  local-first promise verifiable (network log must be empty).
- No webfonts means typography varies slightly across platforms; accepted —
  the mockup's aesthetic is already built on system fonts.
- `file://` users get a clear error pointing at `npx serve`-style one-liners.
