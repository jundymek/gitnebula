# Human-review checklist

Acceptance criteria that cannot be verified automatically (PRD §13.2.5 rule:
collected here, not scattered). Walked by the maintainer; the walk itself is
story 4.4's owner gate. Check items only with the evidence named.

## Per demo repo (fastapi @ pinned SHA, excalidraw @ pinned SHA, streamlit @ pinned SHA)

- [ ] Map loads crash-free from `npx gitnebula` (record timing; ≤ 60 s — SM-1)
- [ ] The module map is *visually sensible*: recognizable top-level structure,
      no absurd giant/orphan nodes, no obviously wrong layer colours (FR-9)
- [ ] Layer assignment spot-check: 5 files per repo, rule table verdict matches
      human judgement (ADR-0002)
- [ ] Hot spots point at plausibly active areas (sanity vs `git log` — ADR-0003)
- [ ] Unresolved-import rate recorded and ≤ 20% (FR-11)

## Visual fidelity vs `reference/mockup.html` (SM-6, non-automatable half)

- [ ] Overall nebula impression matches: glow quality, edge curvature, star
      density, dark-void depth (side-by-side eyeball)
- [ ] Settle animation *feels* like the mockup's (the 2–3 s number is
      automated; the character of the motion is not)
- [ ] Hot-spot pulse reads as a pulse, not a blink
- [ ] Hover dim/highlight reads instantly at 2,000 files
- [ ] Heatmap gradient is legible cold→hot at both zoom levels

## Interaction feel (target 60 fps — the automated floor is 55)

- [ ] Pan/zoom feels smooth on the maintainer's hardware at the synthetic
      fixture (record hardware + subjective verdict)
- [ ] Search fly-to lands where expected and the pulse draws the eye
- [ ] Semantic zoom unfold/collapse never visibly "pops" the global layout

## Repo quality (FR-25 / SM-7)

- [ ] README demo GIF actually shows the wow in ≤ 30 s
- [ ] Map-of-itself on Pages is current with master
- [ ] A newcomer can go README → `npx gitnebula` → map without further docs

## Sign-off

- [ ] All above checked or a follow-up issue filed per unchecked item
- Maintainer: ______  Date: ______  Hardware: ______
