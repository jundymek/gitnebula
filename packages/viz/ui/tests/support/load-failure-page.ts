/**
 * Story 6.3 — page-side plumbing for a Viewer that is *meant* to fail to load.
 *
 * ## Why this exists beside `harness/page-helpers.ts` rather than inside it
 *
 * 6.1's `openViewer` waits for the harness handle. That is exactly right for a
 * page that boots: the handle appears only after `boot()` has fetched
 * `analysis.json`, built an engine and published it. But a *failed* load never
 * publishes one — `app.ts:122-125` renders the error screen and returns `null`
 * — so `openViewer` on a failing page waits 60 s and then reports a timeout
 * rather than the failure under test. This file provides the other half: a
 * navigation that waits for the error screen instead.
 *
 * It is a new file rather than an edit to the shared helper because three
 * stories write into this suite in one wave, and a change to a file all three
 * depend on lands with whichever branch merges first and silently reshapes the
 * other two. Agreed with alice (6.2) and pamela (6.4) at intent-sync.
 *
 * It sits in `tests/support/` rather than beside the specs so that it is
 * collected as neither a spec — the config's `testMatch` takes `.pw.ts` files
 * only — nor a convention target: `ui/src/suite-conventions.test.ts` reads
 * `tests/` non-recursively.
 *
 * ## The base document
 *
 * Every malformed document here is a *mutation of a committed valid one* —
 * `packages/contract/fixtures/root-files.json`, the smallest fixture carrying
 * a co-change pair. Read from disk rather than transcribed, so a fixture that
 * changes shape changes these tests with it instead of leaving them asserting
 * against a document the contract no longer produces. Nothing is written back:
 * the contract's fixtures are its committed examples and every one of them is
 * valid by design (story 6.3 AC-7).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Page, Route } from "@playwright/test";

import { HARNESS_HANDLE_KEY } from "../../../src/harness-handle.js";
import { ANALYSIS_URL } from "../../../src/loader.js";

/**
 * The route pattern, derived from the constant the Viewer actually requests
 * rather than written out. If AD-12's URL ever moves, these specs stop
 * matching the thing they mean to intercept — and deriving it here means that
 * shows up as a failed route assertion rather than as a suite quietly testing
 * the real fixture.
 */
export const ANALYSIS_ROUTE_GLOB = `**/${ANALYSIS_URL.replace(/^\.\//, "")}`;

const FIXTURE_URL = new URL(
  "../../../../contract/fixtures/root-files.json",
  import.meta.url,
);

/** A JSON document as it travels over the wire: any shape, valid or not. */
export type LooseDocument = Record<string, unknown>;

/**
 * A fresh deep copy of the `root-files` fixture on every call, so a mutation
 * in one test cannot reach another. `workers: 1` makes the specs sequential,
 * not isolated — a shared object would still leak between them.
 */
export function validDocument(): LooseDocument {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as LooseDocument;
}

/** The fixture's nodes, typed loosely because tests delete required fields. */
export function nodesOf(document: LooseDocument): LooseDocument[] {
  return document.nodes as LooseDocument[];
}

/** The fixture's co-change pairs, same reason. */
export function cochangesOf(document: LooseDocument): LooseDocument[] {
  return document.cochanges as LooseDocument[];
}

/** The fixture's edges, same reason. */
export function edgesOf(document: LooseDocument): LooseDocument[] {
  return document.edges as LooseDocument[];
}

/**
 * Records whether the intercepted URL was ever requested.
 *
 * A route that never fires is the failure mode that matters here: the spec
 * would then be measuring the dev server's real `root-files` fixture while
 * believing it served its own document, and every assertion below it would be
 * about the wrong file. Every helper that installs a route returns one of
 * these, and every spec asserts on it.
 */
export interface ServedAnalysis {
  /** True once the Viewer has actually requested `analysis.json`. */
  wasRequested(): boolean;
}

async function installRoute(
  page: Page,
  handler: (route: Route) => Promise<void>,
): Promise<ServedAnalysis> {
  let requested = false;
  await page.route(ANALYSIS_ROUTE_GLOB, async (route) => {
    requested = true;
    await handler(route);
  });
  return { wasRequested: () => requested };
}

/** Serve an arbitrary body at `analysis.json` — valid JSON or not. */
export async function serveBody(
  page: Page,
  body: string,
  contentType = "application/json",
): Promise<ServedAnalysis> {
  return installRoute(page, (route) =>
    route.fulfill({ status: 200, contentType, body }),
  );
}

