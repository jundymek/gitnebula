# PRD Quality Review — gitnebula MVP

## Overall verdict

This is a decision-ready PRD: it resolves every open question the brief posed (TS-only analyzers, hot-spot algorithm, bundle shape), fixes the numbers acceptance criteria will cite, and keeps its own stated rules — stable FR IDs, glossary discipline, tagged-and-indexed assumptions with a clean roundtrip. What's at risk is a small set of definitional gaps that parallel AI agents will hit when writing tests — "settled" is never operationally defined, one aesthetic duration is "≈", and the brief's repo-quality DoD items (README demo, license, CONTRIBUTING) fall through the crack between "delivery process lives elsewhere" and "product requirement." None of these blocks architecture; all should be patched before story freeze.

## Decision-readiness — strong

The PRD states decisions as decisions and shows its work. The brief's §11 open questions are all answered: TS-only analyzers via the TypeScript compiler API + web-tree-sitter WASM (addendum A1, with the rejected Python-process alternative named and the reason — node-gyp breaks the `npx` promise — given); the hot-spot algorithm is fully specified (`min(1, commits90d / P95(...))`, threshold 0.5, addendum A2 explains why P95-not-max and why module metrics are counted directly rather than summed); the bundle shape is fixed (FR-23: ≤ 2 MB gzipped, `analysis.json` as a sibling file, `file://` explicitly unsupported with the reason tagged as an assumption). Trade-offs name what was given up: FR-16 flags its deviation from the mockup ("the user-visible behaviour is identical, the simulation cost is not"); §6.2 rejects the `gn` alias with a concrete collision reason; SM-C2/C3 explicitly rank aesthetics over frame rate and bundle size, which is a real prioritization call, not a balance-everything dodge.

§8 Open Questions are genuinely open — each names the deciding phase (architecture) and the FRs it gates, and none contains its own answer. Question 4 (the d3-force performance spike) is correctly positioned as a feasibility gate *before* viz stories freeze, which is exactly the kind of sequencing signal the downstream epic phase needs.

### Findings

- **low** No `[NOTE FOR PM]` callouts anywhere (§ whole document) — the PRD's tensions are all routed into §8 Open Questions with owners, which does the same work, but the one place a PM-level (not architecture-level) tension exists — whether SM-1's 60 s budget on "maintainer's laptop" is an honest proxy for user hardware — carries only an `[ASSUMPTION]` tag. *Fix:* either accept the assumption-tag convention as covering this, or add one `[NOTE FOR PM]` at FR-1/SM-1 acknowledging the reference-hardware proxy is unvalidated.

## Substance over theater — strong

Nothing here is furniture. The three UJs (§2.3) each drive real requirements: Marta's edge case (vendored directory dominating the map) directly motivates FR-4's default excludes and the one-line config fix; Tomek's journey is the entire reason FR-23/FR-24 exist as separate FRs rather than a bullet; Ola's co-change evidence path is what justifies bounded module-level Co-change pairs in the Contract (FR-7) and the top-3 list in FR-19. Non-Users (§2.2) is doing honest work — "graceful degradation, not support" for other languages is a scope statement, not filler.

The Vision (§1) could not be swapped into another PRD: "the structure tells you where things are; the history tells you where things *happen*" is this product's specific thesis, and "the product doubles as its own demo" is a launch mechanic the FRs actually implement (FR-24, SM-5). NFRs carry product-specific numbers throughout (60 s, 55/60 fps, ≤ 5 MB Contract, ≤ 2 MB bundle, 0.2 dim opacity, 1.8× unfold, [0.4, 6.0]× clamp) rather than adjectives.

### Findings

None.

## Strategic coherence — strong

The thesis — deterministic local analysis where git history is the differentiating layer on top of structure — is stated in §1 and holds at every scoping decision, matching the brief's §2.1 instruction to "hold this at every scoping decision." The MVP is a coherent experience-plus-platform scope: the Contract-first ordering (§4.2 "Built first so the Viewer can be developed against fixtures") is a strategic bet on parallel implementation, not an engineering afterthought, and it aligns with the brief's §13.2.4 mandate.

Success metrics validate the thesis, not activity: SM-1 (time-to-map) tests the zero-barrier claim, SM-3 (offline integrity) tests local-first, SM-6 (visual fidelity) tests "wow is a requirement," SM-5 (dogfooding) tests the self-demo launch mechanic. Counter-metrics exist and are genuinely adversarial to the primaries — SM-C1 pins the unresolved-import rate against SM-1's speed, SM-C2 pins the aesthetic against SM-2's frame rate. This is the strongest counter-metric section I've seen at this scale of PRD.

