# 4.4 — DoD validation on the demo repos

This story ships no product code. It executes the MVP definition of done
against fastapi, excalidraw and streamlit and records the result, so that
"done" is a measurement rather than a feeling.

The deliverable is [`docs/dod-report.md`](../../../dod-report.md). This file
explains how it was produced and what was decided along the way;
[PERFORMANCE.md](PERFORMANCE.md) carries the method and the raw numbers for the
three stated performance properties.

## Files

| file | | why |
| ---- | - | --- |
| `docs/dod-report.md` | NEW | the report: per-repo table, global checks, prefilled human-review checklist, M3 go/no-go |
| `docs/dev/epic-4/4.4-dod-validation/PERFORMANCE.md` | NEW | method, machine, raw numbers, budgets |
| `docs/dev/epic-4/4.4-dod-validation/map-fastapi.png` | NEW | the Viewer's own PNG export, evidence for the checklist walk |
| `docs/dev/epic-4/4.4-dod-validation/map-excalidraw.png` | NEW | ditto |
| `docs/dev/epic-4/4.4-dod-validation/map-streamlit.png` | NEW | ditto |
| `docs/implementation-artifacts/sprint-status.yaml` | UPDATE | this story's row only |
| `docs/implementation-artifacts/epic-4-ship-it/4.4-dod-validation.md` | UPDATE | tasks ticked, Dev Agent Record filled |

No `MANUAL_TESTING.md`: the spec says so in as many words — *this story IS the
manual-test protocol*. `docs/dod-report.md` is that document, and its checklist
section is the walk.

## How the numbers were produced

Everything is reproducible from a clone. The commands are in the report next to
the numbers they produced; the two that are not one-liners are here.

### PNG exports

The images are the **Viewer's own export path** (story 3.5's `exportPNG`, a ≥ 2×
re-render), not screenshots — the point is to exercise the feature the
maintainer is being asked to judge. The dev server can serve any document at
`/analysis.json` via `GITNEBULA_FIXTURE`, so a demo repo's output can be loaded
into the real Viewer:

```bash
GITNEBULA_FIXTURE=/abs/path/fastapi.json DOD_PNG_OUT=/abs/path/fastapi.png \
  PERF_PORT=4331 pnpm --filter @gitnebula/viz exec \
  playwright test -c perf/playwright.config.ts dod-export
```

The spec that drives it (`perf/tests/dod-export.pw.ts`) waits for the harness
handle's `settled` promise, calls `engine.exportPNG()`, and writes the blob. It
was **not committed**: it is 30 lines of one-off evidence plumbing, and leaving
it in `perf/tests` would add a spec to everyone's `pnpm --filter viz perf` run
that fails without an env var. It is reproduced in full here so the images can
be regenerated:

```ts
import { writeFileSync } from "node:fs";
import { test } from "@playwright/test";
import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { openViewer } from "../src/page-helpers.js";

test("export the map as PNG", async ({ page }) => {
  await openViewer(page);
  await page.evaluate(async (key) => {
    await (globalThis as any)[key].settled;
  }, HARNESS_HANDLE_KEY);
  await page.waitForTimeout(500);
  const dataUrl = await page.evaluate(async (key) => {
    const blob = await (globalThis as any)[key].engine.exportPNG();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }, HARNESS_HANDLE_KEY);
  writeFileSync(
    process.env.DOD_PNG_OUT!,
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );
});
```

The committed copies are downscaled to 1440 px and quantised to 256 colours
(`magick <in> -resize 1440x -colors 256 PNG8:<out>`); the raw export is 2880 px
and ~10 MB, which is not a thing to put in a repository three times.

### The offline check

```bash
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  /usr/bin/env node packages/cli/dist/gitnebula.js <repo> --no-serve -o <out>.json
```

The sandbox was verified in both directions first — `curl` and `git ls-remote`
fail inside it and succeed outside — because an offline test that silently still
has network proves the opposite of what it claims.

### Independent schema validation

The pipeline validates in `assemble`, so a successful run already implies a
valid document. The report's schema column is a **second** check, over the file
on disk, after the JSON round-trip:

```bash
pnpm dlx tsx <script>.mts <analysis>.json   # calls validateAnalysis from @gitnebula/contract
```

## Decisions worth knowing about

- **The timings are taken through the packed tarball, not the worktree.** A
  development checkout never runs `prepack`, so `packages/cli/assets/` is empty
  and the built binary fails on any repository containing Python
  (`ENOENT … tree-sitter-python.wasm`). Measuring around that with a hand-copied
  `.wasm` proves the pipeline and nothing about the product, so the runs were
  redone through `npm pack` → `npm install <tarball>` in an empty directory.
  Packaging turned out to cost nothing at runtime — the two sets of numbers
  agree within 0.1 s — but only one of them is reproducible by a user.
- **Story 4.2 is out of scope for this run.** The spec makes 4.4 depend on
  `4.2-ci-pages-recipe`; the maintainer deliberately did not launch 4.2
  (GitHub Actions billing is disabled) and redirected the dependency to
  `4.1-build-bundle`, which is what the report actually needs. Consequently the
  Pages URL and a green Actions run are recorded as *not available* rather than
  as failures, and `ci.yml` is untouched — it stays `workflow_dispatch`-only.
- **The unresolved-import denominator is the one stories 2.2 and 3.1 set**:
  unresolved ÷ (resolved file import edges + unresolved). Externals are ignored
  by design, not failures to resolve. Changing it here would make this story's
  numbers incomparable with the two that established the threshold. Both
  readings are printed anyway.
- **Timing excludes clone time** and uses the median of three runs after a
  discarded warm-up, with `--no-serve` so the number is the pipeline and not a
  browser launch.
- **The checklist is prefilled and left unticked.** AC-4 makes that an owner
  gate. Where a line has an automated counterpart the number is quoted next to
  it, so the maintainer's walk is a judgement call rather than a re-measurement.
- **Only this story's `sprint-status.yaml` row is flipped**, and to `review`,
  not `done`: in this repository `done` means merged and is written at epic
  closure by the supervisor (the file's history shows both moves). The other
  Epic 4 rows belong to their owners; the report describes their observed state
  without editing them.

## What the run found

No threshold is red. The three repos analyse in 0.93–2.79 s against a 60 s
budget, emit 0.94–2.16 MiB against 5 MB, resolve imports at 0.00–6.34% unresolved
against 20%, and validate at `schemaVersion 1.0`. The map holds 59 fps sustained
on a 60 Hz display, the bundle is 2.8% of its size budget and issues requests to
its own two files only.

One thing the run found that was not on anyone's list: **a development checkout
cannot analyse a Python repository with its own built binary.** That is not a
defect in 4.1 — the packaged tarball is correct and its cold-install test proves
it — but it is a sharp edge for a contributor who runs `pnpm build` and then the
binary, and it is written up here because the DoD run is exactly the kind of
exercise that finds it.

Two things are *not available* rather than passing: a green CI run and the
map-of-itself on Pages, both story 4.2's, both deferred by the maintainer. They
leave brief §10 DoD item 6 partial, which is the one condition the M3 verdict
names that this story cannot close on its own.
