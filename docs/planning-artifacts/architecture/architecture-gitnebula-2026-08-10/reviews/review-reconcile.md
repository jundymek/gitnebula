# Input-Reconciliation Review — ARCHITECTURE-SPINE (gitnebula, 2026-08-10)

Reviewer: input-reconciliation pass.
Inputs checked against the spine:

- `docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/prd.md` (FR-1..FR-25, §8 open questions, §9 assumptions index)
- `docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/addendum.md` (A1–A7)
- `docs/GITNEBULA_PROJECT_BRIEF.md` §8 (technical constraints), §9 (module breakdown)
- `CLAUDE.md` (process constraints)

Method: every FR walked one-by-one against the ADs, conventions, capability map,
and Deferred list; every addendum decision checked for a landing site; brief §8
constraints checked for sufficiency of the AD that claims them. Findings below
are things the spine **silently drops or contradicts** — not sound, reasoned
deferrals. Severity: HIGH = will cause divergence or a blocked story during MVP
epics; MEDIUM = will cause rework or an unowned requirement unless fixed before
story slicing; LOW = worth a one-line fix.

---

## Finding 1 — Fixture git repo: no decided mechanism for "a git repo inside the project repo", and no time anchor for window-relative history [HIGH]

**Sources:**
> Brief §8: "snapshot tests of the generated `analysis.json` against a
> purpose-built test repo (fixture inside the project repository)."

> PRD FR-10: "Unit-tested against a fixture repo with known history (crafted
> commits)."

> Spine, Structural Seed: `test-fixtures/   # purpose-built fixture repo(s)
> with crafted git history`

**Gap.** The spine names the directory and stops. Two undecided problems will
hit the first githist story:

1. **A nested `.git` directory cannot be committed.** Git refuses to track a
   nested repository's `.git`; it either becomes a gitlink (submodule pointer,
   which contradicts "inside the project repository" and breaks `npx`-cloned
   CI checkouts) or is silently ignored. Every viable mechanism is a real
   decision with different trade-offs: (a) commit the fixture's git dir renamed
   (e.g. `_git/`) and have test setup copy/rename it; (b) commit a
   `git bundle`/tarball and unpack in test setup; (c) commit a deterministic
   build script that replays crafted commits with pinned
   `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` into a temp dir. None is chosen; the
   spine's test convention ("snapshot tests only against committed fixtures")
   presumes the problem is solved.

2. **Window-relative history decays.** Churn/co-change use a trailing window
   (default 90 days, FR-10/A2). A fixture with commits authored in Aug 2026
   produces non-empty metrics today and `churn: 0` everywhere in Nov 2026 —
   every githist snapshot rots on a timer. Stability requires the analysis
   window's reference instant ("now") to be **injectable** — but the spine
   nowhere places it. AD-4 injects only `analyzedAt`; AD-3's resolved `Config`
   is a contract type whose fields are not enumerated. If the window anchor is
   not a `Config` field (or equivalent), AD-4's own ban on `Date.now()` in
   analyzers is unimplementable for githist (it must compute
   "now − windowDays" somehow), and deterministic snapshots (FR-7, AD-4) are
   impossible.

**Why not a sound deferral.** The Deferred list covers co-change caps
(ADR-0005) but says nothing about fixture storage or the time anchor. Both are
prerequisites for the *first* githist and contract-fixture stories (Epic 1–2
per CLAUDE.md's "contract first" ordering), and two agents will otherwise
invent incompatible answers (this is exactly the divergence the one-owner
module split is designed to prevent).

**Fix.** Add to the spine (or an ADR): the fixture-repo storage mechanism, and
a rule that the analysis-window anchor is an injected `Config`/input value
(cli computes it once; analyzers never call the clock), with the fixture tests
pinning it.

---

## Finding 2 — AD-5 does not deliver brief §8's "engine swap with no changes elsewhere": cosmos.gl replaces layout, not just rendering [HIGH]

**Sources:**
> Brief §8: "The rendering layer must be decoupled from data such that at
> thousands of nodes the engine can be swapped for cosmos.gl with no changes
> elsewhere in the system."

> PRD FR-14: "the render engine can be swapped (cosmos.gl path) without
> Contract or Viewer-logic changes — verified by an architecture-level
> interface".

> Spine AD-5: "viz separates **layout** (simulation state; d3-force),
> **render** (a `RenderEngine` interface — `init/frame/pick/resize/exportPNG`
> …) … swapping the engine touches only a `RenderEngine` implementation."

> Spine Deferred: "only a *failed* spike changes this spine (RenderEngine impl
> swap, AD-5 anticipates it)."

