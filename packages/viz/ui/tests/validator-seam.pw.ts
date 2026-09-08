import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { validateAnalysis } from "@gitnebula/contract";

import { HARNESS_HANDLE_KEY } from "../../src/harness-handle.js";
import {
  PANEL_BLAST_ROW_TESTID,
  PANEL_ROW_TESTID,
} from "../../src/chrome/testids.js";
import {
  cochangesOf,
  edgesOf,
  hasHarnessHandle,
  nodesOf,
  openViewerWithDocument,
  rowValue,
  selectAndReadPanel,
  validDocument,
  type LooseDocument,
} from "./support/load-failure-page.js";

/**
 * Story 6.3, AC-4 / AC-5 / AC-6 — the seam between the two validators, and
 * what a reader sees when a document falls through it.
 *
 * ## The seam
 *
 * One document is guarded twice and the two guards do not agree:
 *
 *   - `packages/cli/src/assemble.ts` validates with **ajv** against
 *     `packages/contract/src/analysis.schema.json`, which is
 *     `additionalProperties: false` on the root and on every definition.
 *   - `packages/viz/src/loader.ts` re-checks with **hand-written predicates
 *     over a subset of fields** — deliberately, so the bundle stays
 *     self-contained and carries no validator (AD-8, AD-12).
 *
 * Each side is correct on its own terms. The gap exists only *between* them,
 * which is why no per-branch review has ever found it: the document that
 * exercises it is one no gitnebula run produces.
 *
 * ## What this file does, and does not, do
 *
 * It **measures and reports**. It does not close the gap. Widening
 * `loader.ts` is a contract-adjacent decision — `CLAUDE.md` requires its own
 * story, a schema-version decision and an ADR for a structural change — and
 * the loader's narrowness is a design choice with a stated reason, not an
 * oversight. `loader.ts` and `assemble.ts` are unmodified by this story;
 * `docs/dev/epic-6/6.3-viz-load-failure/README.md` states what a future story
 * would have to decide.
 *
 * The numbers below are **re-derived from the schema and the loader's own
 * source at test time**, not transcribed from the story spec. A count written
 * into a test is a count that stops being true without anything going red.
 */

const SCHEMA_PATH = fileURLToPath(
  new URL("../../../contract/src/analysis.schema.json", import.meta.url),
);
const LOADER_PATH = fileURLToPath(
  new URL("../../src/loader.ts", import.meta.url),
);

const TESTIDS = {
  row: PANEL_ROW_TESTID,
  blastRow: PANEL_BLAST_ROW_TESTID,
} as const;

