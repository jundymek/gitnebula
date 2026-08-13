# gitnebula — MVP definition-of-done report

**Run date:** 2026-08-13 · **Story:** `4.4-dod-validation` · **Milestone:** M3

This is the measurement behind the claim that the MVP is done. Every threshold
the brief (§10) and the PRD (SM-1..SM-7) name is executed against three public
repositories and recorded here as a number. Nothing is summarised as "fine": a
number that misses its budget is printed in the table with an issue link next to
it, because a red number with an issue is a valid outcome and a hidden one is
not.

The half of the definition of done that cannot be automated —
"visually sensible", "feels smooth", "a newcomer can follow the README" — is
the maintainer's. It is reproduced at the end of this report with the evidence
links prefilled, **deliberately unticked**. Superman reports readiness; the
owner signs.

## Reference hardware

| | |
| --- | --- |
| machine | Apple M4 Pro, 12 cores, 48 GB |
| OS | macOS 26.5.2 (25F84) |
| runtime | Node 22.20.0, pnpm 10.34.5, git 2.50.1 |
| browser | Playwright 1.62.1 / Chromium 151.0.7922.34, canvas 1440 × 845 CSS px, DPR 1 |

The same machine story 3.5 measured the frame rate on, so the fps rows here are
directly comparable with that story's record.

## Demo repos, pinned

Full clones (churn needs history), **nothing installed** — no `npm install`, no
`pip install`. That is the harder case and the one `npx gitnebula` meets on a
fresh checkout; stories 2.2 and 3.1 measured the same way.