### Findings

- **low** SM coverage gap over the interaction FRs (§7) — FR-18 (search), FR-19/20 (panel), FR-21 (modes), FR-22 (PNG export) are validated by no SM. Defensible — SMs validate the thesis, and these FRs carry their own testable consequences — but the brief's DoD item 3 ("the full flow from section 5 works") has no PRD-level metric mirroring it. *Fix:* either add a secondary SM ("full-flow checklist: every §4.5–4.8 consequence green") or state that FR-level consequences are the validation for those sections.

## Done-ness clarity — adequate

Held to the PRD's own rule — "fixes the numbers that acceptance criteria will cite" — most FRs pass. Every FR has at least one genuinely testable consequence; many are exemplary (FR-7's byte-identical determinism clause, FR-10's zero-history no-NaN case, FR-11's >20% unresolved = test failure, FR-6's hand-authored edge-case fixture list). Vague language is rare and usually caught by the PRD itself (human-review checklist items are explicitly marked, per brief §13.2.5). But the remaining soft spots sit exactly where the downstream consumers are parallel AI agents writing acceptance criteria, so they cost more here than they would in a human-consumed PRD.

### Findings

- **medium** "Settles" is never operationally defined (§4.4 FR-12) — "settling duration 2–3 s on the 100-module fixture (measured, not felt)" is a measurement of an undefined event. Settled when alpha decays below a threshold? When node displacement per tick falls under a pixel bound? Two agents will pick two definitions and both tests will be unfalsifiable against each other. The addendum (A4) mentions "freeze the simulation when alpha decays below threshold" but never binds that to FR-12's clock. *Fix:* define settled in the Glossary or FR-12 (e.g. "simulation alpha < X" or "max node displacement < Y px/frame for Z frames") — the exact constant can be an `[ASSUMPTION]` for architecture, but the *definition* must be fixed here.
- **medium** "Average laptop" in FR-14's headline is undefined (§4.4) — the consequence rescues automation (55 fps floor on a scripted harness), but "60 remains the target on real hardware" points at hardware defined nowhere. FR-1's reference-hardware assumption covers only the 60 s budget. *Fix:* extend the FR-1 assumption to cover FR-14's 60 fps human target, or drop "average laptop" from the headline and let the harness consequence carry the requirement.
- **low** Approximate duration in FR-18 (§4.5) — "fly-to animation ≈ 620 ms" is the only "≈" in a document that elsewhere writes exact bounds. An agent cannot write an AC against "≈". *Fix:* "620 ms ± 50 ms" or "620 ms (mockup constant, exact)".
- **low** "Actionable message" in FR-3 (§4.1) — an adjective where the rest of the FR is concrete. *Fix:* one example of the required shape (stage name + cause + suggested remedy) or a reference to a message format fixed in architecture.

## Scope honesty — adequate

The assumption discipline is real: 8 inline `[ASSUMPTION]` tags, all 8 indexed in §9, index entries all resolve back to inline tags — a clean roundtrip. §5 Non-Goals does real work (each entry blocks a plausible silent assumption: no GitHub API, no telemetry, no third zoom level), and the `[NON-GOAL for MVP]` callout at FR-8 sits exactly where a reader might assume LLM work was in scope. De-scoping is done in the open — the `gn` alias (§6.2) is rejected with a reason and a revisit condition, not dropped silently. Open-items density (6 Open Questions + 8 assumptions) is appropriate for launch stakes because every item names its resolution phase and gated FRs.

One genuine scope gap keeps this from strong: the brief promotes repo quality to a product requirement, and part of it has fallen between this PRD and the delivery-process documents.

### Findings

- **medium** Brief DoD item 6 is only partially carried (§ whole document vs brief §10.6) — the brief makes "README with a 30-second demo (GIF/video) and a map of itself, MIT license, CI with tests, CONTRIBUTING.md" a definition-of-done item and states (§2) that "repo quality... [is a] product requirement, not decoration." The PRD carries the map-of-itself (SM-5, FR-24) and CI implicitly, but the 30-second demo video, MIT license, and CONTRIBUTING.md appear nowhere — and they are not delivery-*process* items of the kind §0 legitimately routes to brief §13/CLAUDE.md. Downstream epic breakdown reads this PRD, so these can be silently dropped. *Fix:* add a launch-readiness FR or secondary SM covering the brief's repo-quality DoD, or an explicit §0/§5 line stating where those items are owned.
- **low** "Full dependency chain" narrowed to one hop without a flagged decision (§3 Glossary vs brief §5.4) — the brief says hover "highlights the full dependency chain (in + out)," which can be read as transitive; the Glossary fixes it at one hop. Probably the right call (transitive highlight on a dense graph is noise), and the mockup likely behaves this way, but unlike FR-16 the deviation-or-clarification is not called out. *Fix:* one sentence in the Glossary entry: "one hop, deliberately — transitive chains are a v2 candidate" (or "matching the mockup").

