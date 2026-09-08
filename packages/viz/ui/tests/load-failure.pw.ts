import { expect, test } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import { FILE_PROTOCOL_HINT } from "../../src/loader.js";
import { openViewer } from "../../harness/page-helpers.js";
import {
  buildBundleOnce,
  failRequest,
  hasHarnessHandle,
  nodesOf,
  openFromDiskExpectingFailure,
  openViewerExpectingFailure,
  serveBody,
  serveDocument,
  serveStatus,
  validDocument,
  type ServedAnalysis,
} from "./support/load-failure-page.js";

/**
 * Story 6.3, AC-1 / AC-2 / AC-3 — the first screen of a failed load.
 *
 * ## What this file covers that nothing else does
 *
 * `renderErrorScreen` (`src/error-screen.ts`) is the first and only thing a
 * reader sees when `analysis.json` cannot be loaded, and before this story it
 * was asserted in exactly one place: `bundle/tests/bundle.pw.ts:65`, which
 * checks the `file://` case against two substrings. Five of the loader's six
 * failure constructions had never been rendered in any harness.
 *
 * (The story spec says the screen "has **no test in any harness** — not in
 * vitest, not in Playwright". That was not accurate against this base branch;
 * the drift is reported in this story's README rather than propagated here.)
 *
 * ## What is deliberately *not* here
 *
 * `loader.ts`'s predicates and `checkVersion` are pure functions over parsed
 * JSON, and `src/loader.test.ts` already covers them in 17 vitest cases —
 * including every construction below, at the level of the `LoadFailure` object
 * they return. Re-asserting those here would buy nothing and cost a browser.
 *
 * What is browser-only is the **assembled path**: a real fetch over HTTP,
 * `boot()` choosing the error screen over an engine, and the screen a reader
 * can actually act on. That is the line every test in this file sits on. Each
 * one therefore asserts the *rendered* screen, and that no engine was
 * published — never the loader's return value.
 */

/**
 * Asserted after every navigation. A route that never fired means the Viewer
 * did not request the URL this suite intercepted, so it was served the dev
 * server's real `root-files` fixture and the whole test measured the wrong
 * document — while still looking like a normal pass. Story 1.4's silent
 * fallback, in a different costume.
 */
function expectDocumentWasServed(served: ServedAnalysis, when: string): void {
  expect(
    served.wasRequested(),
    `the Viewer never requested analysis.json while ${when}, so the route ` +
      "this test installed served nothing and the page under test was the " +
      "dev server's real fixture rather than this test's document",
  ).toBe(true);
}

