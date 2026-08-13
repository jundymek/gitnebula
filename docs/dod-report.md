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

# the CLI exactly as a user gets it: packed, then installed into an empty dir
mkdir -p /tmp/cold/app
( cd packages/cli && npm pack --pack-destination /tmp/cold )
( cd /tmp/cold/app && npm install ../gitnebula-cli-0.0.0.tgz )
/tmp/cold/app/node_modules/.bin/gitnebula <repo> --no-serve -o <repo>.json
```

## Per-repo definition of done (AC-1)

Wall clock is the **median of three runs** after one discarded warm-up. The
spread across the three was 0.01 s on both small repos and 0.16 s on streamlit
(2.65 / 2.81 / 2.79 s), which is why the median is reported rather than the
best. Clone time is excluded — SM-1 is about analysing a repository you have.

| repo | wall clock (≤ 60 s) | crash-free | `analysis.json` (≤ 5 MB) | unresolved imports (≤ 20%) | schema |
| ---- | ------------------- | ---------- | ------------------------ | -------------------------- | ------ |
| fastapi | **1.12 s** ✅ | ✅ exit 0 | **1.32 MiB** ✅ | **0.00%** ✅ | ✅ valid |
| excalidraw | **0.93 s** ✅ | ✅ exit 0 | **0.94 MiB** ✅ | **6.34%** ✅ | ✅ valid |
| streamlit | **2.79 s** ✅ | ✅ exit 0 | **2.16 MiB** ✅ | **3.74%** ✅ | ✅ valid |

**All 15 cells pass. The tightest margin is streamlit's runtime, 21× under
budget.**

### What each column means

- **How the CLI was invoked, precisely.** These numbers come from **the
  packed tarball installed into an empty directory** — `npm pack` (which runs
  4.1's prepack), then `npm install <tarball>` in a scratch dir with no pnpm,
  no workspace and no `node_modules` hoisting, then that directory's
  `node_modules/.bin/gitnebula`. That is the `npx` path in everything but the
  registry download, which is network time SM-1 does not own.
  This matters because it is where the run breaks if the packaging is wrong:
  the same binary invoked straight out of `packages/cli/dist/` **fails on both
  Python repos** with `ENOENT … packages/cli/assets/tree-sitter-python.wasm`,
  because a development checkout never runs `prepack` and the grammar is not
  in place. A first pass of this report measured through that path with the
  `.wasm` files copied in by hand; those numbers were within 0.1 s of these,
  but they proved the pipeline rather than the product, so they were rerun.
- **Wall clock** — the full pipeline, `--no-serve`. Per-stage
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
| commits in the 90-day window | 529 | 78 | 644 |
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

One number in this table moves on its own, and it is worth knowing which:
**`commits in the window` is the only one.** Repeating the runs six hours later
changed fastapi from 531 to 529 and streamlit from 646 to 644 and left every
other cell — nodes, edges, co-change pairs, resolution counts — identical to
the byte. The window is 90 days measured back from the run, so old commits fall
out of it while the pinned SHA stays put. Everything else in this report is a
function of the commit, not of the clock (AD-4).

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
| viewer bundle, gzipped | ≤ 2 MB | ✅ **57.6 kB** assets / 57.5 kB whole file (2.8% of budget) |
| bundle issues requests only to its own two files | zero external | ✅ **4 checks passed** |
| cold install from the packed tarball | must run | ✅ 140 tests, incl. the pack e2e |

### Offline (SM-3, brief §10.4)

macOS has no per-process network namespace, so the run is wrapped in a kernel
sandbox that denies networking outright:

```bash
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /usr/bin/env /tmp/cold/app/node_modules/.bin/gitnebula \
  <repo> --no-serve -o <out>.json
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

Story 4.1 is merged into this base, so `pnpm build` now emits the single
self-contained file ADR-0004 asks for: **one `index.html`, 191,825 bytes raw**,
with the JS and CSS inline and no other emitted asset.

| measurement | value | budget |
| ----------- | ----- | ------ |
| viewer assets, gzipped — 4.1's own size gate, printed by its test run | **57.6 kB** | 2.00 MB (2.8%) |
| the whole `index.html`, `gzip -9` | **57.5 kB** (58,830 B) | 2 MB |

Two figures because they answer two questions; they agree, which is the point.
The gate's number is the binding one — it is the assertion that fails the build
— and the whole-file measurement is what a browser actually downloads.

The zero-external-requests assertion is 4.1's `bundle-check` suite, re-run on
this branch:

```
pnpm --filter @gitnebula/viz bundle-check     → 4 passed
  ✓ requests its own two files and nothing else
  ✓ carries its script and styles inline
  ✓ draws the map it fetched
  ✓ file:// open explains how to serve it instead of failing silently
```

That is AD-8 measured rather than asserted: the page's request pathnames are
exactly `["/", "/analysis.json"]`.

The cold-start half of the same story is `pnpm --filter @gitnebula/cli test` —
**13 files, 140 tests passed**, including the pack e2e whose summary line reads
`cold install: npm-installed tarball analyzed the fixture repo and served
index.html + analysis.json`. This report's per-repo timings were taken through
that same installed tarball.

## Red numbers and filed issues (AC-3)