## Downstream usability — strong

This dimension carries the most weight for a chain-top PRD feeding architecture and parallel agents, and it holds. FR-1 through FR-24 are contiguous with no duplicates; every SM→FR cross-reference resolves; UJ-1/2/3 have named protagonists (Marta, Tomek, Ola) carrying context inline. The Glossary is load-bearing, not decorative — Node/Module/File/Layer/Contract/Bundle/Dependency chain are used with consistent capitalization across FRs, and the Contract entry gives the architecture workflow its central noun. Sections extract cleanly: each FR restates its terms via the Glossary rather than "see above," and the addendum correctly quarantines implementation rationale (A1–A5) so the PRD narrative stays extractable without it. A6 pre-recording the terminal-agents story-format constraints is a thoughtful hand-off to the epic phase.

Numeric cross-consistency checks out: churn threshold 0.5 (Glossary = FR-19 = addendum A2 = mockup `HOT_THRESHOLD`); co-change bounds (count ≥ 3, top 500) identical in FR-7, §8.3, §9, and A3; the ≤ 5 MB Contract budget stated as the binding requirement in all three places; unfold 1.8× and dim 0.2 consistent between FR-16/FR-17 and SM-6's fidelity check; SM-2's "2,000-file fixture" is FR-14's synthetic fixture.

### Findings

- **low** `churn90d`/`commits90d` field names hard-code 90 days while the Analysis window is configurable (§3 Glossary, FR-4, FR-7, FR-10) — with a 30-day window configured, the Contract still emits fields named `*90d` computed over 30 days. A schema consumer (or the post-MVP describe layer) reading the field name will mis-infer the window. *Fix:* either rename in the schema (`churnWindow`/`commitsWindow` plus a `windowDays` repo field) or add a Glossary sentence stating the `90d` suffix is a field name, not a semantic guarantee, and the window is carried in repo metadata — decide before the schema freezes in architecture, since it is a breaking change after.

## Shape fit — strong

Correctly shaped: a chain-top OSS developer tool with meaningful UX, so UJs with named protagonists are load-bearing (they are — three, not eight, each mapped to the FR groups that realize them via "Realizes UJ-n" lines), FRs are capability-spec with testable consequences (right for CLI + pipeline), and downstream traceability is treated as first-class (stable FR IDs, Glossary, assumption index), matching the brief's §13 execution model. The PRD resists over-formalization — no persona biographies, no market-sizing theater — and §0 correctly draws the boundary between product requirements (here) and delivery-process requirements (brief §13 / CLAUDE.md), with addendum A6 bridging so the epic phase doesn't rediscover the constraints. Palette hex values and mockup constants in FRs are not implementation smuggling: the brief (§13.2.5) explicitly mandates grounding aesthetics in reference artifacts, and `reference/mockup.html` is declared a behavioural reference, not an implementation base.

### Findings

None.

## Mechanical notes

- Assumptions Index roundtrip: clean — 8 inline `[ASSUMPTION]` tags (FR-1, FR-2, FR-4, FR-7, FR-9, FR-10, FR-14, FR-23), all indexed in §9; no orphan index entries.
- FR IDs 1–24 contiguous, unique; SM-1..6 + SM-C1..3 unique; all SM→FR references resolve.
- Glossary drift, minor: UJ-3 says "change heatmap mode" (lowercase, the brief's phrasing) where the Glossary term is "Heatmap mode"; §4.7 heading pluralizes ("Structure and Heatmap modes"). Cosmetic.
- Glossary omission, minor: `commits90d` is used in FR-7/FR-10 and the addendum but has no Glossary entry (Churn's entry covers only the normalized form).
- Cross-reference style: addendum A4 cites "PRD §8.4" meaning §8 Open Questions item 4 — reads at first glance like a section number that doesn't exist. Prefer "§8 Q4".
- UJ protagonists all named (Marta, Tomek, Ola); no floating UJs.
- Required sections for launch stakes and chain-top position all present: Vision, users + UJs, Glossary, FRs with consequences, Non-Goals, MVP scope, SMs with counter-metrics, Open Questions, Assumptions Index.
