import { describe, expect, it } from "vitest";

import { compileLayerRules, dominantLayer, LAYER_RULES } from "./layers.js";

describe("LAYER_RULES (AC-2)", () => {
  it("is an ordered data structure, not a function", () => {
    expect(Array.isArray(LAYER_RULES)).toBe(true);
    for (const rule of LAYER_RULES) {
      expect(typeof rule.glob).toBe("string");
      expect(["backend", "frontend", "infra", "test", "other"]).toContain(
        rule.layer,
      );
    }
  });

  it("places every test rule before every non-test rule", () => {
    const lastTest = LAYER_RULES.map((rule) => rule.layer).lastIndexOf("test");
    const firstNonTest = LAYER_RULES.findIndex((rule) => rule.layer !== "test");

    expect(firstNonTest).toBeGreaterThan(lastTest);
  });
});

describe("compileLayerRules", () => {
  const resolve = compileLayerRules();

  it.each([
    ["src/service.py", "backend"],
    ["src/app.tsx", "frontend"],
    ["src/styles/main.css", "frontend"],
    ["web/api.ts", "frontend"],
    ["server/api.ts", "backend"],
    ["tests/test_thing.py", "test"],
    ["src/thing.test.ts", "test"],
    ["frontend/widget.spec.tsx", "test"],
    [".github/workflows/ci.yml", "infra"],
    ["deploy/Dockerfile", "infra"],
    ["infra/main.tf", "infra"],
    ["README.md", "other"],
    ["docs/brief.md", "other"],
    ["data/records.unknownext", "other"],
  ])("resolves %s to %s", (path, layer) => {
    expect(resolve(path)).toBe(layer);
  });

  it("returns other for a path no rule matches", () => {
    expect(resolve("weird")).toBe("other");
  });

  it("prepends config overrides so user globs win over the default table", () => {
    const withOverride = compileLayerRules({ "src/**": "infra" });

    expect(withOverride("src/service.py")).toBe("infra");
    // ...including over test detection, which the default table puts first
    // (ADR-0002: user rules win).
    expect(withOverride("src/thing.test.ts")).toBe("infra");
    // ...and only where they match.
    expect(withOverride("web/api.ts")).toBe("frontend");
  });

  it("applies overrides in insertion order, first match winning", () => {
    const resolveOrdered = compileLayerRules({
      "src/api/**": "backend",
      "src/**": "frontend",
    });

    expect(resolveOrdered("src/api/thing.ts")).toBe("backend");
    expect(resolveOrdered("src/view.ts")).toBe("frontend");
  });
});

describe("dominantLayer (ADR-0002)", () => {
  it("picks the layer with the most lines", () => {
    expect(dominantLayer({ backend: 10, frontend: 3 })).toBe("backend");
    expect(dominantLayer({ backend: 3, frontend: 10 })).toBe("frontend");
  });

  it("breaks ties on a fixed order rather than on iteration order", () => {
    expect(dominantLayer({ frontend: 5, backend: 5 })).toBe("backend");
    expect(dominantLayer({ backend: 5, frontend: 5 })).toBe("backend");
    expect(dominantLayer({ test: 5, infra: 5 })).toBe("infra");
  });

  it("falls back to other when there are no lines to be dominant with", () => {
    expect(dominantLayer({})).toBe("other");
    expect(dominantLayer({ backend: 0, frontend: 0 })).toBe("other");
  });
});
