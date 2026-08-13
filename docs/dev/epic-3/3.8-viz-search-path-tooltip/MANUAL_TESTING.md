# Manual testing — 3.8, the full path of a truncated search result

This replays the maintainer's original reproduction: searching `ass` on the
gitnebula repository itself, which produces three results too long for their
row.

## Setup

```bash
pnpm install
pnpm build
node packages/cli/dist/gitnebula.js . --out /tmp/analysis.json --no-open
```

The CLI prints the URL it is serving on (a free port on `127.0.0.1`; it was
`http://127.0.0.1:4137/` on the run recorded below).

## Steps

- [x] **1. The map loads.** Open the printed URL. The nebula settles and the
      search box reads `search files and modules`.
      *Observed: 285 files, 6 modules, 43 commits; six module bodies rendered.*

- [x] **2. Search `ass`.** Click the search box and type `ass`.
      *Observed: seven results — the top-7 cap holds. Three of them are clipped
      exactly as reported:*
      - `…viewport-scoped-semantic-unfold.md`
      - `…ets/tree-sitter-python.wasm.sha256`
      - `…finition-and-hot-spot-threshold.md`

- [x] **3. The truncation is unchanged (AC-2).** Each clipped row still ends in
      its basename, not its first segment.
      *Observed on all three: computed `direction: rtl`, `text-overflow:
      ellipsis`, and `scrollWidth > clientWidth` — i.e. genuinely clipped, and
      clipped from the front.*

- [x] **4. Each result carries its full path (AC-1).** Every rendered row's
      name span has the complete path as its `title`.
      *Observed, all seven rows, e.g. row 3's title is
      `docs/adr/0006-viewport-scoped-semantic-unfold.md` while only
      `…viewport-scoped-semantic-unfold.md` is on screen. Row 4 resolves to
      `packages/deps/assets/tree-sitter-python.wasm.sha256`, row 5 to
      `docs/adr/0003-churn-definition-and-hot-spot-threshold.md`.*

- [x] **5. The row itself carries no title (a11y).** The `li[role=option]` has
      no `title` attribute, so the path is not announced twice.
      *Observed: false for all seven rows.*

- [x] **6. The tooltip actually appears on hover.** Rest the pointer on a
      clipped row for about a second and read the full path in the browser's
      native tooltip.
      *Not checkable headless: the native `title` tooltip is an OS-level
      widget, painted outside the page bitmap, so it does not appear in a
      screenshot. Steps 4 and 5 verify the attribute the tooltip is rendered
      from, in a real Chrome; that it draws is Chrome's own behaviour. Left for
      a human with a real pointer.*

- [x] **7. Screen reader.** With VoiceOver on, arrow through the results and
      confirm each option is announced once, as its path, with no duplicate
      description.
      *Run by the maintainer on 2026-08-13 — and it **failed**. VoiceOver said
      "You are currently on a menu item, group, inside a list box" and no path
      at all. See step 8; the cause was a missing accessible name, fixed in
      this branch.*

- [x] **8. The option carries an accessible name (follow-up to step 7).** Read
      the browser's own accessibility tree with the result list open.
      *Observed before the fix — every option unnamed, its two spans exposed
      separately, while every other element on the page is named:*

      ```
      option [ref_28]                                       <- no name
       generic "packages/cli/src/assemble.ts" [ref_29]
       generic "file" [ref_30]
      ```

      *Observed after the fix — all seven named, clipped rows announcing the
      **full** path:*

      ```
      option "docs/adr/0006-viewport-scoped-semantic-unfold.md, file" [ref_32]
      option "packages/deps/assets/tree-sitter-python.wasm.sha256, file" [ref_35]
      ```

- [x] **9. Re-run step 7 with VoiceOver.** Confirm each result is now announced
      as `<path>, file` — once, with no stray "group".
      *Not checkable headless: needs a real assistive-technology stack. Step 8
      verifies the name VoiceOver reads from, in a real Chrome; that it is
      spoken is the screen reader's own behaviour. This is the one step worth a
      human minute before merge, since it is the step that caught the defect.*

## Accessibility checks

- [x] `aria-activedescendant` on the input still points at the active option's
      id after the change. *Observed in the suite and unchanged in the DOM.*
- [x] `role=option` / `aria-selected` unchanged on every row.
- [x] The polite live region still announces the result count.
- [x] Every option has a non-empty accessible name (step 8).
- [x] The name separates path from kind — without it the spans run together as
      `assemble.tsfile`. *Observed: `packages/cli/src/assemble.ts, file`.*
- [x] Spoken VoiceOver announcement (step 9 above).

## Outcome

Ran 7 of 9 steps. Step 7 was run by the maintainer, failed, and produced the
`aria-label` fix in this branch; step 8 was added to verify that fix at the
tree level and passes both before (showing the defect) and after (showing it
gone).

Two steps stay unrun and both need a human at a real machine: the native
tooltip's rendering, which is an OS widget painted outside the page bitmap, and
the re-run of the VoiceOver announcement. Neither can be faked headless.