**Gap/contradiction.** AD-5 draws the swap seam *between* layout and render:
d3-force owns simulation state, the engine only draws frames it is handed. But
cosmos.gl is not a drawing backend — it is a GPU **force-layout-plus-render**
engine that owns node positions itself. Under AD-5's boundary, adopting
cosmos.gl means ripping out the layout half too: seeded determinism (AD-6, one
PRNG feeding d3-force), the Settled definition (FR-12, displacement of
simulation state), viewport-scoped unfold driving the simulation (FR-16/A4
"only visible modules contribute Files to the simulation"), and freeze/wake
logic (A4) are all written against a CPU-side simulation the viewer controls.
The spine's own escape-hatch claim ("touches only a RenderEngine
implementation") is therefore not true for the one named replacement the brief
requires the hatch for. If the perf spike fails, the "designed escape hatch"
(A4) turns out to be a redesign of layout, AD-6, and the Settled semantics.

**Why report despite the deferral.** The spike deferral is sound; the *shape
of the seam* is not deferred — it is adopted now, and viz stories will freeze
code against it. Either (a) widen the swappable unit to a `GraphEngine`
(layout+render behind one interface, with position read-back for chrome/pick),
or (b) explicitly document that the cosmos.gl path is a layout+render swap and
state which invariants (AD-6 seeding, Settled) must be re-satisfied by any
replacement engine — so the brief's constraint is honestly scoped rather than
nominally claimed.

---

## Finding 3 — AD-10's "no other MVP code references the describe concept" contradicts FR-4 (cli notice) and FR-19 (panel description slot) [MEDIUM]

**Sources:**
> Spine AD-10: "`description`/`descriptionSource` stay `null`-valued, nullable,
> present. **No other MVP code references the describe concept.**"

> PRD FR-4: ".gitnebula.yml … LLM backend (post-MVP field, **parsed and
> ignored in MVP with a notice**)."

> PRD FR-19: "`description` is not rendered in MVP … — **but the panel
> component accepts an optional description field (prop/slot) today.**"
> (Also brief §5.5: "The UI must nevertheless be designed so a description can
> be added without rebuilding the panel.")

**Gap.** Two MVP requirements *require* code outside the enrich hook to
reference the describe concept: cli's config resolver must recognize the LLM
key and print a notice (otherwise FR-4's "invalid config fails fast with the
offending key" would reject it as unknown), and viz's panel must carry a
description prop/slot. As written, AD-10's rule makes both FRs violations. An
implementing agent following the spine will either drop the FR consequences or
"fix" AD-10 ad hoc — divergence either way.

**Fix.** Reword AD-10's rule to name its two sanctioned exceptions: (1) config
schema knows the `llm`/backend key and cli emits the ignored-in-MVP notice;
(2) the panel component exposes an inert optional description slot. Everything
else stays banned.

---

## Finding 4 — FR-6's Viewer-side schemaVersion refusal has no home: capability map omits viz, and the cross-env convention makes `contract` un-importable from the browser [MEDIUM]

**Sources:**
> PRD FR-6: "**The Viewer refuses (with a clear error screen)** a file whose
> major `schemaVersion` it does not support."

> Spine, Capability map: "FR-6..8 (contract, fixtures, describe hook) →
> **contract, cli** → AD-1, AD-9, AD-10" — viz absent.

> Spine, Consistency conventions: "viz is the only browser package (DOM lib,
> no `node:` imports); **all others are Node-only (`node:` imports allowed,
> no DOM)**" — while AD-2's diagram mandates `viz --> contract`.

**Gap.** Two related drops:

1. The viewer's version check + error screen is an FR-6 consequence that lives
   in viz, but the capability map routes FR-6 to contract+cli only. Under
   CLAUDE.md's one-module-one-owner slicing, no viz story will claim it.
2. The conventions row licenses `contract` to use `node:` imports, yet viz
   must import `contract` at runtime (at minimum the supported-major constant;
   plausibly the ajv validator for the error screen and dev-mode fixture
   loading). One `node:` import anywhere in contract's runtime path breaks the
   Vite build. The spine never states that `@gitnebula/contract` must be
   isomorphic (or split browser-safe exports), so a contract story can legally
   ship something viz cannot consume — discovered only at integration.

**Fix.** Add viz to the FR-6 row; add a convention line: contract's runtime
exports are environment-neutral (no `node:` imports), and name where the
"supported major version" constant lives.

---

## Finding 5 — Two PRD items promised as "fixed in architecture" are neither fixed nor deferred: rename handling (FR-10) and the Settled constants (FR-12) [MEDIUM]

**Sources:**
> PRD FR-10 / §9: "Renames are followed [ASSUMPTION: `git log --follow` for
> files where feasible; **exact rename handling fixed in architecture**]." and
> §8 Q5: "Rename handling depth in githist (`--follow` cost on large repos)".

> PRD §3 / §9: "'Settled' constants (**pixel bound, frame count**) fixed in
> architecture; the displacement-based definition is fixed here."