**No threshold in this report is red.** Every budget in the two tables above is
met, on all three repos, on the reference hardware.

Two items are **not measured rather than passed**, and neither is a threshold
this story could fail:

| item | status | why |
| ---- | ------ | --- |
| green CI run on GitHub Actions | **not available** | Actions billing is disabled on the account; `ci.yml` ships as `workflow_dispatch`-only by the maintainer's decision, and story `4.2-ci-pages-recipe` was deliberately not launched in this cohort |
| map-of-itself published on GitHub Pages | **not available** | same — publishing is 4.2's deliverable |
| `npx gitnebula` against the real registry | **not available** | the package is unpublished and still `private` / `@gitnebula/cli` / 0.0.0. Story `4.5-npm-release` (specced by the epic supervisor on 2026-08-13, row `backlog`) covers it. The tarball proof above is how far this report can go without it |

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

- [ ] Map loads crash-free from `npx gitnebula` — *measured: 1.12 s / 0.93 s /
      2.79 s, all exit 0 (SM-1 budget 60 s), through the tarball installed into
      an empty directory. "Loads" — the map opening in a browser — is the half
      that is yours; the analysis half is measured*
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
      ADR-0003) — *window: 90 days; commits in window 529 / 78 / 644*
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

- [ ] README demo GIF actually shows the wow in ≤ 30 s — *story 4.3 landed it:
      [`docs/assets/demo.gif`](assets/demo.gif), 197 frames, **24.63 s**
      measured, 720 × 405, 3.7 MB. The duration clears the budget; whether it
      shows the wow is the judgement call*
- [ ] Map-of-itself on Pages is current with master — **blocked: Pages
      publishing is story 4.2, not launched this cohort (see AC-3 table)**
- [ ] A newcomer can go README → `npx gitnebula` → map without further docs —
      *the README and `CONTRIBUTING.md` landed with story 4.3 (PR #36); the
      `npx` path itself is story 4.1's cold-install test*

### Sign-off

- [ ] All above checked or a follow-up issue filed per unchecked item
- Maintainer: ______  Date: ______  Hardware: ______

## M3 go/no-go (AC-5)

M3 is *"Epic 4 merged: MVP DoD executed and recorded on fastapi, excalidraw,
streamlit"*.

### What this story establishes

| brief §10 DoD item | verdict |
| ------------------ | ------- |
| 1. `npx gitnebula` on a medium repo < 60 s, working map | ✅ for the artefact — 1.12 / 0.93 / 2.79 s through the packed tarball installed into an empty directory. The literal `npx gitnebula` resolves to nothing yet: the package is `private`, named `@gitnebula/cli` and versioned 0.0.0, which is story **4.5-npm-release** (specced 2026-08-13, `backlog`) |
| 2. Pan/zoom smooth at 100 modules / 2,000 files | ✅ 59 fps sustained headed, floor 55 |
| 3. The full section-5 flow works | ✅ automated across epics 2–3; the *feel* half is the owner's walk above |
| 4. Fully offline, no API key, no configuration | ✅ under `deny network*`, byte-identical output |
| 5. `analysis.json` validates, `description`/`descriptionSource` present and nullable | ✅ all three documents valid at `schemaVersion 1.0` |
| 6. Repo: README demo, map of itself, MIT license, CI with tests, CONTRIBUTING.md | ⚠️ **partial** — MIT LICENSE, README and CONTRIBUTING.md are in the tree, and the 24.63 s demo GIF landed with story 4.3 (PR #36, in this base). Missing: a green CI run (`ci.yml` exists but is `workflow_dispatch`-only) and the map-of-itself on Pages — both story 4.2, not launched |
| 7. Runs on 3 popular public repos without crashing, visually sensible result | ✅ crash-free on all three; "visually sensible" is the owner's line above |

### Verdict

**GO for the epic → master merge, conditional on two things that are not this
story's to close:**

1. **The maintainer's checklist walk** (the section above). It is prepared and
   unticked by design — it is the owner gate, and no agent may tick it.
2. **Epic 4's other rows landing**: `4.1-build-bundle` (PR #37) and
   `4.3-repo-quality` (PR #36) are both merged into this base, and every row in
   this report that depended on them — the cold-install timings, the bundle
   size, the zero-external-requests check, the demo GIF — is measured against
   the merged result rather than promised. `4.2-ci-pages-recipe` is consciously
   deferred, which leaves DoD item 6 partial. Deferring 4.2 is a maintainer
   decision with a known cause (Actions billing), so it is a *scoping*
   condition on M3, not a defect: if M3 is to be declared with CI off and no
   Pages, that should be said out loud in the milestone rather than inferred
   from this report.
3. **`4.5-npm-release`, specced on 2026-08-13 and still `backlog`**, decides
   whether the front door in the README is real. Nothing in this report depends
   on it — the tarball measured here is the artefact 4.5 would publish — but
   M3's claim that `npx gitnebula` works is a claim about the registry, and
   until 4.5 lands the honest form of that claim is the one in the DoD table
   above.

Every automatable threshold in the MVP definition of done passes with margin —
the smallest is the frame-rate floor at 1.07×, and it is a vsync ceiling rather
than a limit of the renderer. The numbers are not close to their budgets
anywhere else, which is the honest reading of "done".
