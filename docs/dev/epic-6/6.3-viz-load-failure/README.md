# 6.3 — The first screen of a failed load, and the seam between two validators

Story: `6.3-viz-load-failure` · Owner module: `viz` · Base:
`epic/6-assembled-viewer` (wave B) · Measured against `35a95c5`.

Two deliverables, both tests, both new files. Nothing in
`packages/viz/src/`, `packages/cli/src/` or `packages/contract/` changed.

---

## 1. The first screen of a failed load

`renderErrorScreen` (`packages/viz/src/error-screen.ts:11`) is the first and
only thing a reader sees when `analysis.json` cannot be loaded. `app.ts` calls
it from three places; `loader.ts` constructs failures in six, across three
kinds. `ui/tests/load-failure.pw.ts` drives the **assembled** path into each of
them — a real fetch over HTTP, `boot()` choosing the screen over an engine —
and asserts what the reader is shown.

| kind | how it is reached | title asserted | the actionable half |
| --- | --- | --- | --- |
| `unreachable` | server answers 500 | analysis.json could not be loaded | names the status **and** `./analysis.json`, the URL it looked at |
| `unreachable` | request aborted at the transport | analysis.json could not be loaded | says "the request failed", so a dead connection does not read as a missing file |
| `unreachable` | page opened over `file://` | This page has to be served, not opened from disk | the exact `FILE_PROTOCOL_HINT`, including `npx serve` **and** `python3 -m http.server` |
| `malformed` | body is not JSON | analysis.json could not be parsed | distinguishes a parse failure from a missing file — the usual cause is a host answering an HTML 404 page with status 200 |
| `malformed` | no `schemaVersion` | analysis.json is missing its schemaVersion | names the field |
| `malformed` | `schemaVersion: "1.x"` | analysis.json declares an unreadable schemaVersion | quotes the value **and** states the shape `<major>.<minor>` |
| `malformed` | node 1 is not a node | analysis.json is not a gitnebula document | points at index 1 — on a 2,000-node document an unlocated complaint is unusable |
| `unsupported-version` | `schemaVersion: "2.0"` | This analysis.json was written by a different gitnebula | both numbers, side by side: `document schemaVersion 2.0`, `viewer supports major 1` |

Every one of these also asserts that the failed boot published **no** harness
handle and left **no** `#stage` canvas, and that the screen carries
`role="alert"`.

### A correction to the story spec's premise

The spec's context says `renderErrorScreen` "has **no test in any harness** —
not in vitest, not in Playwright". **That was not accurate against this base
branch.** `packages/viz/bundle/tests/bundle.pw.ts:65-84` already opens the
built page from disk and asserts `.error-screen` is visible and contains "has
to be served" and "npx serve".

The rest of the premise holds, and it is the part that mattered: that was the
only browser assertion on the screen, covering one of the six constructions.
The other five had no coverage in any harness. The `file://` test added here
overlaps that one deliberately and narrowly — it asserts the **exact**
`FILE_PROTOCOL_HINT` constant rather than two substrings, so a rewrite that
dropped half the remedy fails here while staying green there.

**Recommendation for a later story:** consolidate the two. Whoever does it can
edit both suites at once, which this story's territory did not allow.

### AC-3: the screen shows text, never markup — proven, not assumed

`error-screen.ts:4` explains that the screen is built with `textContent`
because the strings it shows come from a document the viewer has just decided
it cannot trust. `checkVersion` interpolates the declared `schemaVersion` into
the detail verbatim, so a document *can* put arbitrary characters there.

The test serves `schemaVersion: '<img src=x onerror="globalThis.__loadFailureXss = true">'`
and requires four things at once: the string reaches the reader verbatim, no
`<img>` element exists in the screen, no literal tag appears in its
`innerHTML`, and the payload did not run.

All four were shown to discriminate by temporarily switching
`detail.textContent` to `detail.innerHTML`:

