import { describe, expect, it } from "vitest";

import {
  SUPPORTED_SCHEMA_MAJOR,
  analysisSchema,
  formatValidationErrors,
  validateAnalysis,
} from "./index.js";
import type { AnalysisDocument, ValidationError } from "./index.js";

/**
 * The smallest document the contract accepts: one module, one file in it, the
 * import edge between the file and itself's module is not modelled — a single
 * edge and a single co-change pair keep every array non-empty so the item
 * schemas are exercised.
 */
function minimalDocument(): AnalysisDocument {
  return {
    schemaVersion: "1.0",
    repo: {
      name: "gitnebula",
      remoteUrl: "https://github.com/jundymek/gitnebula.git",
      analyzedAt: "2026-08-11T10:00:00.000Z",
      defaultBranch: "master",
      analysisWindowDays: 90,
      stats: {
        files: 2,
        loc: 120,
        commits: 7,
        languages: { TypeScript: 1 },
      },
    },
    nodes: [
      {
        id: "packages/contract",
        kind: "module",
        parent: null,
        path: "packages/contract",
        layer: "backend",
        loc: 120,
        churn: 0.5,
        commits: 7,
        authors: 1,
        lastChangedAt: "2026-08-11T09:00:00.000Z",
        description: null,
        descriptionSource: null,
      },
      {
        id: "packages/contract/src/index.ts",
        kind: "file",
        parent: "packages/contract",
        path: "packages/contract/src/index.ts",
        layer: "backend",
        loc: 40,
        churn: 0.25,
        commits: 3,
        authors: 1,
        lastChangedAt: null,
        description: null,
        descriptionSource: null,
      },
    ],
    edges: [
      {
        source: "packages/contract/src/index.ts",
        target: "packages/contract",
        kind: "import",
        weight: 1,
      },
    ],
    cochanges: [
      { a: "packages/contract", b: "packages/contract/src/index.ts", count: 3 },
    ],
  };
}

/** Deep clone that keeps the document mutable for negative cases. */
function clone(document: AnalysisDocument): AnalysisDocument {
  return JSON.parse(JSON.stringify(document)) as AnalysisDocument;
}

/** Deletes the property a JSON Pointer addresses, e.g. `/nodes/0/loc`. */
function deleteAtPointer(document: AnalysisDocument, pointer: string): void {
  const segments = pointer.split("/").slice(1);
  const last = segments.pop();
  if (last === undefined) throw new Error(`bad pointer: ${pointer}`);

  let cursor: Record<string, unknown> = document as unknown as Record<
    string,
    unknown
  >;
  for (const segment of segments) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  delete cursor[last];
}

function errorsOf(data: unknown): readonly ValidationError[] {
  const result = validateAnalysis(data);
  if (result.valid) throw new Error("expected the document to be rejected");
  return result.errors;
}