| repo | pinned SHA | HEAD date | why this repo (addendum A7) |
| ---- | ---------- | --------- | --------------------------- |
| [fastapi](https://github.com/fastapi/fastapi) | `f336ff831c4af3d4f625c2593a27b1e0cae93eb7` | 2026-08-12 | Python, docs-heavy, flat package layout |
| [excalidraw](https://github.com/excalidraw/excalidraw) | `abeeaeba217ab3b5193b78c8d8d63c373b518ced` | 2026-08-11 | TS/JS monorepo, asset-heavy |
| [streamlit](https://github.com/streamlit/streamlit) | `72b8aa9d9ba6cc678546c2247474a5ae7b604290` | 2026-08-13 | mixed Python + TS, the largest of the three |

Reproduce a row with:

```bash
git clone https://github.com/<org>/<repo>.git && git -C <repo> checkout <sha>
gitnebula <repo> --no-serve -o <repo>.json
```

## Per-repo definition of done (AC-1)

Wall clock is the **median of three runs** after one discarded warm-up; the
spread across the three was ≤ 0.05 s on every repo. Clone time is excluded —
SM-1 is about analysing a repository you have.

| repo | wall clock (≤ 60 s) | crash-free | `analysis.json` (≤ 5 MB) | unresolved imports (≤ 20%) | schema |
| ---- | ------------------- | ---------- | ------------------------ | -------------------------- | ------ |
| fastapi | **1.19 s** ✅ | ✅ exit 0 | **1.32 MiB** ✅ | **0.00%** ✅ | ✅ valid |
| excalidraw | **0.95 s** ✅ | ✅ exit 0 | **0.94 MiB** ✅ | **6.34%** ✅ | ✅ valid |
| streamlit | **2.69 s** ✅ | ✅ exit 0 | **2.16 MiB** ✅ | **3.74%** ✅ | ✅ valid |

**All 15 cells pass. The tightest margin is streamlit's runtime, 22× under
budget.**

### What each column means

- **Wall clock** — `gitnebula <repo> --no-serve`, the full pipeline. Per-stage
  numbers and the three raw runs are in
  [`docs/dev/epic-4/4.4-dod-validation/PERFORMANCE.md`](dev/epic-4/4.4-dod-validation/PERFORMANCE.md).
- **Crash-free** — exit code 0 and no aborted stage. Per-item failures are
  counted warnings by design (AD-7) and are listed per repo below.
- **`analysis.json`** — the emitted document, on disk.
- **Unresolved imports** — `unresolved-import ÷ (resolved file import edges +
  unresolved-import)`, the denominator stories 2.2 and 3.1 established:
  externals are ignored by design, not failures to resolve. The reading over
  *all* specifiers is given below and is lower in every case.
- **Schema** — the emitted file re-validated against
  `@gitnebula/contract`'s validator, independently of the run that produced it
  (the pipeline also validates in `assemble`, so this is a second, on-disk
  check). All three: `schemaVersion 1.0`, valid.

### Graph and resolution detail

| | fastapi | excalidraw | streamlit |
| --- | --- | --- | --- |
| files analysed | 2,892 | 930 | 2,516 |
| LOC | 257,184 | 245,523 | 548,971 |
| modules | 6 | 17 | 11 |
| nodes / edges | 2,898 / 1,612 | 947 / 3,424 | 2,527 / 6,364 |
| co-change pairs | 134 | 146 | 517 |
| commits in the 90-day window | 531 | 78 | 646 |
| specifiers resolved to edges | 1,608 | 3,397 | 6,361 |
| external (stdlib, packages) | 1,885 | 585 | 6,485 |
| outside universe | 0 | 1 | 3 |
| unparsable files | 0 | 0 | 1 |
| **unresolved** | **0** | **230** | **247** |
| rate over edge-capable specifiers | **0.00%** | **6.34%** | **3.74%** |
| rate over all specifiers | 0.00% | 5.46% | 1.89% |

Three details checked rather than assumed:

- **excalidraw's 230 unresolved are font and stylesheet assets** — the example
  the warning keeps is `./CascadiaCode-Regular.woff2 in
  packages/excalidraw/fonts/Cascadia/index.ts`. They are real relative imports
  of real files, but the scanner's universe does not list `.woff2`, so nothing
  in the graph can answer them. Story 2.2 resolved this class of import when
  the asset was in the universe; these are the residue where it is not. Under
  the 20% threshold, and honest to leave as counted misses.
- **streamlit's 247 unresolved reproduce story 3.1's number exactly**, on a
  newer SHA — the same intra-repo workspace packages (`@streamlit/protobuf`)
  reached by bare specifiers that only an installed `node_modules` could
  answer.
- **streamlit's one unparsable file** is `e2e_playwright/compilation_error_dialog.py`,
  which streamlit keeps deliberately broken to test its own error dialog. The
  parser is right about it.

### Map exports

The Viewer's own PNG export (story 3.5's export path, not a screenshot), taken
after the layout reached Settled, at 1440 × 845 CSS px:

| repo | export |
| ---- | ------ |
| fastapi | [`map-fastapi.png`](dev/epic-4/4.4-dod-validation/map-fastapi.png) |
| excalidraw | [`map-excalidraw.png`](dev/epic-4/4.4-dod-validation/map-excalidraw.png) |
| streamlit | [`map-streamlit.png`](dev/epic-4/4.4-dod-validation/map-streamlit.png) |

The committed files are downscaled to 1440 px wide and quantised to 256 colours
so three images do not add 30 MB to a repository whose quality is a product
requirement. The export itself is the full 2× re-render (2880 px wide,
~10 MB for fastapi) — that is what a user gets from the button.

**They do not all show the same thing, and that is the product working as
specified**: fastapi's map opens above `UNFOLD_ZOOM` and shows unfolded files;
excalidraw's and streamlit's open below it and show collapsed modules
(ADR-0006, viewport-scoped semantic unfold). The framing is whatever the engine
chose when it framed the graph, untouched.

## Global checks (AC-2)

| check | budget | result |
| ----- | ------ | ------ |
| offline run, network disabled | must complete | ✅ all three repos, exit 0 |
| offline output vs networked output | — | ✅ byte-identical apart from `analyzedAt` |
| sustained fps, headed (60 Hz) | ≥ 55 | ✅ **59 / 59** (both phases) |
| sustained fps, headless | ≥ 55 | ✅ **119** (frozen), **82** (unfold) |
| settle duration, headed | 2–3 s | ✅ **2.60 s** |
| viewer bundle, gzipped | ≤ 2 MB | ✅ **59.75 kB** (3.0% of budget) |
| bundle issues requests only to its own two files | zero external | see below |

### Offline (SM-3, brief §10.4)

macOS has no per-process network namespace, so the run is wrapped in a kernel
sandbox that denies networking outright:

```bash
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /usr/bin/env node <cli> <repo> --no-serve -o <out>.json
```

The denial was proved in both directions before it was trusted: inside the
sandbox `curl https://github.com` fails with `Could not resolve host` (exit 6)
and `git ls-remote` cannot reach GitHub; outside it, the same commands succeed.

All three repos analysed to completion under that sandbox, and each offline
document is **byte-identical to the networked one apart from `analyzedAt`** —
which is the determinism property AD-4 exists for, measured on real
repositories rather than on a fixture.

Scope of the claim: this covers the **pipeline**, which is where the local-first
promise lives. The Viewer's half is covered by the zero-external-requests check
on the built bundle, because `deny network*` blocks loopback too and would stop
the local server from being reachable at all.

### Frame rate (SM-2, FR-14)

Story 3.5's harness, unchanged, on story 1.3's committed 100-module /
2,000-file fixture. Full table in
[PERFORMANCE.md](dev/epic-4/4.4-dod-validation/PERFORMANCE.md).

The headed number is the one the product claim rests on: **59 fps sustained in
both phases**, where 59 is the vsync ceiling of a 60 Hz display rather than a
shortfall. The figures reproduce story 3.5's record on the same machine three
stories later — the map has not regressed while epic 3 added navigation, panel
modes, search and export.

### Bundle (ADR-0004, SM-C3)

Measured from `pnpm build`'s Vite output on this branch: `index.html` 0.26 kB
gz, CSS 1.74 kB gz, JS 57.75 kB gz — **59.75 kB gzipped against a 2 MB budget**,
a 33× margin.

`gitnebula build`'s single self-contained `index.html` (ADR-0004) inlines these
same assets, which moves bytes between files without adding any; no base64
inlining is involved for JS or CSS, so the gzipped total does not materially
change.

<!-- 4.1-bundle-checks -->

**The zero-external-requests re-check is pending story 4.1.** That check is
4.1's own deliverable (its AC-3, Playwright asserting the page requests only its
two files), and it does not exist on this branch yet. This row is re-run and
recorded when 4.1 merges into the epic branch; until then it is *unverified*,
not *passed*. The property it protects — AD-8, no external requests — is
enforced today by the bundle carrying no remote URLs, but this report does not
count design intent as a measurement.

## Red numbers and filed issues (AC-3)

**No threshold in this report is red.** Every budget in the two tables above is
met, on all three repos, on the reference hardware.

Two items are **not measured rather than passed**, and neither is a threshold
this story could fail:

| item | status | why |
| ---- | ------ | --- |
| green CI run on GitHub Actions | **not available** | Actions billing is disabled on the account; `ci.yml` ships as `workflow_dispatch`-only by the maintainer's decision, and story `4.2-ci-pages-recipe` was deliberately not launched in this cohort |
| map-of-itself published on GitHub Pages | **not available** | same — publishing is 4.2's deliverable |

They are recorded here rather than filed as issues because they are a
maintainer decision with a known cause, not a defect discovered by this run.
Both belong to story 4.2 and both are inputs to the M3 verdict below.

## Human-review checklist — prefilled, unticked (AC-4)

This is a copy of
[`docs/planning-artifacts/human-review-checklist.md`](planning-artifacts/human-review-checklist.md)
with the evidence links filled in. **The boxes are the maintainer's to tick**,
here and in the source file. Nothing below has been walked by an agent.

The automatable halves are already answered — where a line has an automated
counterpart, its number is quoted so the walk is a judgement call and not a
measurement.

### Per demo repo

- [ ] Map loads crash-free from `npx gitnebula` — *measured: 1.19 s / 0.95 s /
      2.69 s, all exit 0 (SM-1 budget 60 s)*
- [ ] The module map is visually sensible: recognizable top-level structure, no
      absurd giant/orphan nodes, no obviously wrong layer colours (FR-9) —
      *evidence:* [fastapi](dev/epic-4/4.4-dod-validation/map-fastapi.png) ·
      [excalidraw](dev/epic-4/4.4-dod-validation/map-excalidraw.png) ·
      [streamlit](dev/epic-4/4.4-dod-validation/map-streamlit.png).
      *Worth a look while judging:* fastapi resolves to 6 top-level modules of
      which `docs/` is by far the largest — plausible for that repo, but it is
      the biggest single node in any of the three maps.
- [ ] Layer assignment spot-check: 5 files per repo against the rule table
      (ADR-0002) — *the emitted documents are the input; regenerate with the
      command in "Demo repos, pinned" above*
- [ ] Hot spots point at plausibly active areas (sanity vs `git log`,
      ADR-0003) — *window: 90 days; commits in window 531 / 78 / 646*
- [ ] Unresolved-import rate recorded and ≤ 20% (FR-11) — *measured: 0.00% /
      6.34% / 3.74%; the three classes of miss are broken down above*

### Visual fidelity vs `reference/mockup.html` (SM-6, non-automatable half)

- [ ] Overall nebula impression matches: glow quality, edge curvature, star
      density, dark-void depth — *side-by-side: open `reference/mockup.html`
      against any of the three PNGs, or run `gitnebula` on a repo of choice*
- [ ] Settle animation feels like the mockup's — *the 2–3 s number is
      automated and reads 2.60 s headed; the character of the motion is not*
- [ ] Hot-spot pulse reads as a pulse, not a blink
- [ ] Hover dim/highlight reads instantly at 2,000 files — *the 2,000-file
      fixture is `packages/contract/fixtures/synthetic-100x2000.json`;
      `pnpm --filter @gitnebula/viz dev` serves it*
- [ ] Heatmap gradient is legible cold→hot at both zoom levels

### Interaction feel (target 60 fps — the automated floor is 55)

- [ ] Pan/zoom feels smooth on the maintainer's hardware at the synthetic
      fixture — *automated on this hardware: 59 fps sustained headed, 82–119
      headless; record the subjective verdict*
- [ ] Search fly-to lands where expected and the pulse draws the eye
- [ ] Semantic zoom unfold/collapse never visibly "pops" the global layout —
      *ADR-0006; the export section above shows both states across repos*

### Repo quality (FR-25 / SM-7)

- [ ] README demo GIF actually shows the wow in ≤ 30 s — *story 4.3's
      deliverable*
- [ ] Map-of-itself on Pages is current with master — **blocked: Pages
      publishing is story 4.2, not launched this cohort (see AC-3 table)**
- [ ] A newcomer can go README → `npx gitnebula` → map without further docs

### Sign-off

- [ ] All above checked or a follow-up issue filed per unchecked item
- Maintainer: ______  Date: ______  Hardware: ______

## M3 go/no-go (AC-5)

M3 is *"Epic 4 merged: MVP DoD executed and recorded on fastapi, excalidraw,
streamlit"*.

### What this story establishes

| brief §10 DoD item | verdict |
| ------------------ | ------- |
| 1. `npx gitnebula` on a medium repo < 60 s, working map | ✅ 1.19 / 0.95 / 2.69 s |
| 2. Pan/zoom smooth at 100 modules / 2,000 files | ✅ 59 fps sustained headed, floor 55 |
| 3. The full section-5 flow works | ✅ automated across epics 2–3; the *feel* half is the owner's walk above |
| 4. Fully offline, no API key, no configuration | ✅ under `deny network*`, byte-identical output |
| 5. `analysis.json` validates, `description`/`descriptionSource` present and nullable | ✅ all three documents valid at `schemaVersion 1.0` |
| 6. Repo: README demo, map of itself, MIT license, CI with tests, CONTRIBUTING.md | ⚠️ **partial** — LICENSE and CONTRIBUTING.md are in the tree; README demo is story 4.3; CI exists as `ci.yml` but runs only on `workflow_dispatch`, and Pages publishing (4.2) was not launched |
| 7. Runs on 3 popular public repos without crashing, visually sensible result | ✅ crash-free on all three; "visually sensible" is the owner's line above |

### Verdict

**GO for the epic → master merge, conditional on two things that are not this
story's to close:**

1. **The maintainer's checklist walk** (the section above). It is prepared and
   unticked by design — it is the owner gate, and no agent may tick it.
2. **Epic 4's other rows landing**: `4.1-build-bundle` and `4.3-repo-quality`
   merged; `4.2-ci-pages-recipe` consciously deferred, which leaves DoD item 6
   partial. Deferring 4.2 is a maintainer decision with a known cause (Actions
   billing), so it is a *scoping* condition on M3, not a defect: if M3 is to be
   declared with CI off and no Pages, that should be said out loud in the
   milestone rather than inferred from this report.

Every automatable threshold in the MVP definition of done passes with margin —
the smallest is the frame-rate floor at 1.07×, and it is a vsync ceiling rather
than a limit of the renderer. The numbers are not close to their budgets
anywhere else, which is the honest reading of "done".
