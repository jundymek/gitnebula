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

Two attributes, one for each way of reading a row.

```ts
option.setAttribute("aria-label", `${node.path}, ${node.kind}`);
name.textContent = node.path;
name.title = node.path;
```

The `title` on the span reveals the path to a pointer. The `aria-label` on the
option gives the same path to a screen reader — which, it turned out, was not
getting *any* of it.

`title` is the mechanism already in use elsewhere in this chrome —
`export-button.ts` and `header.ts` both label their controls with it. The
canvas tooltip from 3.3 (`chrome/tooltip.ts`) is deliberately **not** reused:
it follows the cursor over the map and belongs to hover-on-node, and a second
consumer would couple search chrome to it for nothing.

### The a11y half: a search result had no accessible name at all

Found by the maintainer running this story's own `MANUAL_TESTING.md` step 7,
the screen-reader step. VoiceOver announced a result as *"You are currently on
a menu item, group, inside a list box"* — no path, not even the truncated one.

This was not a regression from the `title`. Chrome's accessibility tree, read
against the running app before the fix, gave **every** option an empty name and
exposed its two spans as separate nodes:

```
option [ref_28]                                       <- no name
 generic "packages/cli/src/assemble.ts" [ref_29]
 generic "file" [ref_30]
```

Every other element in the same tree is named (`button "Export PNG"`, `status
"7 results"`). ARIA says this should not happen — `option` is
children-presentational, so the spans ought to flatten into a name — but it
does, in the engine, and it has since the listbox arrived in 3.3.

The `aria-label` authors the name outright, which no engine has to infer. It
also inserts the separator that name-from-content would not: the two spans run
together as `assemble.tsfile`, which is what a screen reader would have read
even had the name worked.

After the change, in the same tree:

```
option "docs/adr/0006-viewport-scoped-semantic-unfold.md, file" [ref_32]
option "packages/deps/assets/tree-sitter-python.wasm.sha256, file" [ref_35]
```

Note the clipped rows announce their **full** path — the screen-reader half of
AC-1 now matches the pointer half.

This is a 3.3 defect rather than one of this story's making. It is fixed here
because it is the same element, because this story's own reasoning had asserted
the opposite, and because a story about reading a search result that a
screen-reader user still cannot read is not finished. It reaches no further
than `search.ts`.

### Why the title is on the span and not the row

The span is the element that clips, and it has no ARIA role, so the attribute
stays out of name computation. On the `li` it would instead become the option's
accessible *description* and be announced after the name. A test asserts the
`li` has no `title`, so the choice cannot be undone by accident.

The span covers the row minus the short `file`/`module` kind label at the right
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
| `packages/viz/src/chrome/search.ts` | UPDATE | sets `name.title` and the option's `aria-label` when rendering a result |
| `packages/viz/src/chrome/search.test.ts` | UPDATE | seven tests: the title on a clipped path and on every result, absent from the `li`; the authored name for a file, a module and a clipped path; the ARIA wiring still intact |
| `docs/dev/epic-3/3.8-viz-search-path-tooltip/README.md` | NEW | this file |
| `docs/dev/epic-3/3.8-viz-search-path-tooltip/MANUAL_TESTING.md` | NEW | hover verification steps |
| `docs/implementation-artifacts/epic-3-exploration/3.8-viz-search-path-tooltip.md` | UPDATE | tasks ticked, Dev Agent Record filled |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's row only |

## Verification

```
pnpm --filter @gitnebula/viz test        # 369 passed (31 files)
pnpm --filter @gitnebula/viz typecheck   # clean
pnpm lint                                # clean
pnpm build                               # clean
```

Every new assertion was watched fail before its fix landed — the two title ones
against `expected undefined to be 'docs/adr/…'`, the three name ones against
`expected null to be 'src/engine/graph.ts, file'` — so none of them is
decorative.

Beyond the suite, the maintainer's original reproduction was replayed in a real
Chrome against a real analysis of this repository; see `MANUAL_TESTING.md`.

## No performance record

This story adds one attribute assignment per rendered option, to a list capped
at seven. It touches no stated performance property, so there is no
`PERFORMANCE.md` here.
