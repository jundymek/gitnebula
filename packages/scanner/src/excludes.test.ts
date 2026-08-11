import { describe, expect, it } from "vitest";

import { compileExcludes, DEFAULT_EXCLUDES } from "./excludes.js";

describe("DEFAULT_EXCLUDES (AC-1)", () => {
  const isExcluded = compileExcludes(DEFAULT_EXCLUDES);

  it("is exported as data cli can resolve against", () => {
    expect(Array.isArray(DEFAULT_EXCLUDES)).toBe(true);
    expect(DEFAULT_EXCLUDES.every((glob) => typeof glob === "string")).toBe(
      true,
    );
  });

  it.each([
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".git",
    "_bmad",
    ".claude",
  ])("excludes the %s directory at the repository root", (directory) => {
    expect(isExcluded(directory)).toBe(true);
  });

  it.each([
    "packages/app/node_modules",
    "services/api/.venv",
    "packages/viz/dist",
  ])("excludes %s at any depth", (path) => {
    expect(isExcluded(path)).toBe(true);
  });

  it.each([
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "Cargo.lock",
    "go.sum",
  ])("excludes the lockfile %s", (path) => {
    expect(isExcluded(path)).toBe(true);
  });

  it.each([
    "public/app.min.js",
    "public/app.js.map",
    "docs/screenshot.png",
    "assets/logo.svg",
    "assets/font.woff2",
    "bin/tool.wasm",
    "archive/backup.zip",
  ])("excludes the generated or binary artifact %s", (path) => {
    expect(isExcluded(path)).toBe(true);
  });

  it.each([
    "src/main.ts",
    "src/app.tsx",
    "core/service.py",
    "README.md",
    ".github/workflows/ci.yml",
    "docs/adr/0002-layers.md",
    // Not a lockfile, not a build directory — a source directory that happens
    // to contain one of those words.
    "src/builder/index.ts",
    "src/node_modules_helper.ts",
  ])("keeps %s", (path) => {
    expect(isExcluded(path)).toBe(false);
  });
});

describe("compileExcludes", () => {
  it("excludes nothing for an empty glob list", () => {
    const isExcluded = compileExcludes([]);

    expect(isExcluded("node_modules")).toBe(false);
  });

  it("matches dotted paths, which picomatch hides by default", () => {
    const isExcluded = compileExcludes(["**/.secret"]);

    expect(isExcluded(".secret")).toBe(true);
    expect(isExcluded("nested/.secret")).toBe(true);
  });
});
