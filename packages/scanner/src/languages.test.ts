import { describe, expect, it } from "vitest";

import {
  computeLanguageShares,
  detectLanguage,
  UNKNOWN_LANGUAGE,
} from "./languages.js";

describe("detectLanguage", () => {
  it.each([
    ["src/main.ts", "typescript"],
    ["src/app.tsx", "typescript"],
    ["src/main.mjs", "javascript"],
    ["core/service.py", "python"],
    ["cmd/main.go", "go"],
    ["styles/app.scss", "scss"],
    ["index.html", "html"],
    ["config/settings.yaml", "yaml"],
    ["README.md", "markdown"],
    ["infra/main.tf", "terraform"],
    ["Makefile", "make"],
    ["Dockerfile", "dockerfile"],
    ["deploy/Dockerfile.prod", "dockerfile"],
  ])("detects %s as %s", (path, language) => {
    expect(detectLanguage(path)).toBe(language);
  });

  it("is case-insensitive on the extension", () => {
    expect(detectLanguage("src/Main.TS")).toBe("typescript");
  });

  it.each(["data/records.unknownext", "LICENSE", "bin/tool", ".gitignore"])(
    "falls back to unknown for %s",
    (path) => {
      expect(detectLanguage(path)).toBe(UNKNOWN_LANGUAGE);
    },
  );
});

describe("computeLanguageShares (AC-5)", () => {
  it("returns shares of analyzed lines that sum to 1", () => {
    const shares = computeLanguageShares({ typescript: 30, python: 10 });

    expect(shares).toEqual({ python: 0.25, typescript: 0.75 });
    expect(
      Object.values(shares).reduce((sum, share) => sum + share, 0),
    ).toBeCloseTo(1, 10);
  });

  it("emits keys in sorted order so two runs serialize identically", () => {
    const shares = computeLanguageShares({ typescript: 1, css: 1, python: 1 });

    expect(Object.keys(shares)).toEqual(["css", "python", "typescript"]);
  });

  it("drops languages contributing no lines", () => {
    expect(computeLanguageShares({ typescript: 10, markdown: 0 })).toEqual({
      typescript: 1,
    });
  });

  it("returns an empty map when there is nothing to take a share of", () => {
    expect(computeLanguageShares({})).toEqual({});
    expect(computeLanguageShares({ typescript: 0 })).toEqual({});
  });
});