test.describe("unreachable (AC-1)", () => {
  test("an HTTP error names the status and the URL it looked at", async ({
    page,
  }) => {
    const served = await serveStatus(page, 500);
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "the server was answering 500");

    expect(
      screen.title,
      "the error screen's headline does not name the load failure; a reader " +
        `who cannot load the map saw "${screen.title}" instead`,
    ).toBe("analysis.json could not be loaded");
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not report the status the ` +
        "server answered, so the reader cannot tell a missing file from a " +
        "broken server",
    ).toContain("the server answered 500");
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not name the URL the Viewer ` +
        "looked at, which is the one thing that tells a reader where to put " +
        "the file",
    ).toContain("./analysis.json");
    expect(
      screen.role,
      "the error screen carries no role=alert, so a screen-reader user is " +
        "told nothing when the page replaces itself with a failure",
    ).toBe("alert");
  });

  test("a transport failure is reported as one, not as a blank page", async ({
    page,
  }) => {
    // The `fetch` *rejection* branch: no status code exists to describe this,
    // and it is what a reader hits when the connection dies mid-request.
    const served = await failRequest(page);
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "the request was being aborted");

    expect(
      screen.title,
      `an aborted request produced the headline "${screen.title}" rather ` +
        "than the load-failure screen",
    ).toBe("analysis.json could not be loaded");
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not say the request itself ` +
        "failed, so a network problem reads as a missing file",
    ).toContain("the request failed");
  });
});

test.describe("malformed (AC-1)", () => {
  test("a body that is not JSON says so", async ({ page }) => {
    const served = await serveBody(page, "<!doctype html><p>not json</p>");
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "a non-JSON body was being served");

    expect(
      screen.title,
      `a body that is not JSON produced the headline "${screen.title}"; the ` +
        "common cause is a host answering an HTML 404 page with status 200, " +
        "and the reader has to be told it is a parse failure",
    ).toBe("analysis.json could not be parsed");
  });

  test("a document with no schemaVersion names the missing field", async ({
    page,
  }) => {
    const served = await serveDocument(page, {});
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "an empty object was being served");

    expect(
      screen.title,
      `an object with no schemaVersion produced "${screen.title}"`,
    ).toBe("analysis.json is missing its schemaVersion");
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not name the field that is ` +
        "missing, which is the only thing that makes the message actionable",
    ).toContain("schemaVersion");
  });

  test("an unreadable schemaVersion quotes it and states the shape", async ({
    page,
  }) => {
    const served = await serveDocument(page, { schemaVersion: "1.x" });
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "schemaVersion was `1.x`");

    expect(screen.title, `schemaVersion "1.x" produced "${screen.title}"`).toBe(
      "analysis.json declares an unreadable schemaVersion",
    );
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not quote the value it could ` +
        "not read, so the reader cannot see what is wrong with their file",
    ).toContain("1.x");
    // The whole-string match in `majorOf` is why this is a failure at all:
    // `Number.parseInt` reads a prefix, so an unanchored check would have
    // taken `1.x` for major 1 and rendered a map from it.
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not state the shape a version ` +
        "must have, so the reader is told what is wrong but not what is right",
    ).toContain("<major>.<minor>");
  });

  test("a same-version document that is not a document names the offending index", async ({
    page,
  }) => {
    const document = validDocument();
    // Index 1 rather than 0, so the reported index is a real lookup and not a
    // constant that would pass against any broken node.
    nodesOf(document)[1] = { id: "fp/proxy.py", kind: "file" };
    const served = await serveDocument(page, document);
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "node 1 had been emptied");

    expect(
      screen.title,
      `a document whose node 1 is not a node produced "${screen.title}"`,
    ).toBe("analysis.json is not a gitnebula document");
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not point at the node that is ` +
        "wrong; on a 2,000-node document an unlocated complaint is unusable",
    ).toContain("node at index 1");
  });
});

test.describe("unsupported-version (AC-1)", () => {
  test("names both versions, not merely that they differ", async ({ page }) => {
    const document = validDocument();
    document.schemaVersion = "2.0";
    const served = await serveDocument(page, document);
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "schemaVersion was `2.0`");

    expect(
      screen.title,
      `a major-version mismatch produced "${screen.title}"`,
    ).toBe("This analysis.json was written by a different gitnebula");
    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not say what to do about the ` +
        "mismatch; FR-6 asks for a remedy, not only a diagnosis",
    ).toContain("Re-run gitnebula");

    // The `.versions` block is the half a reader compares at a glance, and it
    // is the only part of the screen that renders document-derived values in
    // their own element.
    expect(
      screen.versions,
      "the version rows do not name both the document's version and the " +
        `viewer's; the screen showed ${JSON.stringify(screen.versions)}, and ` +
        '"unsupported" without the numbers tells the reader nothing',
    ).toEqual(["document schemaVersion 2.0", "viewer supports major 1"]);
  });
});

test.describe("the failed boot publishes no engine (AC-1)", () => {
  test("no harness handle and no canvas behind the screen", async ({
    page,
  }) => {
    const served = await serveStatus(page, 404);
    await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "the server was answering 404");

    // `boot()` returns null on a load failure. If a stage or a handle survived
    // it, the reader would be looking at an error screen laid over a
    // half-built map — and the assertions above would be describing a page
    // that had also tried to render.
    expect(
      await hasHarnessHandle(page, HARNESS_HANDLE_KEY),
      "a failed load published a harness handle, so boot() built an engine " +
        "for a document it had already refused",
    ).toBe(false);
    expect(
      await page.locator("#stage").count(),
      "the failed load left a #stage canvas in the document; the error " +
        "screen is meant to replace the page, not sit on top of a map",
    ).toBe(0);
  });

  test("the negative control: a good document renders no error screen", async ({
    page,
  }) => {
    // Every assertion above waits for `.error-screen` to appear. If that
    // selector matched something the page always has, all of them would pass
    // on any page at all. This is the discriminating half: the same suite,
    // the same server, an unmutated document — and the screen must be absent
    // while the engine is present.
    await openViewer(page);

    expect(
      await page.locator(".error-screen").count(),
      "the Viewer rendered an error screen for the valid root-files fixture, " +
        "which means `.error-screen` is not a failure signal and every " +
        "assertion in this file is vacuous",
    ).toBe(0);
    expect(
      await hasHarnessHandle(page, HARNESS_HANDLE_KEY),
      "the valid fixture published no harness handle, so the control proves " +
        "nothing about the difference between a good load and a bad one",
    ).toBe(true);
  });
});

