# ADR-0008: `other` gets a fifth layer hue, departing from the mockup's palette

Status: accepted
Date: 2026-09-08
Story: 6.5-viz-testids-and-debts

## Context

`reference/mockup.html` is the visual reference for `viz`, and UX-DR1 pins its
palette exactly: `--backend #3fcfa0`, `--frontend #9b8cff`, `--infra #7c8598`,
`--test #a8cf52`, `--hot #ff7a3d`, void `#060911`. The mockup's `LAYER_COLOR`
(line 515) knows **four** layers, and its legend names four.

The contract knows **five**. `Layer` has always included `other`, the bucket a
file falls into when no rule in ADR-0002's table claims it. Story 2.5 gave it a
colour by taking the infra grey, with the reasoning recorded in the source:

> The contract has a fifth layer the mockup's legend does not name; it takes
> the infra grey rather than inventing a sixth hue.

That was sound while `other` was invisible in the chrome. Two later stories
removed both halves of the premise:

- **Story 5.3** gave every layer a filter toggle, including `#layer-other`. So
  `other` became a control the reader can press.
- **Story 5.3 also measured the layer distribution on this repository**:
  `other` **145**, `backend` 111, `test` 97, `frontend` 7, `infra` **3**, of
  363 nodes. `other` is the *largest* layer and `infra` is the smallest — the
  two sharing a swatch are the most and least common things on the map.

The result was debt 7a from the Epic 5 retrospective: a toggle labelled
`other`, controlling 40% of the nodes, with no legend key. Story 5.3 reported
it to 5.5, and **5.5 declined it, correctly** — adding a fifth legend entry on
the existing palette draws two identical grey swatches, which makes the legend
actively misleading rather than merely incomplete. The reader looks up
`#7c8598` and finds two answers. What was missing was not a line of code but a
palette decision, and the maintainer took it on 2026-09-05: **`other` gets its
own fifth hue.**

Two further colours constrain the choice and are easy to miss, because neither
is in UX-DR1's list:

- `--cochange: #ff5fa2` (story 5.6) — the co-change ring, hue ~338.
- `--hot #ff7a3d` — which in structure mode **replaces** a node's layer colour
  and pulses. It is the map's alarm signal and must stay unique.

## Decision

**1. `LAYER_COLOR.other` becomes `#cf81cf`,** a moderate orchid at hue 300,
replacing the `#7c8598` it shared with `infra`.

**2. `LEGEND_ENTRIES` gains an `other` entry,** placed after the mockup's four
layers and before `hot spot`. The mockup's four keep the mockup's order;
`hot spot` stays last because it is not a layer.

**3. No two legend entries may share a colour, and a test enforces it.**
`legend.test.ts` fails with the offending pair named — the assertion that would
have caught the original defect — plus a second test asserting that every layer
the filter can switch off has a legend key.

**4. UX-DR1 is not amended, because it never covered `other`.** Its inventory
is the mockup's four layers plus `--hot` and the void. `LAYER_COLOR.infra`
remains `#7c8598` and is pinned by both `render.test.ts` and `legend.test.ts`.
This ADR adds a colour outside UX-DR1's scope; it does not contradict it.

### How the hue was chosen

Candidates were scored by CIE L\*a\*b\* distance (ΔE76) against every colour
already on the canvas, with two constraints the raw metric does not express:
legibility on the `#060911` void, and a wide berth around `--hot`. Measured:

| candidate | backend | frontend | infra | test | hot | cochange | min ΔE | L\* | contrast on void |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `#7c8598` (the old shared grey) | — | — | **0.0** | — | — | — | **0.0** | 55.0 | 4.7 |
| **`#cf81cf` orchid (chosen)** | 100.2 | 29.3 | **45.3** | 112.7 | 83.6 | 34.5 | 29.3 | 64.5 | 7.3 |
| `#7ac8d8` cyan | 40.4 | 66.9 | **29.8** | 72.8 | 98.1 | 88.0 | 29.8 | 76.3 | 10.5 |
| `#95dee4` pale cyan | 37.0 | 72.8 | **36.2** | 67.6 | 96.3 | 90.1 | 36.2 | 84.1 | 13.1 |