| assertion | observed under `innerHTML` |
| --- | --- |
| detail contains the payload verbatim | red — the text read back as ``` `` is not a version. A gitnebula document carries `.`, both integers.``, the markup having been parsed away |
| no `<img>` in the screen | red — `Expected: 0, Received: 1` |
| payload did not execute | red — **`Expected: false, Received: true`**: the untrusted document's script ran in the reader's page |

The last row is why the test asserts execution rather than element count alone.
`error-screen.ts` was restored immediately; `git diff` over `packages/viz/src`
is empty.

---

## 2. The seam between the two validators

One document, two guards, and nothing checking them against each other:

- `packages/cli/src/assemble.ts` validates with **ajv** against
  `packages/contract/src/analysis.schema.json`, which is
  `additionalProperties: false` on the root and on every definition.
- `packages/viz/src/loader.ts` re-checks with **hand-written predicates over a
  subset of fields** — deliberately, to keep the bundle self-contained and free
  of a validator dependency (AD-8, AD-12).

Each side is correct on its own terms. The gap exists only between them, which
is why per-branch review never finds it: the document that exercises it is one
no gitnebula run produces.

### The measurement (AC-4)

Re-derived by `ui/tests/validator-seam.pw.ts` from the schema and from
`loader.ts`'s own source at test time, not transcribed. **No drift**: every
figure the story spec was written with is correct as of `35a95c5`.

| | schema requires | loader checks | unchecked |
| --- | --- | --- | --- |
| `node` | **12** — id, kind, parent, path, layer, loc, churn, commits, authors, lastChangedAt, description, descriptionSource | **6** — id, kind, path, layer, loc, churn | parent, commits, authors, lastChangedAt, description, descriptionSource |
| `edge` | **4** — source, target, kind, weight | **2** — source, target | kind, weight |
| `cochange` | **3** — a, b, count (and `cochanges` is required at the root) | the array only — no element is ever inspected | a, b, count |

The test reads the field lists out of `isNodeShaped` and `isEdgeShaped` rather
than listing them, so a widened predicate fails the check and names the field
that moved. Verified by adding `typeof candidate.commits === "number"` to
`isNodeShaped` on purpose: red, reporting *"The loader checks 7: churn,
commits, id, kind, layer, loc, path"*. Restored.

### The demonstration (AC-5)

`documentThroughTheSeam()` takes the committed `root-files.json` and removes
**every** required-but-unchecked field. The test then proves both halves:

- **ajv rejects it** — the same `validateAnalysis` that `assemble.ts` runs
  before writing `analysis.json`, so a gitnebula run could never produce this
  file. The test asserts ajv objects to `parent`, `weight` and `count` by name,
  not merely that some error exists.
- **the Viewer loads and renders it** — the harness handle appears, `#stage` is
  drawn, and no error screen is shown.

### Degrades safely, or misreads (AC-5)

Measured in the browser, one field group per test, by reading the **rendered
string** out of the panel rather than reasoning from the source.

| field | verdict | what the reader actually sees |
| --- | --- | --- |
| `node.parent` | **MISREADS** | the module's `files` row reads **`0`** while the module has two files. Worse below the panel: `graph.ts:88-110` puts a file with no `parent` in neither `rootFileIndices` nor any module's member list, so it is **laid out nowhere** while still sitting in `engine.nodes` — a file silently absent from the architecture map. |
| `node.authors` | **MISREADS** | the `authors` row reads **`NaN`**. `formatInteger(undefined)` is `Math.round(undefined).toLocaleString()`. The row is not marked empty, so nothing distinguishes it from a value. |
| `node.lastChangedAt` | **DEGRADES, with a caveat** | the `last change` row reads `—`, so nothing wrong is shown. The caveat: `panel-model.ts:181` tests `=== null`, so an *absent* field takes the formatting path instead of the honest "no change in the last N days" sentence the contract has a state for. The reader gets a bare dash where a sentence exists. |
| `node.commits` | **DEGRADES SAFELY** | invisible. Copied into `EngineNode` and never read back; the header's commit count comes from `repo.stats.commits`. |
| `node.description`, `descriptionSource` | **DEGRADES SAFELY** | invisible — the post-MVP `describe` layer, which no surface reads yet. |
| `edge.kind` | **DEGRADES SAFELY** | never read anywhere in `viz`. |
| `edge.weight` | **DEGRADES SAFELY** | copied into `GraphEdge` and never read back. The map draws. |
| `cochanges[].count` | **MISREADS** | the blast-radius partner row reads **`NaN commits`** — in the accessible name too, so a screen-reader user and a sighted one get the same wrong number. |
| `cochanges[].a` or `.b` | **MISREADS, silently** | `partnerOf` matches the selected id against both, so a pair missing either matches nothing and **drops out**. The panel then states as a fact about the repository that this file changes alone — the opposite of what the document says. |

The pattern worth naming: **the fields that misread are the ones a surface
reads; the fields that degrade safely are the ones nothing reads yet.**
`node.commits`, `description` and `descriptionSource` are one feature away from
moving columns, and nothing would announce the move.

### What this story deliberately did **not** do (AC-6)

The gap is reported, not patched. `packages/viz/src/loader.ts` and
`packages/cli/src/assemble.ts` are byte-unchanged.

Widening the loader is contract-adjacent: `CLAUDE.md` requires a change to the
contract to have "its own story, a schema version decision, and an ADR if the
change is structural", and the loader's narrowness is a **stated design
choice** (AD-8, AD-12: no validator in the bundle), not an oversight.

**What a future story would have to decide — in this order:**

1. **Whether the loader should widen at all.** The honest case against: every
   document the pipeline emits is already ajv-validated at emit time (AD-9), so
   the loader is guarding against a hand-edited or third-party file — a case
   the project has never claimed to support. The case for: the misreads above
   are *silent*, and a viewer that shows `NaN commits` or drops a file from the
   map is worse than one that refuses the document by name (FR-6's whole
   argument). This is the decision; the rest follows from it.
2. **If it widens, how far.** Checking all 12 node fields on every node is O(n)
   over 2,000 nodes on the boot path, against ADR-0006's yardstick. Checking
   only the fields a surface *reads today* is cheaper and re-opens the same gap
   the moment a surface reads one more field.
