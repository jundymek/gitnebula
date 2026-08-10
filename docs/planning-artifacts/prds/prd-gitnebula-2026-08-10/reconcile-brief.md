# Input Reconciliation Review — brief + mockup vs PRD/addendum

Input: `docs/GITNEBULA_PROJECT_BRIEF.md` (sections 1–12) and `reference/mockup.html`.
Target: `prd.md` + `addendum.md` in this directory.

Scope notes: section 13 (delivery process) deliberately not reviewed. Items the
PRD explicitly lists as non-goals, out of scope, deviations, or open questions
(membership edges, viewport-scoped unfold, `gn` alias, co-change bounds, module
descent heuristic, hot-spot algorithm, etc.) are treated as handled.

---

## F1. Repo-quality DoD items (demo GIF, MIT license, CI, CONTRIBUTING.md) untraceable — HIGH

**Source (brief §10.6):**
> "Project repo: README with a 30-second demo (GIF/video) and a map of itself (dogfooding), MIT license, CI with tests, CONTRIBUTING.md."

**Source (brief §2):**
> "The project is open source (public repo, MIT license) and serves as a portfolio piece — visual quality and repo quality (README, demo, CI) are product requirements, not decoration."

Of DoD item 6, only "map of itself" is traceable (SM-5, FR-24). The 30-second
demo GIF/video, MIT license, CI-with-tests as a deliverable, and CONTRIBUTING.md
appear nowhere in any FR or SM. The brief explicitly elevates these to *product
requirements*. Only the in-tool GIF *recorder* is out of scope (brief §6 /
PRD §5) — the demo asset itself is not, and the brief points at external
recorders precisely so the asset still gets made. The PRD's Vision ("doubles as
its own demo") retains the dogfooding half but silently drops the rest, and the
portfolio-piece positioning is absent from §1/§2.

**Where to address:** add an FR (or a "Repo quality" feature in §4.8 / a
secondary SM) covering: demo GIF/video in README, MIT LICENSE file,
CONTRIBUTING.md, CI running the test suite. Mention the portfolio positioning
in §1 Vision so downstream phases weight repo quality correctly.

## F2. Hot-spot threshold configurability dropped (contradiction) — HIGH

**Source (brief §5.5):**
> "'Hot spot' badge above a configurable churn threshold."

The PRD Glossary hard-codes "Hot spot — a Node with `churn90d ≥ 0.5`" and
FR-19 repeats `churn90d ≥ 0.5`. FR-4's `.gitnebula.yml` surface (excludes,
window, layers, LLM backend) has no hot-spot threshold key. The addendum (A2)
justifies 0.5 as the *default* on the normalized scale, but neither document
states that configurability was deliberately cut — so this is a silent
contradiction, not a resolved open question (brief §11.3 covers the algorithm,
not the configurability).

**Where to address:** either add `hotThreshold` (or similar) to FR-4's config
keys and phrase FR-19 as "≥ the configured threshold (default 0.5)", or record
an explicit deviation ("threshold fixed at 0.5 in MVP") in the PRD/addendum.

## F3. Structure-mode hot nodes render in the hot colour (mockup) — MEDIUM

**Source (mockup, `nodeColor`):**
> `return p.churn >= HOT_THRESHOLD ? HOT : LAYER_COLOR[p.layer]`

In the mockup's structure mode, a hot node's fill colour is *replaced* by
`--hot #ff7a3d` — the layer colour disappears entirely. FR-13 requires only
"colour = Layer (Structure mode), glow intensity ∝ Churn; hot spots pulse" —
which reads as layer colour + glow + pulse, a visibly different encoding. The
mockup legend's separate "hot spot" swatch confirms this is intended visual
language. The PRD neither requires the colour override nor declares a
deviation, yet SM-6 demands "palette and interaction constants match the
mockup".

**Where to address:** FR-13 — either require "in Structure mode, Nodes at/above
the hot-spot threshold render in `--hot` instead of their Layer colour, and the
legend carries a hot-spot entry", or state a deliberate deviation.

## F4. Click on empty canvas: deselect, close panel, clear isolate — MEDIUM

**Source (mockup, mouseup handler):**
> `if (index >= 0) openPanel(index) else { panel.classList.remove("open"); selectedIdx = -1; isolateIdx = -1 }`

