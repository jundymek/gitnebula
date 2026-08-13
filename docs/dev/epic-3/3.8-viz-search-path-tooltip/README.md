# 3.8 — The full path of a truncated search result

Search results whose path does not fit their row are clipped from the front, so
`docs/adr/0006-viewport-scoped-semantic-unfold.md` renders as
`…viewport-scoped-semantic-unfold.md` and there is no way to tell which
directory it lives in. This story makes the whole path readable on hover.

**The truncation itself is untouched, deliberately.** Cutting from the front
keeps the basename — the part that says *which file* a result is — and that is
the right trade for a one-line row. `packages/viz/src/styles.css` has no diff
in this branch.

## What changed

One line of behaviour: the span that holds the path now also carries it as a
`title`, so the browser's own tooltip reveals the full string.

```ts
name.textContent = node.path;
name.title = node.path;
```

`title` is the mechanism already in use elsewhere in this chrome —
`export-button.ts` and `header.ts` both label their controls with it. The
canvas tooltip from 3.3 (`chrome/tooltip.ts`) is deliberately **not** reused:
it follows the cursor over the map and belongs to hover-on-node, and a second
consumer would couple search chrome to it for nothing.

### Why the span and not the row

The `title` is on `span.search-result-name`, not on the `li[role=option]`.

The span is the element that clips, and it has no ARIA role, so the attribute
is invisible to name computation. On the `li` it would instead become the
option's accessible *description*, and a screen reader would read the path
twice — once from the option's content, once from the description. A test
asserts the `li` has no `title`, so the choice cannot be undone by accident.

The span spans the row minus the short `file`/`module` kind label at the right
edge, so hovering anywhere over the path text works.

## AC-4 — audit of the rest of `chrome/`

**Finding: `.search-result-name` is the only element in `viz` that clips text
it owns.** Nothing else needed the same treatment.

`text-overflow: ellipsis` appears exactly once in `packages/viz/src/styles.css`
(line 297). The four other `white-space: nowrap` rules were each checked and
none of them clip:

| rule | why it is not the same gap |
| --- | --- |
| `.tooltip` | sizes to its content and floats free of any container; nothing to clip against |
| `.visually-hidden` | screen-reader-only by construction; never rendered |
| `.p-badge` | a fixed one-word badge (`HOT`), never long enough to overflow |
| `.p-row span:first-child` | fixed metric labels from the panel, authored short |

The panel's path and value cells (`.p-path`, `.p-row span:last-child`) use
`overflow-wrap: anywhere` — they wrap rather than clip, so the full text is
already on screen.

## Files

| file | change | why |
| --- | --- | --- |
| `packages/viz/src/chrome/search.ts` | UPDATE | sets `name.title = node.path` when rendering an option |
| `packages/viz/src/chrome/search.test.ts` | UPDATE | four tests: the title on a clipped path, on every result, absent from the `li`, and the ARIA wiring still intact |
| `docs/dev/epic-3/3.8-viz-search-path-tooltip/README.md` | NEW | this file |
| `docs/dev/epic-3/3.8-viz-search-path-tooltip/MANUAL_TESTING.md` | NEW | hover verification steps |
| `docs/implementation-artifacts/epic-3-exploration/3.8-viz-search-path-tooltip.md` | UPDATE | tasks ticked, Dev Agent Record filled |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's row only |

## Verification

```
pnpm --filter @gitnebula/viz test        # 366 passed (31 files)
pnpm --filter @gitnebula/viz typecheck   # clean
pnpm lint                                # clean
pnpm build                               # clean
```

The two title assertions were watched fail before the fix landed — `expected
undefined to be 'docs/adr/…'` — so they are known to be load-bearing.

Beyond the suite, the maintainer's original reproduction was replayed in a real
Chrome against a real analysis of this repository; see `MANUAL_TESTING.md`.

## No performance record

This story adds one attribute assignment per rendered option, to a list capped
at seven. It touches no stated performance property, so there is no
`PERFORMANCE.md` here.