test.describe("a failure detail is text, never markup (AC-3)", () => {
  /**
   * The detail is built from a string the Viewer read out of a document it has
   * just decided it cannot trust. `checkVersion` interpolates the declared
   * `schemaVersion` into the message verbatim, so a document is able to put
   * arbitrary characters on that screen — which is precisely why
   * `error-screen.ts:4` builds the screen with `textContent` rather than
   * `innerHTML`.
   *
   * A comment is not a guarantee. This drives the real path with a real
   * payload and requires three things at once: the markup is *shown* to the
   * reader as text, no element was created from it, and it did not run.
   */
  const PAYLOAD = '<img src=x onerror="globalThis.__loadFailureXss = true">';

  test("markup in a schemaVersion is displayed, not parsed, not executed", async ({
    page,
  }) => {
    const served = await serveDocument(page, { schemaVersion: PAYLOAD });
    const screen = await openViewerExpectingFailure(page);
    expectDocumentWasServed(served, "schemaVersion carried an <img> payload");

    expect(
      screen.detail,
      `the detail (\`${screen.detail}\`) does not contain the document's own ` +
        "version string verbatim — if it were escaped or dropped, this test " +
        "would prove nothing about how the string is rendered",
    ).toContain(PAYLOAD);
    expect(
      await page.locator(".error-screen img").count(),
      "an <img> element exists inside the error screen; the detail was " +
        "parsed as markup, so error-screen.ts is building the screen with " +
        "innerHTML and a document controls the Viewer's DOM",
    ).toBe(0);
    expect(
      screen.html.includes("<img"),
      `the screen's innerHTML contains a literal <img> tag: ${screen.html}`,
    ).toBe(false);
    expect(
      await page.evaluate(() => "__loadFailureXss" in globalThis),
      "the payload in the document's schemaVersion executed — a file the " +
        "Viewer refused to trust ran script in the reader's page",
    ).toBe(false);
  });
});

test.describe("opened from disk (AC-2)", () => {
  /**
   * The failure a human actually reaches, by double-clicking the bundle
   * instead of serving it. `loader.ts:57-66` answers it *before* the fetch,
   * because the error a browser surfaces for a `file:` page reading its own
   * sibling ("Failed to fetch") sends the reader looking for a bug in the map
   * rather than at the way they opened it (ADR-0004).
   *
   * This is the one case in this file that cannot be reached through the dev
   * server: `file:` is a property of the page's own URL, not of what the
   * server answers. So it needs the built single-file bundle, which is built
   * here rather than assumed — a `dist/` left over from an earlier commit
   * would let this assert an old hint and call it green.
   *
   * `bundle/tests/bundle.pw.ts:65` already drives this path and checks the
   * hint contains "has to be served" and "npx serve". The overlap is
   * deliberate and narrow: what is asserted here is the **exact constant**, so
   * a rewrite that dropped half the remedy — the `python3 -m http.server`
   * alternative, say — fails here while staying green there. The README
   * recommends consolidating the two once wave B has merged.
   */
  let distIndex = "";

  test.beforeAll(() => {
    distIndex = buildBundleOnce();
  });

  test("explains how to serve it, in the exact words the loader defines", async ({
    page,
  }) => {
    const failed: string[] = [];
    page.on("requestfailed", (request) => failed.push(request.url()));

    const screen = await openFromDiskExpectingFailure(page, distIndex);

    expect(
      screen.title,
      `a page opened from disk produced the headline "${screen.title}" ` +
        "instead of naming the way it was opened",
    ).toBe("This page has to be served, not opened from disk");
    // The exact constant, not a substring of it. The hint's value is that it
    // hands the reader a command that works; a rewrite that kept the first
    // clause and dropped the commands would still contain "has to be served".
    expect(
      screen.detail,
      "the detail on the file:// screen is not FILE_PROTOCOL_HINT as " +
        `loader.ts defines it. Rendered: ${screen.detail}`,
    ).toBe(FILE_PROTOCOL_HINT);
    expect(
      failed,
      `the page opened from disk still attempted ${failed.length} ` +
        "request(s), so the reader gets a browser security error in the " +
        "console next to an explanation that says no request was made",
    ).toEqual([]);
    expect(
      await hasHarnessHandle(page, HARNESS_HANDLE_KEY),
      "the file:// page published a harness handle, so it built an engine " +
        "for a document it never fetched",
    ).toBe(false);
  });
});
