import { defineConfig, devices } from "@playwright/test";

/**
 * Story 6.1: the `ui` suite — the assembled Viewer, driven through a real
 * browser.
 *
 * **What this suite is for, stated precisely, because the boundary is easy to
 * blur.** It is not "the browser tests" — two Playwright suites already exist
 * beside it, `perf/` (fps, export parity, reduced motion) and `bundle/` (the
 * built artefact over http and `file://`), and roughly 318 jsdom tests across
 * `src/chrome/` already assert the readouts by driving components with fake
 * engines. This suite covers only what those structurally cannot reach: the
 * assembled page, booted the way a reader boots it. Anything a fake engine can
 * prove belongs in a jsdom test, which is faster and easier to read.
 *
 * `workers: 1` and `fullyParallel: false` follow the sibling configs. Here the
 * reason is not GPU contention but the server: one Vite dev server on one
 * strict port serves the whole run, and specs that navigate it concurrently
 * would interleave their boots.
 *
 * Run it on demand:
 *
 *     pnpm --filter @gitnebula/viz ui
 *
 * It is deliberately **not** part of `pnpm test`. `perf` and `bundle-check`
 * are both explicit scripts for the same reason: `pnpm test` must keep passing
 * on a machine with no browser installed, and a unit-test run that silently
 * downloads and launches Chromium is a different contract from the one this
 * workspace offers.
 */

/**
 * 4320, continuing the series: `PERF_PORT` 4318, `BUNDLE_PORT` 4319. Every one
 * of them is overridable because this repository is developed in several
 * parallel worktrees, and any of them can be holding the default:
 *
 *     UI_PORT=4330 pnpm --filter @gitnebula/viz ui
 */
const PORT = Number(process.env.UI_PORT ?? 4320);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // Inherited from `perf`, and the reasoning carries over unchanged: a run is
  // evidence, not a flake to retry away. A test that only passes on the second
  // attempt has told you something, and `retries` is how that gets discarded.
  retries: 0,
  reporter: [["list"]],
  // A failing run writes traces and error context somewhere. Playwright's
  // default is `<config dir>/test-results`, i.e. `ui/test-results` — which is
  // not covered by `.gitignore`, so the first red run would leave untracked
  // artefacts inside a source directory for someone to commit by accident.
  // `packages/viz/test-results/` is already ignored; the `ui` subdirectory
  // keeps this suite's output from clearing a sibling suite's.
  outputDir: "../test-results/ui",
  use: {
    ...devices["Desktop Chrome"],
    headless: !process.env.UI_HEADED,
    baseURL: BASE_URL,
    // Fixed, so a layout-dependent assertion means the same thing on every
    // machine and on every day. Matches `perf`'s viewport for the same reason.
    viewport: { width: 1440, height: 900 },
    // Pinned to 1: at DPR 2 the renderer rasterises 4x the pixels. Nothing
    // here measures that, and an unpinned DPR makes runs incomparable.
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort`,
    cwd: "..",
    url: BASE_URL,
    env: {
      // The suite states its own document rather than inheriting whatever the
      // dev server defaults to — which is `synthetic-100x2000`, the 100-module
      // / 2,000-file perf yardstick. `root-files` is 6 nodes across 3 layers
      // with 3 cross-layer file edges and one co-change pair: small enough to
      // reason about a single assertion, and rich enough to exercise the paths
      // wave B covers. A missing fixture 404s loudly (see `vite.config.ts`) —
      // story 1.4 learned that a silent fallback produces a run that looks
      // normal while measuring nothing.
      GITNEBULA_FIXTURE: "root-files",
    },
    // Never reuse a server this run did not start.
    //
    // The convenient setting is `!process.env.CI`. It is also how a suite ends
    // up reporting a clean pass over a working tree that is not the one under
    // test: with several agent worktrees on one machine, whoever holds the
    // port owns the server, and an attaching run measures their code. That
    // happened during review of story 3.5 — a green 8-passed run traced by
    // `lsof` to another checkout entirely.
    //
    // So a port collision fails loudly (`--strictPort`) instead of quietly
    // producing the wrong answer, and `UI_PORT` is how concurrent worktrees
    // coexist. Neither setting is tidiness; do not relax either.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
