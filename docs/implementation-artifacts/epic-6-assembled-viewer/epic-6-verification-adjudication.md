# Epic 6 — verification adjudication

Written by the maintainer, 2026-09-10, before merging `epic/6-assembled-viewer` into `master`.

SpecWitness verified this epic against the contract frozen on 2026-09-06, **before any of its
code existed**. The final run at `6636e08` is:

```
specwitness verify 6 --no-ai --head epic/6-assembled-viewer
gates 4/4 pass · 17 pass · 3 fail · 20 needs_human · VERDICT: FAIL
```

**The verdict is FAIL and this epic merges anyway.** That is not the gate being overruled; it
is the gate doing the one thing a green checkmark cannot — naming, with evidence, the three
places where the contract and the delivered work disagree, so that a human decides which side
was wrong. This file is that decision. Each of the three is adjudicated below with what was
checked, what was found, and why it does not block.

**No failure is a defect in the shipped viewer.** All 4 deterministic gates pass, the unit
suite is green, and the on-demand browser suite is 44 tests green at the epic head.

## E6-07 — accepted as a contract-vs-reality gap (critical)

> The UI and performance suites use one shared `openViewer` helper … every browser spec
> navigates through that helper rather than calling `page.goto` directly …

**Observed:** `pageGotoDirectCount` is 3; the contract expects 2.

**Where the third one is:** `packages/viz/ui/tests/support/load-failure-page.ts`, story 6.3's
failure-navigation helper.

**Why it exists.** `openViewer` (story 6.1) waits for the harness handle before returning. A
*failed* boot never publishes that handle — that is what failing means — so a spec that drives
the load-failure screens cannot use it and must navigate itself. The contract was frozen on
2026-09-06, three days before any load-failure spec existed; nobody could have known that
verifying a failed boot needs a second navigation path.

**Decision: accept.** The criterion describes a real and desirable property — navigation goes
through one helper — and the delivered code honours it everywhere the helper *can* be used.
Rewriting `openViewer` to also serve the failure path would put a "wait for a handle, unless
you don't" branch in the helper whose whole value is that it has no branches.

**Not done, deliberately:** the contract is not amended to expect 3. Amending a frozen contract
to match what was built is how a verification gate stops meaning anything. The FAIL stands as
the record, and this paragraph is its answer.

## E6-23 — accepted; the report exists under different words (normal)

> The validator-gap report describes the gap without changing either validator and records that
> any future alignment must decide whether browser validation should widen …

**Observed:** the probe's `validatorReportMentionsNoValidatorChange` is `false`.

**What was actually checked.** `scripts/specwitness/docs-presence.mjs` looks for a document
matching `/validator[- ]gap|required-versus-checked/i`. Since the recursion fix (`6636e08`) it
reaches the whole tree; its first match is the epic retrospective, which *describes* the report
rather than *being* it.

**The report exists and satisfies the criterion.** `docs/dev/epic-6/6.3-viz-load-failure/README.md`
§2 "The seam between the two validators" names both validators and both source files, states
that each is correct on its own terms and that neither was changed, and §"What a future story
would have to decide" opens with *"Whether the loader should widen at all"* — the exact decision
the criterion requires be recorded. Verified by reading it, 2026-09-10.

**Decision: accept.** The gap is between the contract's vocabulary and the document's, not
between the contract and the work.

**Not done, deliberately:** the probe's search terms are not widened to match a document now
known to exist. Fitting the instrument to a result already seen is the one thing a verifier
must never do; the comment in `docs-presence.mjs` says so at the code.

## E6-28 — accepted; same shape as E6-23 (normal)

> The layout report records, for each bounded region, the content length used, viewport heights
> tested, and whether any control was unreachable; any discovered shipped-layout defect is
> reported without being repaired as part of this epic.

**Observed:** `layoutReportMentionsContentLength`, `…ViewportHeights` and `…Unreachable` are all
`false`, for the same reason as E6-23 — the phrase search matches the retrospective first.

**The report exists and satisfies the criterion.** `docs/dev/epic-6/6.4-viz-reachability/README.md`
carries the measurements (45 partner rows, row height 25 px, list content 1125 px, header 103 px
at 1280 wide), a per-region table whose row *"was any control unreachable before scrolling?"*
answers **"yes — both"**, and the tooltip coordinate-space defect reported and **not repaired**,
exactly as the criterion's last clause requires.

**Decision: accept**, on the same grounds as E6-23.

## The tooltip defect is NOT closed by this adjudication

Story 6.4 found and measured a real defect in shipped code: `.tooltip` is `position: fixed`
(`packages/viz/src/styles.css:315`, viewport coordinates) while the hover point is
canvas-relative (`packages/viz/src/engine/engine.ts:1791`). With a 103 px header and
`TOOLTIP_OFFSET_PX = 14` the tooltip renders 89 px above the cursor, and the vertical flip fires
above a canvas-relative y unreachable by any real pointer. Confirmed from the source constants
by the maintainer, 2026-09-10.

It was correctly **not fixed** here — story 6.4's own AC-5 and AC-7 forbid touching
`packages/viz/src/`. It is scheduled as its own story and is the reason this epic's release is
a patch rather than a fix for it.

## What this epic contributes, and what it does not

**To the published CLI:** two defect fixes and six test hooks, ~200 lines under
`packages/viz/src/`, all from story 6.5. Released as **0.2.1**; see `CHANGELOG.md`.

**Not to the published CLI:** everything else — ~10 000 lines of on-demand browser suite under
`packages/viz/ui/` and ~800 lines of verification probes under `scripts/specwitness/`. Neither
is in the package's `files`, and the `ui` suite is deliberately outside `pnpm test` so the
default command keeps passing on a machine with no browser.

**The thing worth stating plainly:** `boot()` — the ~120 lines that fetch the document, mount
the chrome, parse `?view=3d` and build the engine — was executed by no test in this repository.
It is now executed by 44, in a real browser, against the assembled page. That is not a feature
and no user will see it; it is the reason to trust this release and every one after it.
