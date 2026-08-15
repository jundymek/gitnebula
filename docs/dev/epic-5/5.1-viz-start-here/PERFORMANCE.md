# Performance — 5.1 start-here ranking

This story states no performance property of its own. It is recorded here
because it adds code and copy to the viewer bundle, and the bundle carries a
budget the CLI asserts on every test run.

## Method

```bash
pnpm --filter @gitnebula/viz build     # vite, production
pnpm --filter gitnebula build          # assembles packages/cli/assets/viz
pnpm --filter gitnebula test           # asserts the viewer-asset budget
```

Machine: macOS (darwin 25.5.0), Node 20, pnpm 10.34.5. Measured on
`story/5.1-viz-start-here` at the commit this PR opens with.

## Numbers

| measurement                     | value       | budget    | verdict          |
| ------------------------------- | ----------- | --------- | ---------------- |
| viewer assets, gzipped          | 59.4 KB     | 2.00 MB   | 2.9 % of budget  |
| `dist/index.html`, uncompressed | 199.16 KB   | —         | —                |
| `dist/index.html`, gzipped      | 61.47 KB    | —         | —                |
| viz build time                  | 0.29 s      | —         | —                |
| pipeline run on this repo       | 0.28 s      | —         | —                |

## Notes

The ranking is computed once per document load, at `mountChrome` time, over
`nodes` and `edges` in a single pass each — O(n + e), and 389 nodes / 427 edges
on this repository. Reopening the panel recomputes nothing: the DOM is built
once and only unhidden, which is what AC-3's "does not reload the document or
re-run the settle" is asserted on in `start-here-wiring.test.ts`.

The frame-rate yardstick (FR-14, ADR-0006) is untouched by this story: the
panel is a DOM overlay, it draws on no canvas, and it neither enters the render
loop nor triggers a settle.
