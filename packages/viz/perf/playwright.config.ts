import { defineConfig, devices } from "@playwright/test";

/**
 * The performance harness (story 3.5, AC-3/AC-5).
 *
 * Dev-only tooling: Playwright is a devDependency of `viz` and nothing it does
 * enters the bundle. The suite drives the *real* Viewer served by the package's
 * own Vite dev server, which already serves story 1.3's committed
 * 100-module/2,000-file document at `/analysis.json` — so the yardstick comes
 * from the contract package rather than from a fixture the harness invented.
 *
 * `workers: 1` and `fullyParallel: false` are not tidiness: two pages
 * animating at once share one GPU and one main-thread scheduler, and the fps
 * number would then measure the contention.
 */

const PORT = 4318;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  // A phase is 10-15 s of scripted animation, plus a ~4 s settle.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // A perf run is evidence, not a flake to retry away: a failed run is a
  // measurement that must be read, not re-rolled.
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // `PERF_HEADED=1 pnpm --filter @gitnebula/viz perf` runs against a real
    // window. It matters: headless Chromium's frame clock is not tied to a
    // display, so its ceiling is not the 60 Hz a person actually sees.
    // PERFORMANCE.md records both.
    headless: !process.env.PERF_HEADED,
    baseURL: BASE_URL,
    // Fixed, so runs are comparable between machines and between days.
    viewport: { width: 1440, height: 900 },
    // Pinned to 1: at DPR 2 the renderer rasterises 4x the pixels, which is a
    // different measurement. PERFORMANCE.md records the DPR-2 run separately.
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort`,
    cwd: "..",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