/** Serve a JSON document at `analysis.json`. */
export async function serveDocument(
  page: Page,
  document: LooseDocument,
): Promise<ServedAnalysis> {
  return serveBody(page, JSON.stringify(document));
}

/** Answer `analysis.json` with an HTTP error status. */
export async function serveStatus(
  page: Page,
  status: number,
): Promise<ServedAnalysis> {
  return installRoute(page, (route) =>
    route.fulfill({ status, contentType: "text/plain", body: "" }),
  );
}

/**
 * Fail the request at the transport layer, the way an interrupted connection
 * or a blocked request does. This is the `fetch` *rejection* branch of
 * `loadAnalysis`, which a status code cannot reach.
 */
export async function failRequest(page: Page): Promise<ServedAnalysis> {
  return installRoute(page, (route) => route.abort("failed"));
}

/** The error screen as a reader sees it. */
export interface ErrorScreenText {
  /** The `<h1>`. */
  readonly title: string;
  /** The `<p>` under it. */
  readonly detail: string;
  /**
   * The version rows, present only on a version mismatch. Each is the row's
   * whole text, e.g. `document schemaVersion 2.0`.
   */
  readonly versions: readonly string[];
  /** `role`, so the screen's announcement is checked rather than assumed. */
  readonly role: string | null;
  /**
   * The screen's own `innerHTML`. Read so that a test can prove a document's
   * string was rendered as *text* — the property `error-screen.ts:4`
   * documents — rather than parsed into elements.
   */
  readonly html: string;
}

/**
 * Navigate to the Viewer and wait for it to refuse the document.
 *
 * The counterpart to 6.1's `openViewer`, which waits for the harness handle a
 * failed boot never publishes.
 *
 * It waits for **either** outcome rather than only the expected one. A page
 * that boots successfully — because a route glob stopped matching, say, so the
 * dev server's valid fixture was served after all — would otherwise sit out
 * the full timeout and then report `waitForSelector` exceeded, which names the
 * symptom and hides the cause. Racing the two makes that case fail in a second
 * and say what actually happened. Verified by breaking the glob on purpose.
 */
