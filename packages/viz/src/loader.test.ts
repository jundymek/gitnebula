import { SUPPORTED_SCHEMA_MAJOR } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import { ANALYSIS_URL, checkVersion, loadAnalysis } from "./loader.js";
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

  it("refuses a version whose major is not a number", () => {
    const result = checkVersion({ schemaVersion: "next" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("unsupported-version");
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
