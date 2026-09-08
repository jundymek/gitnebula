/**
 * Story 6.4 — the test material: a document whose panel has more content than
 * one window can hold.
 *
 * **Why this exists at all.** `packages/contract/fixtures/root-files.json`,
 * which `ui/playwright.config.ts` pins the dev server to, carries exactly
 * **one** co-change pair. That is the right fixture for the suite — six nodes
 * a reader can hold in their head — and it is structurally unable to produce
 * the case this story is about: a partner list long enough to push the panel's
 * controls out of the window.
 *
 * So the long list is synthesised here, from that fixture as its base, and
 * served to one `page` through `page.route`. Three consequences worth stating,
 * because each of them is a decision:
 *
 * - **`ui/playwright.config.ts` is not modified.** Its
 *   `GITNEBULA_FIXTURE: "root-files"` pin stays exactly as story 6.1 wrote it,
 *   so `smoke.pw.ts`'s "the suite serves the fixture its config names" keeps
 *   meaning what it means, and stories 6.2 and 6.3 — writing into this same
 *   directory in the same wave — inherit no change from this one.
 * - **Nothing is added to `packages/contract/fixtures/`.** The story spec
 *   forbids it, and rightly: a fixture is a shared artefact of the contract
 *   package, and this document exists to stress one component's layout.
 * - **The result is validated against the real schema before it is served.**
 *   A synthetic document that had drifted from the contract would otherwise
 *   produce a run that looks entirely normal while measuring a page the
 *   product can never show. `validateAnalysis` is the same validator the cli
 *   runs over what it assembles, so "valid" here means what it means there.
 *
 * The fixture is read the way `packages/viz/vite.config.ts` already reads it —
 * `../contract/fixtures/<name>.json` relative to the `viz` package. This adds
 * no new reach across the AD-2 boundary; `viz` already depends on
 * `@gitnebula/contract`, and the fixtures are what that dependency is for.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatValidationErrors,
  validateAnalysis,
  type AnalysisDocument,
  type AnalysisEdge,
  type AnalysisNode,
  type CochangePair,
} from "@gitnebula/contract";
import type { Page } from "@playwright/test";

/**
 * How many co-change partners the synthesised document gives its busiest file.
 *
 * **44 is not a round number picked for effect.** It is the count
 * `styles.css:874-881` records from a measurement on this repository — one
 * real file with 44 co-change partners, at ~23 px a row, is over 1,000 px of
 * list. That measurement is why `.p-blast-list` carries a cap at all, so it is
 * the number the cap should be exercised at.
 */
export const PARTNER_COUNT = 44;

/** The file whose panel the reachability specs open. */
export const BUSIEST_FILE_ID = "fp/proxy.py";

/**
 * How many partner rows the panel actually renders for {@link BUSIEST_FILE_ID}.
 *
 * **One more than {@link PARTNER_COUNT}**, and the difference is the point:
 * `root-files` already pairs `fp/proxy.py` with `test_proxy.py`, and this
 * builder *adds to* the base document rather than replacing its co-change
 * list. A spec asserting `PARTNER_COUNT` rows would be off by exactly that
 * inherited pair — which is how the first run of this story failed, usefully.
 *
 * `buildLongCochangeDocument` re-derives this from the document it just built
 * and throws if the two disagree, so the constant cannot drift from the
 * fixture it describes.
 */
export const EXPECTED_PARTNER_ROWS = PARTNER_COUNT + 1;

/**
 * A node whose path is long enough that the tooltip's box is unmistakably
 * wider than its offset from the cursor.
 *
 * The tooltip prints `${path} · churn N%` (`tooltip.ts:66-68`), so the label's
 * rendered width is a function of this string and of the mono font that draws
 * it — which is precisely the input that has never been real: in jsdom
 * `offsetWidth` is always 0, so every existing assertion about the flip has
 * been made against a 0x0 box.
 *
 * Deliberately a **root-level** file (`parent: null`): `flyTo` unfolds and
 * pins a file's parent module before aiming at it (`engine.ts:601-606`), and
 * the tooltip spec wants the camera arithmetic, not the unfold machinery.
 */
export const LONG_PATH_ID =
  "services/ingestion/pipeline/transformers/normalise-inbound-webhook-payloads.py";

/** Inside `root-files`' analysis window, and never moves. */
const FIXED_TIMESTAMP = "2025-12-30T12:00:00.000Z";

const here = dirname(fileURLToPath(import.meta.url));
/** `ui/tests/support` -> `packages/`, then into the contract's fixtures. */
const ROOT_FILES_FIXTURE = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "contract",
  "fixtures",
  "root-files.json",
);

function partnerId(index: number): string {
  return `partner-${String(index).padStart(3, "0")}.py`;
}

function fileNode(
  id: string,
  layer: AnalysisNode["layer"],
  loc: number,
): AnalysisNode {
  return {
    id,
    kind: "file",
    parent: null,
    path: id,
    layer,
    loc,
    // Below `HOT_THRESHOLD`, so the synthetic crowd does not put 44 hot-spot
    // badges on a map no assertion here is about.
    churn: 0.2,
    commits: 4,
    authors: 1,
    lastChangedAt: FIXED_TIMESTAMP,
    description: null,
    descriptionSource: null,
  };
}

