import { defineConfig, devices } from "@playwright/test";

/**
 * Story 4.1, AC-3: the built bundle, checked as a *published artefact* rather
 * than as a dev server.
 *
 * Two questions this configuration exists to answer honestly:
 *
 *   1. Served by an ordinary static host, does the page request anything
 *      beyond its own two files? (AD-8, ADR-0004 — zero external requests.)
 *   2. Opened over `file://`, does it explain itself?
 *
 * Neither can be asked of the Vite dev server: dev serves modules
 * individually, so its network log is meaningless here, and `file://` has no
 * dev-server equivalent at all. So the server is the plain `node:http` one in
 * `scripts/serve-bundle.mjs` — which lives there, rather than beside this
 * file, because that is where the workspace keeps package build tooling and
 * where the lint config grants it Node globals.
 *
 * Run it with:
 *
 *     pnpm build && pnpm --filter @gitnebula/viz bundle-check
 *
 * `BUNDLE_PORT` exists for the same reason `PERF_PORT` does — several agent
 * worktrees on one machine, one port each.
 */
const PORT = Number(process.env.BUNDLE_PORT ?? 4319);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium" }],
  webServer: {
    // The viewer exactly as `pnpm build` left it, and a committed contract
    // fixture as the sibling document — the bundle's own two files, nothing
    // synthesised for the test.
    command: `node scripts/serve-bundle.mjs ${PORT} dist ../contract/fixtures/single-module.json`,
    cwd: "..",
    url: BASE_URL,
    // Never attach to a server this run did not start: story 3.5 learned the
    // hard way that a passing run against another worktree's checkout is
    // worse than a failing one.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