> Spine: AD-7 mentions "git rename miss" only as a warning kind; the Deferred
> list contains neither item.

**Gap.** The PRD explicitly hands both decisions to this phase. The spine
answers neither and does not list them in Deferred with a reason — they are
silently dropped. Consequences during MVP stories: (a) `git log --follow` is
per-file (one git invocation per file — hostile to the 60 s budget on 2,000
files), whereas `git log -M --name-status` over the window is one pass with
different accuracy; a githist agent must choose alone, and the choice affects
snapshot fixtures (Finding 1) and determinism. (b) FR-12's acceptance test
("reaches Settled within 2–3 s … measured from first render") cannot be
written without the pixel bound and frame count; a viz agent will pick numbers
that then ossify as de-facto contract for the replay control and
reduced-motion path.

**Fix.** Either decide (one-pass `git log -M` at window scope; e.g. Settled =
max displacement < 0.5 px for 30 consecutive frames — numbers illustrative)
or add both to Deferred with an owner story named, so they are visibly open
rather than absent.

---

## Finding 6 — A5's bundle shape (single self-contained inlined HTML) did not land anywhere in the spine [LOW–MEDIUM]

**Sources:**
> Addendum A5: "**Single self-contained HTML+JS+CSS (inlined)**, system font
> stack … `analysis.json` deliberately *not* inlined."

> PRD FR-23: "Viewer assets (self-contained HTML/JS/CSS … no external
> requests) plus `analysis.json` as a separate file."

> Spine: AD-8 covers "the bundle request only their own files"; the capability
> map routes FR-23..24 to cli+viz under AD-8; Stack pins "Vite (viz build) 8.x".
> Nothing states the single-file/inlined decision.

**Gap.** AD-8 guarantees *no external* requests, which a default multi-chunk
Vite output also satisfies — so the spine as written permits a bundle shape A5
rejected. Vite's default output is hashed multi-file chunks; producing one
inlined HTML requires a deliberate build configuration (e.g. a single-file
plugin) and interacts with the ≤ 2 MB gzipped budget and the `analysis.json`
sibling-fetch. A cli/viz pair of agents can each be locally correct and
jointly ship the wrong bundle shape. One convention line ("bundle = one
self-contained `index.html` with inlined JS/CSS + sibling `analysis.json`")
closes it.

---

## Finding 7 — Minor drops and frictions [LOW]

1. **Intra-stage progress vs AD-3 purity (FR-3).** `analyze(input, config)`
   has no progress channel, so cli can print only stage start/end lines. That
   satisfies FR-3's letter, but on a 60 s deps stage over 2,000 files the
   terminal is silent for tens of seconds. If any story wants within-stage
   progress (file counts), it must break AD-3's signature. Worth one sentence:
   either "stage start/end lines only — by design" or add an optional
   `onProgress` callback to the sanctioned signature now, not mid-story.
2. **Default-exclude list ownership is split.** The Deferred list assigns
   "layer rule table contents & default-exclude list" to *scanner stories*,
   but AD-3 places all config resolution (defaults included) in **cli**, and
   FR-4 requires excludes to bind *every* stage (scan, deps, history). The
   data can live in scanner's stories, but its home package/export and the
   enforcement point (scanner filters; downstream stages see only ScanResult
   files?) should be named to avoid a cli-vs-scanner ownership squabble.
3. **PNG-export fidelity vs determinism (FR-22, UJ-2).** `exportPNG` is in the
   RenderEngine interface and AD-6 makes layout deterministic — good. Not
   stated: whether the ≥ 2× export re-renders through the same engine path
   (required for "matches the current camera, mode, and highlight state" at a
   different pixel density). One clause in AD-5's interface description
   suffices.

---

## Explicitly checked and found sound (not findings)

- A1 (TS compiler API for TS/JS, web-tree-sitter WASM for Python) — landed in
  Stack and structural seed; brief §8's open question resolved.
- A2 churn formula, A3 contract deltas (parent-only membership, `commits`
  field, both edge levels, bounded cochanges, stable sorts) — landed in AD-4
  and conventions; bounds correctly deferred with ADR-0005 named.
- A4 performance strategy — mechanism deferred to a named early spike story
  with a stated trigger for spine change (but see Finding 2 on the escape
  hatch's shape).
- A6 / CLAUDE.md process constraints — conventions row adopts Conventional
  Commits + trailers; structural seed matches CLAUDE.md's repo layout.
- A7 demo repos — data for DoD execution, correctly outside architecture.
- Seeded layout (PRD §8 Q6) — explicitly resolved by AD-6.
- Deferred describe backends, port strategy, fuzzy scorer, module-descent
  thresholds — sound, reasoned deferrals to owned stories.