describe("analysisSchema", () => {
  it("is a draft 2020-12 schema describing schemaVersion 1.0", () => {
    expect(analysisSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(analysisSchema.properties.schemaVersion.const).toBe("1.0");
  });

  it("exposes the supported major version the Viewer checks", () => {
    expect(SUPPORTED_SCHEMA_MAJOR).toBe(1);
    expect(String(SUPPORTED_SCHEMA_MAJOR)).toBe(
      minimalDocument().schemaVersion.split(".")[0],
    );
  });
});

describe("validateAnalysis", () => {
  it("accepts a valid minimal document and narrows its type", () => {
    const result = validateAnalysis(minimalDocument());

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.data.nodes).toHaveLength(2);
  });

  it("accepts a repo with no remote and an empty graph", () => {
    const document = clone(minimalDocument());
    document.repo.remoteUrl = null;
    document.nodes = [];
    document.edges = [];
    document.cochanges = [];

    expect(validateAnalysis(document).valid).toBe(true);
  });

  const requiredFields = [
    "/schemaVersion",
    "/repo",
    "/nodes",
    "/edges",
    "/cochanges",
    "/repo/name",
    "/repo/remoteUrl",
    "/repo/analyzedAt",
    "/repo/defaultBranch",
    "/repo/analysisWindowDays",
    "/repo/stats",
    "/repo/stats/files",
    "/repo/stats/loc",
    "/repo/stats/commits",
    "/repo/stats/languages",
    "/nodes/0/id",
    "/nodes/0/kind",
    "/nodes/0/parent",
    "/nodes/0/path",
    "/nodes/0/layer",
    "/nodes/0/loc",
    "/nodes/0/churn",
    "/nodes/0/commits",
    "/nodes/0/authors",
    "/nodes/0/lastChangedAt",
    "/nodes/0/description",
    "/nodes/0/descriptionSource",
    "/edges/0/source",
    "/edges/0/target",
    "/edges/0/kind",
    "/edges/0/weight",
    "/cochanges/0/a",
    "/cochanges/0/b",
    "/cochanges/0/count",
  ];

  it.each(requiredFields)(
    "rejects a document missing %s, pointing at the field",
    (pointer) => {
      const document = clone(minimalDocument());
      deleteAtPointer(document, pointer);

      const errors = errorsOf(document);

      expect(errors.map((error) => error.path)).toContain(pointer);
    },
  );

  it("rejects an unknown layer value", () => {
    const document = clone(minimalDocument());
    // The scanner may only emit the ADR-0002 layers.
    (document.nodes[0] as { layer: string }).layer = "database";

    const errors = errorsOf(document);

    expect(errors).toContainEqual({
      path: "/nodes/0/layer",
      message: "must be equal to one of the allowed values",
    });
  });

  it("rejects an unknown node kind", () => {
    const document = clone(minimalDocument());
    (document.nodes[0] as { kind: string }).kind = "package";

    expect(errorsOf(document).map((error) => error.path)).toContain(
      "/nodes/0/kind",
    );
  });

  it("rejects a churn outside 0..1", () => {
    const document = clone(minimalDocument());
    document.nodes[0]!.churn = 1.5;

    expect(errorsOf(document)).toContainEqual({
      path: "/nodes/0/churn",
      message: "must be <= 1",
    });
  });

  it("rejects a populated description — MVP reserves the field as null", () => {
    const document = clone(minimalDocument());
    (document.nodes[0] as { description: unknown }).description = "a module";

    expect(errorsOf(document).map((error) => error.path)).toContain(
      "/nodes/0/description",
    );
  });

  it("rejects an unsupported schemaVersion", () => {
    const document = clone(minimalDocument());
    (document as { schemaVersion: string }).schemaVersion = "2.0";

    expect(errorsOf(document).map((error) => error.path)).toContain(
      "/schemaVersion",
    );
  });

  it("rejects an edge kind other than import", () => {
    const document = clone(minimalDocument());
    (document.edges[0] as { kind: string }).kind = "cochange";

    expect(errorsOf(document).map((error) => error.path)).toContain(
      "/edges/0/kind",
    );
  });

  it("rejects unknown properties, so a typo is never silently ignored", () => {
    const document = clone(minimalDocument()) as unknown as Record<
      string,
      unknown
    >;
    document.nodeCount = 2;

    expect(errorsOf(document).map((error) => error.message)).toContain(
      "must NOT have additional properties",
    );
  });

  // The schema declares `format: "date-time"`, which promises RFC 3339
  // semantics — not merely the right number of digits in the right places. A
  // shape-only check would let `2026-99-99T25:61:61Z` reach the Viewer, where
  // `new Date(...)` turns it into `Invalid Date` and the panel renders NaN.
  const validInstants = [
    "2026-08-11T10:00:00.000Z", // toISOString()
    "2026-08-11T10:00:00Z", // no fraction
    "2026-08-11t10:00:00z", // RFC 3339 allows lowercase
    "2026-08-11T12:00:00+02:00", // git log --date=iso-strict
    "2026-08-11T08:00:00-02:30", // half-hour offset
    "2024-02-29T00:00:00Z", // leap day in a leap year
    "2026-12-31T23:59:59Z", // the last representable second of a year
  ];

  it.each(validInstants)("accepts the RFC 3339 instant %s", (instant) => {
    const document = clone(minimalDocument());
    document.repo.analyzedAt = instant;

    expect(validateAnalysis(document).valid).toBe(true);
  });

  const invalidInstants = [
    "2026-99-99T25:61:61Z", // every component out of range
    // Year 0000 parses in JavaScript, but no repository has commits from it —
    // a zero year is an upstream parsing bug, not a timestamp.
    "0000-01-01T00:00:00Z",
    "2026-13-01T00:00:00Z", // month 13
    "2026-00-01T00:00:00Z", // month 0
    "2026-08-32T00:00:00Z", // day 32
    "2026-08-00T00:00:00Z", // day 0
    "2026-02-30T00:00:00Z", // February never has 30 days
    "2026-02-29T00:00:00Z", // 2026 is not a leap year
    "2026-04-31T00:00:00Z", // April has 30 days
    "2026-08-11T24:00:00Z", // hour 24
    "2026-08-11T10:60:00Z", // minute 60
    "2026-08-11T10:00:61Z", // second 61
    // A leap second is legal RFC 3339 but unrepresentable downstream: `git`
    // stores POSIX epoch seconds, which have no leap second, and `new Date()`
    // returns Invalid Date for one. Accepting it would let the Viewer render
    // the NaN this format exists to prevent.
    "2026-12-31T23:59:60Z", // the one instant a leap second may occur
    "2027-01-01T00:59:60+01:00", // the same instant, seen from +01:00
    "2026-08-11T10:00:60Z", // a midday :60
    "2026-08-11T10:00:00+24:00", // offset hour out of range
    "2026-08-11T10:00:00+02:60", // offset minute out of range
    "2026-08-11T10:00:00", // no timezone — RFC 3339 requires one
    "2026-08-11 10:00:00Z", // space instead of T
    "not a date",
  ];

  it.each(invalidInstants)("rejects the malformed instant %s", (instant) => {
    const document = clone(minimalDocument());
    document.repo.analyzedAt = instant;

    expect(errorsOf(document).map((error) => error.path)).toContain(
      "/repo/analyzedAt",
    );
  });

  // The point of validating date-time semantics rather than shape: the Viewer
  // feeds these strings straight to `new Date(...)`, so anything the contract
  // accepts must survive that. This asserts the invariant itself, not a list
  // of examples — a future widening that lets an unparseable instant through
  // fails here even if nobody thought to add it to the table above.
  it.each(validInstants)("accepted instant %s parses as a real Date", (i) => {
    expect(Number.isNaN(new Date(i).getTime())).toBe(false);
  });

  it("applies the same date-time rule to a node's lastChangedAt", () => {
    const document = clone(minimalDocument());
    document.nodes[0]!.lastChangedAt = "2026-02-29T00:00:00Z";

    expect(errorsOf(document).map((error) => error.path)).toContain(
      "/nodes/0/lastChangedAt",
    );
  });

  it("rejects a non-object document with a root pointer", () => {
    const errors = errorsOf("not a document");

    expect(errors[0]?.path).toBe("/");
  });
});

describe("formatValidationErrors", () => {
  it("renders one indented line per error for a cli failure message", () => {
    const document = clone(minimalDocument());
    deleteAtPointer(document, "/nodes/0/loc");

    const rendered = formatValidationErrors(errorsOf(document));

    expect(rendered).toBe("  /nodes/0/loc must have required property 'loc'");
  });
});