/**
 * Which of the 44 partners get import edges, and in which direction.
 *
 * This is not decoration. `#start-here` is one of the three bounded regions
 * AC-2 measures, and its content is derived rather than given:
 * `start-here-model.ts` fills **core** from non-test files something imports,
 * **entry-points** from non-test files nothing imports but which import
 * something, and **tests** from files in the `test` layer — five rows each
 * (`START_HERE_LIMIT`). `root-files` alone fills none of the three to that
 * depth, so the panel would never reach its own cap and AC-2's assertion about
 * it would be vacuously green.
 *
 * The bands below fill all three. They are contiguous and disjoint so the
 * arithmetic is checkable by eye.
 */
const CORE_BAND = { from: 0, to: 8 } as const;
const ENTRY_BAND = { from: 8, to: 16 } as const;
const TEST_BAND = { from: 16, to: 24 } as const;

/**
 * `root-files`, plus a 44-partner co-change list and a long-path node.
 *
 * Everything the base fixture declares — its repo metadata, its six nodes, its
 * four edges, its one co-change pair — survives untouched. This only adds.
 */
export function buildLongCochangeDocument(): AnalysisDocument {
  const base = JSON.parse(
    readFileSync(ROOT_FILES_FIXTURE, "utf8"),
  ) as AnalysisDocument;

  const partners: AnalysisNode[] = [];
  const edges: AnalysisEdge[] = [...base.edges];

  for (let index = 0; index < PARTNER_COUNT; index++) {
    const id = partnerId(index);
    if (index >= TEST_BAND.from && index < TEST_BAND.to) {
      partners.push(fileNode(id, "test", 40 + index));
      // An out-edge, which is what the `tests` category ranks by.
      edges.push({
        source: id,
        target: BUSIEST_FILE_ID,
        kind: "import",
        weight: 1,
      });
      continue;
    }
    partners.push(fileNode(id, "backend", 120 + index));
    if (index >= CORE_BAND.from && index < CORE_BAND.to) {
      // Imported by something -> in-degree > 0 -> `core`.
      edges.push({ source: "setup.py", target: id, kind: "import", weight: 1 });
    } else if (index >= ENTRY_BAND.from && index < ENTRY_BAND.to) {
      // Imports something, imported by nothing -> `entry-points`.
      edges.push({
        source: id,
        target: "version.py",
        kind: "import",
        weight: 1,
      });
    }
  }

  // Descending counts, so the panel's own `count desc, id asc` sort is
  // exercised rather than merely tolerated, and the row order is a fact about
  // the document rather than about the order it was built in.
  const cochanges: CochangePair[] = [
    ...base.cochanges,
    ...partners.map((partner, index) => ({
      a: BUSIEST_FILE_ID,
      b: partner.id,
      count: PARTNER_COUNT - index,
    })),
  ];

  const longPath = fileNode(LONG_PATH_ID, "backend", 210);

  const document: AnalysisDocument = {
    ...base,
    repo: {
      ...base.repo,
      stats: {
        ...base.repo.stats,
        // Kept consistent with `nodes`: a reader comparing the header's file
        // count against the map should not be told two different numbers by
        // one document.
        files: base.repo.stats.files + partners.length + 1,
      },
    },
    nodes: [...base.nodes, ...partners, longPath],
    edges,
    cochanges,
  };

  // The panel lists every pair touching the node, at the node's own kind
  // (`panel-model.ts:285-306`). Counting it here rather than trusting the
  // arithmetic keeps `EXPECTED_PARTNER_ROWS` honest against any later edit to
  // the bands above or to the base fixture.
  const fileIds = new Set(
    document.nodes
      .filter((node) => node.kind === "file")
      .map((node) => node.id),
  );
  const rows = document.cochanges.filter(
    (pair) =>
      (pair.a === BUSIEST_FILE_ID && fileIds.has(pair.b)) ||
      (pair.b === BUSIEST_FILE_ID && fileIds.has(pair.a)),
  ).length;
  if (rows !== EXPECTED_PARTNER_ROWS) {
    throw new Error(
      `6.4's synthetic document gives ${BUSIEST_FILE_ID} ${rows} co-change ` +
        `partners, but EXPECTED_PARTNER_ROWS says ${EXPECTED_PARTNER_ROWS}. ` +
        "The specs assert that count to prove the list is long enough to " +
        "matter, so the two must not drift.",
    );
  }

  const result = validateAnalysis(document);
  if (!result.valid) {
    // Thrown, never warned. A document that fails the contract would still
    // render *something*, and a spec measuring that something is worse than a
    // spec that does not run at all.
    throw new Error(
      "6.4's synthetic document is not a valid analysis.json:\n" +
        formatValidationErrors(result.errors),
    );
  }
  return result.data;
}

/**
 * Serve the synthesised document to this page instead of the dev server's
 * fixture.
 *
 * Must be installed **before** navigating. Routes are scoped to one `page`,
 * and the suite runs `workers: 1` with `fullyParallel: false`, so this cannot
 * reach a spec belonging to story 6.2 or 6.3.
 *
 * The glob matches the request the Viewer actually makes — `./analysis.json`,
 * the only URL it ever requests (`loader.ts:18`, AD-12).
 */
export async function serveLongCochangeDocument(page: Page): Promise<void> {
  const body = JSON.stringify(buildLongCochangeDocument());
  await page.route("**/analysis.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body,
    }),
  );
}