interface SchemaDefinition {
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

function schema(): {
  readonly required: readonly string[];
  readonly additionalProperties?: boolean;
  readonly $defs: Record<string, SchemaDefinition>;
} {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

/**
 * The fields a hand-written predicate in `loader.ts` actually inspects.
 *
 * Read out of the function's own source rather than listed here: a list would
 * be a second copy of the loader, and the whole point of this story is that
 * two copies of one truth drift apart without either being wrong.
 */
function fieldsCheckedBy(functionName: string): readonly string[] {
  const source = readFileSync(LOADER_PATH, "utf8");
  const start = source.indexOf(`function ${functionName}(`);
  if (start === -1) {
    throw new Error(`loader.ts no longer declares ${functionName}`);
  }
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open, end);
  return [
    ...new Set([...body.matchAll(/\bcandidate\.(\w+)/g)].map((m) => m[1]!)),
  ].sort();
}

test.describe("the seam, re-measured from the two sources (AC-4)", () => {
  test("the schema requires 12 node fields; the loader checks 6", async () => {
    const nodeRequired = schema().$defs.node?.required ?? [];
    const checked = fieldsCheckedBy("isNodeShaped");

    // Re-derived, then compared with the figures the story spec was written
    // against. A drift here is a finding, not a broken test — so the message
    // says which number moved.
    expect(
      { required: nodeRequired.length, checked: checked.length },
      "the node-field counts have drifted from the figures story 6.3 was " +
        `written against (12 required, 6 checked). Schema requires ` +
        `${nodeRequired.length}: ${nodeRequired.join(", ")}. The loader ` +
        `checks ${checked.length}: ${checked.join(", ")}. Report the drift ` +
        "in the story README before changing this number.",
    ).toEqual({ required: 12, checked: 6 });

    expect(
      checked,
      "isNodeShaped no longer checks exactly the six fields this story " +
        "measured; the unchecked set below is derived from this list",
    ).toEqual(["churn", "id", "kind", "layer", "loc", "path"]);

    const unchecked = nodeRequired.filter((field) => !checked.includes(field));
    expect(
      unchecked,
      "the set of required-but-unchecked node fields has changed; every " +
        "classification in this file is written against the previous set",
    ).toEqual([
      "parent",
      "commits",
      "authors",
      "lastChangedAt",
      "description",
      "descriptionSource",
    ]);
  });

  test("the schema requires 4 edge fields; the loader checks 2", async () => {
    const edgeRequired = schema().$defs.edge?.required ?? [];
    const checked = fieldsCheckedBy("isEdgeShaped");

    expect(
      { required: edgeRequired.length, checked: checked.length },
      "the edge-field counts have drifted from the figures story 6.3 was " +
        `written against (4 required, 2 checked). Schema requires ` +
        `${edgeRequired.join(", ")}; the loader checks ${checked.join(", ")}.`,
    ).toEqual({ required: 4, checked: 2 });
    expect(
      edgeRequired.filter((field) => !checked.includes(field)),
      "the required-but-unchecked edge fields have changed",
    ).toEqual(["kind", "weight"]);
  });

  test("cochanges are required, and checked only for being an array", async () => {
    const root = schema();
    const cochangeRequired = root.$defs.cochange?.required ?? [];
    const source = readFileSync(LOADER_PATH, "utf8");

    expect(
      root.required.includes("cochanges"),
      "`cochanges` is no longer required at the document root, which changes " +
        "what the loader's array check is worth",
    ).toBe(true);
    expect(
      cochangeRequired,
      "a co-change pair no longer requires exactly a, b and count — the " +
        "blast-radius panel reads all three",
    ).toEqual(["a", "b", "count"]);
    expect(
      source.includes("Array.isArray(document.cochanges)"),
      "loader.ts no longer checks that `cochanges` is an array at all",
    ).toBe(true);
    // The half that makes the gap: the array is checked, its elements never
    // are. If this stops being true the loader has been widened, which this
    // story deliberately did not do.
    expect(
      /cochanges[\s\S]{0,400}?\b(isCochangeShaped|\.count\b|pair\.a\b)/.test(
        source,
      ),
      "loader.ts now inspects co-change elements; the gap this story " +
        "measured has been closed, and the README's recommendation is stale",
    ).toBe(false);
  });
});

/**
 * The document at the centre of the story: every field the schema requires and
 * the loader does not check, removed. ajv rejects it; the loader accepts it.
 */
function documentThroughTheSeam(): LooseDocument {
  const document = validDocument();
  for (const node of nodesOf(document)) {
    delete node.parent;
    delete node.commits;
    delete node.authors;
    delete node.lastChangedAt;
    delete node.description;
    delete node.descriptionSource;
  }
  for (const edge of edgesOf(document)) {
    delete edge.kind;
    delete edge.weight;
  }
  for (const pair of cochangesOf(document)) {
    delete pair.count;
  }
  return document;
}

test.describe("a document ajv rejects, rendered in the browser (AC-5)", () => {
  test("the pipeline would refuse to emit it, and the Viewer draws it", async ({
    page,
  }) => {
    const document = documentThroughTheSeam();

    // Half one, proved rather than asserted in prose: this is the exact
    // validator `assemble.ts` runs before writing analysis.json, so a
    // gitnebula run could never produce this file.
    const validation = validateAnalysis(document);
    // `ValidationResult` is a discriminated union, so the errors are read
    // through the discriminant rather than after it: an `expect` is not a type
    // guard, and reaching for `.errors` on the union does not compile.
    const errors = validation.valid ? [] : validation.errors;
    expect(
      validation.valid,
      "ajv accepted the document this test built, so it does not demonstrate " +
        "the seam at all — the schema must reject it for the browser half to " +
        "mean anything",
    ).toBe(false);
    expect(
      errors.length,
      "ajv rejected the document with no errors to show, which cannot happen",
    ).toBeGreaterThan(0);
    // Named, not merely counted: the story's claim is about *which* fields
    // fall through, so the schema has to be seen objecting to those fields
    // rather than to something incidental.
    const complaints = errors.map((error) => `${error.path} ${error.message}`);
    for (const field of ["parent", "weight", "count"]) {
      expect(
        complaints.filter((complaint) => complaint.includes(field)),
        `ajv did not object to the missing \`${field}\`, so this document ` +
          "does not exercise the part of the seam this story measured. " +
          `ajv said: ${complaints.join(" | ")}`,
      ).not.toHaveLength(0);
    }

    // Half two: the same bytes, through the Viewer's own loader, over HTTP.
    const served = await openViewerWithDocument(
      page,
      document,
      HARNESS_HANDLE_KEY,
    );

    expect(
      served.wasRequested(),
      "the Viewer never requested analysis.json, so it rendered the dev " +
        "server's valid fixture and this test proves nothing",
    ).toBe(true);
    expect(
      await hasHarnessHandle(page, HARNESS_HANDLE_KEY),
      "the Viewer refused a document its loader is documented to accept; if " +
        "loader.ts has been widened, this story's README is stale",
    ).toBe(true);
    expect(
      await page.locator(".error-screen").count(),
      "the Viewer showed the FR-6 refusal screen for a document that passes " +
        "its own predicates",
    ).toBe(0);
    expect(
      await page.locator("#stage").count(),
      "the Viewer published an engine but drew no canvas",
    ).toBe(1);
  });
});

/**
 * AC-5's second half: for each unchecked field, does the Viewer **degrade
 * safely** — the reader sees an honest absence — or does it **misread**, and
 * show a wrong number or lose something?
 *
 * These are different findings and the story is required to distinguish them.
 * Each test below removes exactly one field group from an otherwise valid
 * document, so the effect it measures is attributable to that field alone.
 */
test.describe("degrades safely, or misreads (AC-5)", () => {
  /** The module in `root-files`, and the two files that name it as parent. */
  const MODULE_ID = "fp/";
  const FILE_ID = "fp/proxy.py";

  async function readPanelFor(
    page: import("@playwright/test").Page,
    document: LooseDocument,
    nodeId: string,
  ) {
    await openViewerWithDocument(page, document, HARNESS_HANDLE_KEY);
    return selectAndReadPanel(page, HARNESS_HANDLE_KEY, nodeId, TESTIDS);
  }

  test("node.parent — MISREADS: a module reports none of its files", async ({
    page,
  }) => {
    const document = validDocument();
    for (const node of nodesOf(document)) delete node.parent;

    const panel = await readPanelFor(page, document, MODULE_ID);

    // `countMembers` counts document nodes whose `parent` equals the module
    // id; with the field gone, none do. The module still draws — it simply
    // claims to be empty, which is a wrong number rather than a missing one.
    expect(
      rowValue(panel, "files"),
      "removing `parent` no longer changes the module's file count. If the " +
        "loader was widened, or countMembers stopped reading `parent`, this " +
        "classification needs re-deriving.",
    ).toBe("0");
    // And the effect is not confined to the panel: `buildGraph` puts a file
    // with no `parent` in neither `rootFileIndices` nor any module's member
    // list, so it is laid out nowhere while still being in `engine.nodes`.
    expect(
      panel.engineNodeIds,
      "the engine no longer holds every document node, which would change " +
        "what 'the file is absent from the map' means here",
    ).toContain(FILE_ID);
  });

  test("node.authors — MISREADS: the panel prints NaN", async ({ page }) => {
    const document = validDocument();
    for (const node of nodesOf(document)) delete node.authors;

    const panel = await readPanelFor(page, document, FILE_ID);

    // `formatInteger(undefined)` is `Math.round(undefined).toLocaleString()`,
    // i.e. the string "NaN". The row is not marked empty, so nothing tells
    // the reader this is an absence rather than a value.
    expect(
      rowValue(panel, "authors"),
      "removing `authors` no longer produces NaN in the panel; the " +
        "classification of this field in the story README needs re-deriving",
    ).toBe("NaN");
  });

  test("node.lastChangedAt — DEGRADES, with a caveat", async ({ page }) => {
    const document = validDocument();
    for (const node of nodesOf(document)) delete node.lastChangedAt;

    const panel = await readPanelFor(page, document, FILE_ID);

    // `formatRelativeTime` parses `undefined` to NaN and returns the em dash,
    // so nothing wrong is shown. The caveat, recorded in the README: the
    // panel's `nodeIsQuiet` test is `=== null`, so an absent field takes the
    // *formatting* path rather than the honest "no change in the last N days"
    // path — the reader gets a bare dash instead of the sentence the contract
    // has a state for.
    expect(
      rowValue(panel, "last change"),
      "removing `lastChangedAt` no longer renders the empty-metric dash; it " +
        "may now be misreading rather than degrading",
    ).toBe("—");
  });

  test("node.commits, description, descriptionSource — DEGRADE SAFELY", async ({
    page,
  }) => {
    const document = validDocument();
    for (const node of nodesOf(document)) {
      delete node.commits;
      delete node.description;
      delete node.descriptionSource;
    }

    const panel = await readPanelFor(page, document, FILE_ID);

    // None of the three is rendered: the header's commit count comes from
    // `repo.stats.commits`, and `description` belongs to the post-MVP
    // describe layer, which no surface reads yet. So their absence is
    // invisible — which is the definition of degrading safely, and also the
    // reason this is the group most likely to become a misread later.
    const values = panel.rows.map((row) => row.value);
    expect(
      values.filter((value) => value.includes("NaN")),
      "removing commits/description/descriptionSource now puts NaN in the " +
        "panel, so this group has moved from degrading to misreading",
    ).toEqual([]);
    expect(
      values.filter((value) => value.includes("undefined")),
      "removing commits/description/descriptionSource now renders the word " +
        "`undefined` to the reader",
    ).toEqual([]);
  });

  test("edge.kind and edge.weight — DEGRADE SAFELY", async ({ page }) => {
    const document = validDocument();
    for (const edge of edgesOf(document)) {
      delete edge.kind;
      delete edge.weight;
    }

    await openViewerWithDocument(page, document, HARNESS_HANDLE_KEY);

    // `buildGraph` reads `edge.weight` into `GraphEdge`, and nothing in `viz`
    // reads it back; `edge.kind` is never read at all. The map draws.
    expect(
      await page.locator(".error-screen").count(),
      "a document with no edge kinds or weights now fails to load",
    ).toBe(0);
    expect(
      await page.locator("#stage").count(),
      "a document with no edge kinds or weights now draws no canvas",
    ).toBe(1);
  });

  test("cochanges[].count — MISREADS: `NaN commits` in the blast radius", async ({
    page,
  }) => {
    const document = validDocument();
    for (const pair of cochangesOf(document)) delete pair.count;

    const panel = await readPanelFor(page, document, FILE_ID);

    // The blast-radius section orders partners by shared commits and prints
    // the count beside each. With the field gone the reader is shown a
    // partner and a number that is not one — in the accessible name too.
    expect(
      panel.blastRows.length,
      "the blast-radius section shows no partner rows for a file that has a " +
        "co-change pair; the count classification cannot be read",
    ).toBeGreaterThan(0);
    expect(
      panel.blastRows[0]?.text,
      "removing a co-change `count` no longer produces NaN in the partner " +
        "row; re-derive this field's classification",
    ).toContain("NaN");
    expect(
      panel.blastRows[0]?.ariaLabel,
      "the partner row's accessible name no longer carries the broken count, " +
        "so a screen-reader user and a sighted one now see different things",
    ).toContain("NaN");
  });

  test("cochanges[].a and .b — MISREADS: the pair silently disappears", async ({
    page,
  }) => {
    const document = validDocument();
    for (const pair of cochangesOf(document)) delete pair.a;

    const panel = await readPanelFor(page, document, FILE_ID);

    // `partnerOf` matches the selected id against `a` and `b`; with `a` gone
    // the pair matches nothing and drops out. The panel then states, as a
    // fact about the repository, that this file changes alone — which is the
    // opposite of what the document says.
    expect(
      panel.blastRows,
      "a co-change pair with no `a` still produces a partner row; the " +
        "disappearance this classification describes no longer happens",
    ).toEqual([]);
    expect(
      panel.blastEmpty,
      "the panel shows no empty-state sentence for the vanished pair, so " +
        "the misread is silent in a different way than this test describes",
    ).not.toBe("");
  });
});
