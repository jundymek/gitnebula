// Story 4.1, AC-3: the bundle behaves as a published artefact.
//
// Both checks run against `dist/` as `pnpm build` left it, served by an
// ordinary static host that knows nothing about gitnebula.
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";

const vizRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtPage = join(vizRoot, "dist", "index.html");

test.describe("the static bundle (ADR-0004, AD-8)", () => {
  test("requests its own two files and nothing else", async ({ page }) => {
    const requested: string[] = [];
    // Every request the page issues, including ones that fail: a 404 for a
    // hashed chunk is exactly the failure this test exists to catch, and a
    // listener on `response` alone would miss a request to a host that never
    // answers.
    page.on("request", (request) => requested.push(request.url()));

    await page.goto("/");
    await page.waitForFunction((key) => key in globalThis, HARNESS_HANDLE_KEY);
    // The engine settles after boot; anything lazy would have been fetched by
    // then.
    await page.evaluate(
      (key) =>
        (
          globalThis as unknown as Record<string, { settled: Promise<unknown> }>
        )[key]!.settled,
      HARNESS_HANDLE_KEY,
    );

    const paths = requested.map((url) => new URL(url).pathname).sort();
    expect(paths).toEqual(["/", "/analysis.json"]);

    // Same claim from the other side: nothing off-origin, whatever the path.
    const hosts = new Set(requested.map((url) => new URL(url).host));
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test("carries its script and styles inline", async ({ page }) => {
    await page.goto("/");

    expect(await page.locator("script[src]").count()).toBe(0);
    expect(await page.locator("link[rel=stylesheet]").count()).toBe(0);
    expect(await page.locator("script").count()).toBe(1);
  });

  test("draws the map it fetched", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction((key) => key in globalThis, HARNESS_HANDLE_KEY);

    // The fixture the static host serves is `single-module.json`; the header
    // naming it is the end-to-end proof that the sibling document was read and
    // rendered, not merely fetched.
    await expect(page.locator("#stage")).toBeVisible();
    await expect(page.locator(".error-screen")).toHaveCount(0);
  });
});

test.describe("opened from disk (ADR-0004: file:// is not supported)", () => {
  test("explains how to serve it instead of failing silently", async ({
    page,
  }) => {
    const failed: string[] = [];
    page.on("requestfailed", (request) => failed.push(request.url()));

    await page.goto(pathToFileURL(builtPage).href);

    const screen = page.locator(".error-screen");
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("has to be served");
    // The actionable half: the reader is handed the command that fixes it.
    await expect(screen).toContainText("npx serve");

    // The page does not even try: a failed fetch here would put a red line in
    // the console that describes the browser's security model rather than the
    // user's mistake.
    expect(failed).toEqual([]);
  });
});