3. **Whether the answer is a check at all.** Three of the nine unchecked fields
   misread by rendering `NaN`. A `formatInteger` that returned the em dash for
   a non-finite input would turn two of those misreads into honest absences
   without touching the loader, the schema or the boot-path cost — and would
   also fix them for any future field. That is a `viz` change, not a contract
   change, and a much smaller story.
4. **Whether `cochanges` elements are a separate case.** They are the only
   place the loader checks a container and never its contents, and both of
   their failure modes are misreads. If only one thing is fixed, this is the
   cheapest one with the worst symptom.

A future story should not simply "make the loader match the schema": that reads
as tidying and would silently pay the boot-path cost for fields nothing reads.

---

## 3. `GITNEBULA_FIXTURE` 404s loudly — verified

Story 1.4 learned that a silent fallback produces a run that looks normal while
measuring nothing, so `vite.config.ts` answers a missing fixture with a 404 and
a named error rather than serving a default. Executed on this branch:

```
$ GITNEBULA_FIXTURE=no-such-fixture pnpm vite --port 4399 --strictPort
gitnebula: serving …/packages/contract/fixtures/no-such-fixture.json at /analysis.json
gitnebula: fixture not found at …/no-such-fixture.json — set GITNEBULA_FIXTURE
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4399/analysis.json
HTTP 404
```

A reader who does this in a browser gets the `unreachable` screen naming the
404 — the first row of the table in section 1.

The same reasoning is guarded inside the suite: every failure test asserts that
its `analysis.json` route **actually fired**. A route that silently stopped
matching would mean the spec measured the dev server's valid fixture while
looking like a normal pass. Verified by pointing the glob at a URL nothing
requests: red in 164 ms, saying *"the Viewer booted successfully on a page this
helper was asked to drive into a load failure."*

---

## Files

| path | | why |
| --- | --- | --- |
| `packages/viz/ui/tests/load-failure.pw.ts` | NEW | AC-1, AC-2, AC-3 — the eight failure constructions, the `file://` hint, the markup proof, the negative control |
| `packages/viz/ui/tests/validator-seam.pw.ts` | NEW | AC-4, AC-5 — the numbers re-derived, the ajv-rejected document rendered, the per-field classification |
| `packages/viz/ui/tests/support/load-failure-page.ts` | NEW | navigation for a page that boots into the error screen, route installers with a fired-guard, document mutators, panel readout |
| `docs/dev/epic-6/6.3-viz-load-failure/README.md` | NEW | this file |
| `docs/dev/epic-6/6.3-viz-load-failure/MANUAL_TESTING.md` | NEW | AC-8 |
| `docs/implementation-artifacts/6.3-viz-load-failure.md` | UPDATE | tasks ticked, Dev Agent Record filled |

`docs/implementation-artifacts/sprint-status.yaml` is **not** touched: the
supervisor writes every row of that file at closure (superman, 2026-09-08
15:36), because the wave's three rows are adjacent lines and wave A already
lost a rebase and a Codex re-review round to that collision.

## Verification

| command | result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm test` | pass — 6 packages, exit 0. `packages/viz` 827 tests in 56 files, including `ui/src/suite-conventions.test.ts` over the two new specs |
| `pnpm build` | pass |
| `pnpm --filter @gitnebula/viz typecheck` | pass |
| `UI_PORT=4322 pnpm --filter @gitnebula/viz ui` | **25 passed** — 11 new in `load-failure.pw.ts`, 11 new in `validator-seam.pw.ts`, 3 pre-existing in `smoke.pw.ts` |

`UI_PORT=4322` because three agent worktrees share this machine and 6.1's
config uses `--strictPort` on purpose: 4321 alice, 4322 me, 4323 pamela.

Every new assertion was seen red before being relied on — the mutations and
their observed output are in sections 1 and 2 above, and the sources they
touched were restored (`git diff` over `packages/viz/src` is empty).

## A harness defect, reported and not fixed

The intent gate resolves the worktree's `intent.synced` marker **relative to
the shell's working directory** rather than to the worktree root:
`hooks/pre-tool-use.sh:2829` builds the path as `"$CWD/intent.synced"`, and
Claude Code's Bash working directory persists between calls. After a single
`cd packages/viz`, ordinary commands are refused with *"BLOCKED by agent
system: cohort intent-sync incomplete"* even though intent-sync completed at
15:39:52Z and the marker exists; the identical command from the worktree root
runs. The printed hint compounds it by suggesting `intent.md` is the problem,
which sends an agent off to edit a file that was never involved.

Hit twice here, at 15:52:41Z and 15:53:07Z, and diagnosed independently by the
supervisor in the same minutes; wave A of this epic hit it twice and alice hit
it in this wave. The workaround costs nothing — stay at the worktree root and
prefer `pnpm --filter @gitnebula/viz <script>` over `cd`-ing in — and three
agents patching one harness defect three different ways in three branches
would be worse than the defect. It belongs to terminal-agents, not to
gitnebula. Recorded here and in the story's Dev Agent Record for the operator.