The mockup's only ways to exit a selection are the panel's × button and
clicking empty canvas — the latter also clears isolate mode. The PRD covers
closing via the panel (FR-20: isolate "persists until toggled off or the panel
closes") but never specifies how the panel/selection/isolate are dismissed from
the canvas. Without it, isolate mode has no obvious exit besides the tiny ×.
Related mockup behaviour also unspecified: drag-vs-click discrimination (a drag
that moved must not trigger selection).

**Where to address:** FR-19/FR-20 consequences — clicking empty canvas closes
the panel, clears selection and isolate; a completed drag is not a click.

## F5. Selected-node ring — MEDIUM

**Source (mockup, draw loop):**
> `if (i === selectedIdx) { ctx.strokeStyle = "rgba(230,238,252,0.85)" ... ctx.arc(s.x, s.y, rr + 5, ...) }`

The mockup draws a light ring around the selected node while the panel is
open — the only on-canvas indication of which node the panel describes. No FR
mentions any selection indicator. Silent drop of an orientation cue.

**Where to address:** FR-19 consequence — the selected Node carries a visible
selection indicator (ring per mockup) while the panel is open.

## F6. Persistent search box and hint overlay (mockup UI elements) — MEDIUM

**Source (mockup):** the always-visible `#search` box (top-left, placeholder
"find module or file", `⌘K` kbd hint) and the `.hint` overlay (bottom-right):
> "drag to pan · scroll to zoom / zoom in past 1.8× to unfold files / hover for dependency chain · click for detail"

FR-18 specifies search as a *shortcut* ("`Cmd/Ctrl+K` (and `/`) focuses a fuzzy
search") without requiring the persistent input to exist on screen, and no FR
mentions the hint overlay — the product's only in-UI affordance discovery
(notably the 1.8× unfold, which is otherwise undiscoverable). Both are part of
the mockup's observable UI that SM-6 gestures at but no FR requires.

**Where to address:** FR-13 (chrome/overlays) or FR-18 — require the persistent
search input with shortcut hint, and a controls hint overlay; or declare
deviations.

## F7. Fly-to target zoom levels — LOW

**Source (mockup, `flyTo`):**
> `const targetK = p.kind === "file" ? 3 : 2`

FR-18 fixes the fly-to duration (≈ 620 ms, ease-out) but not the destination
zoom: 2× for a Module, 3× for a File. The File value matters — 3× is exactly
the file-label threshold (FR-16) and above the 1.8× unfold, so arriving at 3×
is what makes "searching a File inside a collapsed Module unfolds that Module
on arrival" (FR-18) actually work and label the target.

**Where to address:** FR-18 consequence — target zoom 2× (Module) / 3× (File),
or an equivalent "arrival zoom ≥ unfold threshold for Files" rule.

## F8. Reduced-motion coverage incomplete (fly-to) — LOW

**Source (mockup, `flyTo`):**
> `dur = reduceMotion ? 1 : 620`

The PRD honours `prefers-reduced-motion` for settling (FR-12) and hot-spot
pulse (FR-13), but not for the search fly-to, which the mockup makes
effectively instant. Partial parity with a behaviour the PRD elsewhere claims
("parity with the mockup's behaviour").

**Where to address:** FR-18 consequence — under `prefers-reduced-motion` the
fly-to jumps without animation.

## F9. Starfield background only in prose, no testable requirement — LOW

**Source (mockup, `seedStars`):** 220 faint stars (alpha 0.03–0.15, two dot
sizes) drawn behind the graph — a defining piece of the "nebula" aesthetic.
The PRD's §4.4 description says "Dark canvas, stars, glowing nodes" but no FR
consequence or SM-6 checklist item requires the starfield, so FR-driven story
slicing can drop it without violating any acceptance criterion. Given brief §4
("Wow is a requirement… acceptance criteria, not nice-to-haves") the aesthetic
needs at least one checkable anchor.

**Where to address:** FR-13 consequence (starfield background per mockup) or an
explicit SM-6 human-review checklist entry.

## F10. Tooltip content narrowed: brief says "name and metrics" — LOW

**Source (brief §5.4):**
> "tooltip with name and metrics."

FR-17 pins the tooltip to "name and churn" (the mockup's
`id · churn 61%`). "Metrics" plural is arguably satisfied by churn alone, but
the narrowing is silent — a reader of the brief could expect LOC/authors in the
tooltip. One line acknowledging "tooltip = name + churn; full metrics live in
the panel" would close it.

**Where to address:** FR-17 — note the deliberate reduction.

## F11. Stats bar module count — LOW

**Source (mockup header):**
> `<span>312 files</span><span>41.2k loc</span><span>9 modules</span><span>1,847 commits</span><span>py 61% · ts 39%</span>`

The mockup's stats bar includes a module count; the brief's list (§5.3) and
FR-13 ("repo name, files, LOC, commits, language shares") do not. Tiny, but it
is an observable mockup element the PRD neither requires nor deviates from, and
the Contract's `repo.stats` has no module count either (trivially derivable
from nodes).

**Where to address:** FR-13 — add module count to the stats bar, or note the
omission as intended.

## F12. "Runs on 3 public repos without crashing" only partially traced — LOW

**Source (brief §10.7):**
> "Runs on 3 popular public repositories (different structures) without crashing and with a visually sensible result."

Mostly covered piecewise (FR-1: exit 0 + served map on the three demo repos;
FR-9: "visually sensible layer maps" human-review item; SM-1 timing), but no
single SM states the crash-free + visually-sensible criterion as such —
"visually sensible" in FR-9 covers layer assignment only, not the overall map
(layout, readability). Worth one explicit line so DoD 7 has a home.

**Where to address:** SM-1 or a human-review checklist item — "each demo repo
produces a crash-free, visually sensible map (human review)".

---

## Non-findings (checked, handled)

- Membership `member` edges, `commits90d` addition, module-level co-change —
  explicit deltas in addendum A3.
- Unfold-everything vs viewport-scoped unfold — explicit deviation in FR-16.
- Hover dim numbers (brief ~20% vs mockup 0.1/0.03) — reconciled in FR-17.
- Substring (mockup) vs fuzzy (brief) search — PRD follows the brief, stricter.
- `gn` alias, tree-sitter choice, hot-spot *algorithm*, layer heuristics,
  build-format limits — resolved or parked as open questions/addendum entries.
- Zoom clamp [0.4, 6.0], `UNFOLD_ZOOM` 1.8, `HOT_THRESHOLD` 0.5, 620 ms fly-to,
  3.0× file labels, palette hexes — all match the mockup constants.
