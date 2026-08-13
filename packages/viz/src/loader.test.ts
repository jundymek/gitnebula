import { SUPPORTED_SCHEMA_MAJOR } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import {
  ANALYSIS_URL,
  FILE_PROTOCOL_HINT,
  checkVersion,
  loadAnalysis,
} from "./loader.js";
import { loadSyntheticFixture } from "./test-support/fixtures.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("loader — AD-12 data-loading contract", () => {
  it("requests ./analysis.json and nothing else", async () => {
    const requested: string[] = [];
    const document = loadSyntheticFixture();
    const result = await loadAnalysis((url) => {
      requested.push(url);
      return Promise.resolve(jsonResponse(document));
    });

    expect(requested).toEqual([ANALYSIS_URL]);
    expect(ANALYSIS_URL).toBe("./analysis.json");
    expect(result.ok).toBe(true);
  });

  it("accepts the committed contract fixtures", async () => {
    const result = await loadAnalysis(() =>
      Promise.resolve(jsonResponse(loadSyntheticFixture())),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.repo.stats.files).toBe(2000);
  });
});

describe("loader — ADR-0004 file:// is not a supported host (4.1 AC-3)", () => {
  it("names the fix instead of fetching, on a page opened from disk", async () => {
    const requested: string[] = [];
    const result = await loadAnalysis((url) => {
      requested.push(url);
      return Promise.resolve(jsonResponse({}));
    }, "file:");

    // Not attempted at all: the browser's own failure for this case is
    // "Failed to fetch", which describes nothing the reader can act on.
    expect(requested).toEqual([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unreachable");
      expect(result.failure.detail).toBe(FILE_PROTOCOL_HINT);
      // The one-liner ADR-0004 promises the user gets pointed at.
      expect(result.failure.detail).toContain("npx serve");
    }
  });

  it("fetches normally over http", async () => {
    const requested: string[] = [];
    await loadAnalysis((url) => {
      requested.push(url);
      return Promise.resolve(jsonResponse(loadSyntheticFixture()));
    }, "http:");

    expect(requested).toEqual([ANALYSIS_URL]);
  });
});

describe("loader — FR-6 version gate", () => {
  it("refuses a document whose major version it does not understand", () => {
    const result = checkVersion({
      ...loadSyntheticFixture(),
      schemaVersion: "99.0",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unsupported-version");
    // The screen must name BOTH versions, not just say "unsupported".
    expect(result.failure.foundVersion).toBe("99.0");
    expect(result.failure.supportedVersion).toBe(
      String(SUPPORTED_SCHEMA_MAJOR),
    );
    expect(result.failure.detail).toContain("99.0");
    expect(result.failure.detail).toContain(String(SUPPORTED_SCHEMA_MAJOR));
  });

  it("accepts a later minor of the supported major", () => {
    const result = checkVersion({
      ...loadSyntheticFixture(),
      schemaVersion: `${SUPPORTED_SCHEMA_MAJOR}.7`,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a document with no schemaVersion at all", () => {
    const result = checkVersion({ nodes: [], edges: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("malformed");
  });

  it("refuses a same-major document that is not actually a document", () => {
    // The version gate matching is not the same as the file being readable:
    // this one used to pass and then blank the page on `repo.name`.
    const result = checkVersion({ schemaVersion: "1.0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed");
      expect(result.failure.detail).toContain("nodes");
    }
  });

  it.each([
    ["repo", { schemaVersion: "1.0", nodes: [], edges: [], cochanges: [] }],
    [
      "repo.stats",
      {
        schemaVersion: "1.0",
        nodes: [],
        edges: [],
        cochanges: [],
        repo: { name: "x" },
      },
    ],
    [
      "repo.stats.languages",
      {
        schemaVersion: "1.0",
        nodes: [],
        edges: [],
        cochanges: [],
        repo: { name: "x", stats: { files: 1, loc: 1, commits: 1 } },
      },
    ],
  ])("refuses a document missing %s", (_field, document) => {
    const result = checkVersion(document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("malformed");
  });

  it.each(["next", "1garbage", "1.x", "1", "v1.0", "1.0.0"])(
    "refuses the unreadable version %s on an otherwise valid document",
    (schemaVersion) => {
      // The document is complete apart from the version, so nothing but the
      // version parser can reject it. That matters: `parseInt` reads a
      // *prefix*, so "1garbage" and "1.x" both came back as 1 and sailed
      // through the compatibility gate as if they were "1.0".
      const result = checkVersion({ ...loadSyntheticFixture(), schemaVersion });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("malformed");
    },
  );

  it("refuses a document whose nodes are not nodes", () => {
    const document = loadSyntheticFixture();
    const result = checkVersion({ ...document, nodes: [null] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed");
      expect(result.failure.detail).toContain("node at index 0");
    }
  });

  it("refuses a document whose edges are not edges", () => {
    const document = loadSyntheticFixture();
    const result = checkVersion({
      ...document,
      edges: [{ source: "a", target: "b" }, 7],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain("edge at index 1");
  });
});

describe("loader — failures the viewer must name", () => {
  it("reports a 404 rather than rendering an empty map", async () => {
    const result = await loadAnalysis(() =>
      Promise.resolve(jsonResponse(null, 404)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unreachable");
      expect(result.failure.detail).toContain("404");
    }
  });

  it("reports a network failure", async () => {
    const result = await loadAnalysis(() =>
      Promise.reject(new Error("offline")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unreachable");
      expect(result.failure.detail).toContain("offline");
    }
  });

  it("reports a body that is not JSON", async () => {
    const result = await loadAnalysis(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as unknown as Response),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("malformed");
  });
});