The orchid's nearest neighbour is `frontend` at ΔE 29.3, and that is the right
neighbour to be nearest to: `frontend` is **7 of 363 nodes** on this
repository, while the layers `other` must be told apart from at a glance are
the common ones — `backend` (ΔE 100) and `test` (ΔE 113). Against `infra`, the
colour this whole ADR exists to separate it from, the orchid scores **45.3**,
the largest separation of any candidate considered.

### Rejected alternatives

**Cyan, in either the muted or the pale form.** Both score their *minimum*
against `infra` — 29.8 and 36.2 — because cyan sits between `backend` (hue
160) and `infra` (hue 215). Putting the new hue next to the very colour it is
being separated from re-creates the confusion the change exists to remove, and
does so at swatch size, where the legend key is a few pixels of
`<i class="dot">`. The pale variant is worse than its number suggests for a
second reason: at L\* 84 it would be the brightest thing on the canvas, applied
to 40% of the nodes, competing with the hot-spot signal.

**A pale yellow-green (hue 65–90).** Scored highest of all on raw ΔE (up to
41.9), and was rejected on inspection: it sits in `test`'s hue family and the
high score is an artefact of ΔE76 being unreliable for light, desaturated
colours. Three greens on one map is not a palette.

**A rose or magenta near hue 330–340.** The natural "nebula" choice — emission
nebulae are pink from H-alpha — and rejected because `--cochange #ff5fa2`
already occupies that arc. A pink node fill beside a pink co-change ring is two
different meanings in one hue.

**Keeping the grey and dropping the `other` toggle instead.** This would also
remove the contradiction, and it was not ours to take: story 5.3's toggle
implements FR-28, and removing a shipped control is a scope decision for the
maintainer, not a palette fix.

**Giving `infra` the new hue and leaving `other` grey**, on the argument that
the unclassified bucket is the one that should read as neutral. Genuinely
attractive — but it inverts a decision the maintainer had already taken in the
specific direction recorded above, and reversing that is an escalation rather
than an edit.

## Consequences

### The legend now keys every layer the filter offers

FR-28's five toggles and UX-DR13's "active set legible" are satisfiable
together: every control the reader can press has a key naming what it controls.
This was the actual user-visible defect, and it is closed.

### The map's largest layer changes colour

40% of the nodes on this repository were grey and are now orchid, which is the
single most visible change in Epic 6 — the epic is otherwise entirely
verification. Two mitigations are built in: the hue is moderate rather than
saturated, so it recedes at the density `other` reaches; and `--hot` still
replaces the layer colour in structure mode, so the alarm signal is unaffected.

`infra`'s three nodes keep the grey they had, so nothing about the *reference*
layers moves.

### The mockup and the shipped palette now differ, deliberately

`reference/mockup.html` remains the behavioural reference for palette, glow,
curve and threshold constants, and this is the first place the shipped viewer
knowingly carries a colour the mockup does not. The rule that keeps this from
becoming drift: the mockup's four layer hues, `--hot` and the void are still
byte-identical to UX-DR1, and any further departure needs its own ADR.

A reader comparing the two will now find a fifth swatch in the running viewer.
That is expected, and this file is the answer.

### `styles.css` deliberately gains no `--other`

The stylesheet declares `--backend`, `--frontend`, `--infra`, `--test` and
`--hot`, of which only `--backend` is actually consumed (for focus and active
states). The legend swatch takes its colour from `LAYER_COLOR` at render time,
so no CSS variable is needed, and adding an unused one would be a second place
for the value to live and drift. If a future story styles by layer variable, it
should add all five together.

### Two identical swatches can no longer ship

The no-duplicate-colours test generalises past this one defect: it also guards
`hot spot` against every layer. The narrower lesson is worth stating, because
it is what let 7a survive two stories — **a colour chosen "rather than
inventing a hue" is a decision with an expiry date.** It was correct while the
layer was invisible and became a defect the moment the layer gained a control,
and nothing in the code recorded that dependency. The test does now.