export async function openViewerExpectingFailure(
  page: Page,
): Promise<ErrorScreenText> {
  await page.goto("/");
  const outcome = await page.evaluate(
    async (key) =>
      new Promise<"failed" | "booted">((resolve) => {
        const look = (): boolean => {
          if (document.querySelector(".error-screen")) {
            resolve("failed");
            return true;
          }
          if (key in globalThis) {
            resolve("booted");
            return true;
          }
          return false;
        };
        if (look()) return;
        const observer = new MutationObserver(() => {
          if (look()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // The handle is published on `globalThis`, which no observer watches,
        // so a poll backs the observer up rather than replacing it.
        const timer = setInterval(() => {
          if (look()) {
            clearInterval(timer);
            observer.disconnect();
          }
        }, 50);
      }),
    HARNESS_HANDLE_KEY,
  );
  if (outcome === "booted") {
    throw new Error(
      "the Viewer booted successfully on a page this helper was asked to " +
        "drive into a load failure. The document under test was not the one " +
        "served — check that the analysis.json route still matches.",
    );
  }
  await page.waitForSelector(".error-screen", { timeout: 60_000 });
  return readErrorScreen(page);
}

/** Read the rendered error screen without navigating. */
export async function readErrorScreen(page: Page): Promise<ErrorScreenText> {
  return page.evaluate(() => {
    const screen = document.querySelector(".error-screen");
    if (screen === null) throw new Error("no .error-screen on the page");
    return {
      title: screen.querySelector("h1")?.textContent ?? "",
      detail: screen.querySelector("p")?.textContent ?? "",
      versions: [...screen.querySelectorAll(".versions span")].map(
        (row) => row.textContent ?? "",
      ),
      role: screen.getAttribute("role"),
      html: screen.innerHTML,
    };
  });
}

/**
 * Navigate to the Viewer with `document` served at `analysis.json`, and wait
 * for a *successful* boot.
 *
 * Used by the validator-seam spec, whose whole point is a document ajv rejects
 * that the Viewer nonetheless renders — so here the harness handle appearing
 * is the assertion, not the plumbing.
 */
export async function openViewerWithDocument(
  page: Page,
  document: LooseDocument,
  handleKey: string,
): Promise<ServedAnalysis> {
  const served = await serveDocument(page, document);
  await page.goto("/");
  await page.waitForFunction((key) => key in globalThis, handleKey, {
    timeout: 60_000,
  });
  return served;
}

/** Whether `boot()` published an engine — false on every failure path. */
export async function hasHarnessHandle(
  page: Page,
  handleKey: string,
): Promise<boolean> {
  return page.evaluate((key) => key in globalThis, handleKey);
}

/** One metric row of the selection panel, as the reader sees it. */
export interface PanelRow {
  readonly label: string;
  readonly value: string;
}

/** One co-change partner row of the panel's blast-radius section. */
export interface BlastRow {
  readonly text: string;
  readonly ariaLabel: string;
}

/** What the panel shows for a node, plus the ids the engine actually holds. */
export interface PanelReadout {
  readonly rows: readonly PanelRow[];
  readonly blastRows: readonly BlastRow[];
  /** The blast-radius section's empty state, when it is showing one. */
  readonly blastEmpty: string;
  /** Every node id the engine built from the document. */
  readonly engineNodeIds: readonly string[];
}

/**
 * Select a node through the engine and read what the chrome renders for it.
 *
 * Selection goes through `setSelected` rather than a click because the seam
 * spec is about *values*, not hit-testing — 6.2 owns pointer coordinates —
 * and because a click needs a node's screen position, which depends on a
 * layout that has to have settled first.
 *
 * The values themselves come from the DOM because `GraphEngine` exposes
 * neither `repo` metadata nor `cochanges`: the panel's rows and its
 * blast-radius partners exist only there (story 6.5's `data-testid` rule).
 */
export async function selectAndReadPanel(
  page: Page,
  handleKey: string,
  nodeId: string,
  testids: { readonly row: string; readonly blastRow: string },
): Promise<PanelReadout> {
  return page.evaluate(
    async ({ key, id, ids }) => {
      const handle = (
        globalThis as unknown as Record<
          string,
          {
            engine: {
              nodes: ReadonlyArray<{ id: string }>;
              setSelected(id: string | null): void;
            };
            settled: Promise<unknown>;
          }
        >
      )[key];
      if (!handle) throw new Error(`no harness handle at globalThis.${key}`);
      await handle.settled;
      handle.engine.setSelected(id);
      const text = (element: Element | null): string =>
        element?.textContent ?? "";
      const rows = [
        ...document.querySelectorAll(`[data-testid="${ids.row}"]`),
      ].map((row) => {
        const spans = row.querySelectorAll("span");
        return {
          label: text(spans[0] ?? null),
          value: text(spans[1] ?? null),
        };
      });
      const blastRows = [
        ...document.querySelectorAll(`[data-testid="${ids.blastRow}"]`),
      ].map((row) => ({
        text: text(row),
        ariaLabel: row.getAttribute("aria-label") ?? "",
      }));
      return {
        rows,
        blastRows,
        blastEmpty: text(document.querySelector(".p-blast-empty")),
        engineNodeIds: handle.engine.nodes.map((node) => node.id),
      };
    },
    { key: handleKey, id: nodeId, ids: testids },
  );
}

/** The value of one panel row by label, or `null` when there is no such row. */
export function rowValue(readout: PanelReadout, label: string): string | null {
  return readout.rows.find((row) => row.label === label)?.value ?? null;
}

/**
 * Build the single-file bundle and return the path to it.
 *
 * The `file://` case is a property of the page's own URL, so it cannot be
 * reached through the dev server: it needs the built artefact. The build runs
 * rather than being assumed, because a `dist/` left over from an earlier
 * commit would let a spec assert an old string and call it green — and it is
 * memoised, because Playwright constructs the module once per run and the
 * bundle does not change between two tests in it.
 */
let builtPage: string | null = null;

export function buildBundleOnce(): string {
  if (builtPage !== null) return builtPage;
  const vizRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const indexPath = join(vizRoot, "dist", "index.html");
  execFileSync("pnpm", ["run", "build"], { cwd: vizRoot, stdio: "pipe" });
  if (!existsSync(indexPath)) {
    throw new Error(
      `the build did not produce ${indexPath}; the file:// case cannot be ` +
        "tested against a bundle that does not exist",
    );
  }
  builtPage = indexPath;
  return builtPage;
}

/**
 * Open a local HTML file over `file://` and wait for the refusal screen.
 *
 * Kept here with the other navigations so the specs stay free of `page.goto`,
 * which 6.1's suite conventions ban for a good reason: a direct navigation
 * races the Viewer's asynchronous boot.
 */
export async function openFromDiskExpectingFailure(
  page: Page,
  filePath: string,
): Promise<ErrorScreenText> {
  await page.goto(pathToFileURL(filePath).href);
  await page.waitForSelector(".error-screen", { timeout: 60_000 });
  return readErrorScreen(page);
}
