import type { Layer } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import {
  deriveModules,
  DESCENT_THRESHOLD,
  MAX_MODULE_DEPTH,
  type FileForDerivation,
} from "./modules.js";

function file(
  path: string,
  loc = 1,
  layer: Layer = "backend",
): FileForDerivation {
  return { path, loc, layer };
}

/** `count` files under `directory`, so a share can be crafted exactly. */
function filesUnder(directory: string, count: number): FileForDerivation[] {
  return Array.from({ length: count }, (_, index) =>
    file(`${directory}/file${index}.ts`),
  );
}

describe("deriveModules (AC-3)", () => {
  it("uses top-level directories when none dominates", () => {
    const { modules, parentByFile } = deriveModules([
      file("core/a.py"),
      file("core/b.py"),
      file("web/c.ts"),
    ]);

    expect(modules.map((module) => module.id)).toEqual(["core/", "web/"]);
    expect(parentByFile.get("core/a.py")).toBe("core/");
  });

  it("leaves repository-root files without a module", () => {
    const { modules, parentByFile } = deriveModules([
      file("README.md"),
      file("core/a.py"),
    ]);

    expect(parentByFile.get("README.md")).toBeNull();
    expect(modules.map((module) => module.id)).toEqual(["core/"]);
  });

  it("descends when one directory holds more than the threshold", () => {
    // 9 of 10 files (90%) under src/.
    const { modules } = deriveModules([
      ...filesUnder("src/core", 5),
      ...filesUnder("src/web", 4),
      file("docs/readme.md"),
    ]);

    expect(modules.map((module) => module.id)).toEqual([
      "docs/",
      "src/core/",
      "src/web/",
    ]);
  });

  it("does not descend at exactly the threshold", () => {
    // 7 of 10 files is exactly the threshold — the rule is strictly greater.
    const { modules } = deriveModules([
      ...filesUnder("src/core", 7),
      ...filesUnder("docs", 3),
    ]);

    expect(modules.map((module) => module.id)).toEqual(["docs/", "src/"]);
    expect(DESCENT_THRESHOLD).toBe(0.7);
  });

  it("keeps the descended directory as a module for its own direct files", () => {
    const { modules, parentByFile } = deriveModules([
      ...filesUnder("src/core", 9),
      file("src/index.ts"),
    ]);

    expect(modules.map((module) => module.id)).toEqual(["src/", "src/core/"]);
    expect(parentByFile.get("src/index.ts")).toBe("src/");
    expect(parentByFile.get("src/core/file0.ts")).toBe("src/core/");
  });

  it("never produces a module path deeper than the cap", () => {
    const { modules } = deriveModules(filesUnder("src/app/feature", 10));

    expect(modules.map((module) => module.id)).toEqual(["src/app/"]);
    for (const module of modules) {
      expect(
        module.path.replace(/\/$/, "").split("/").length,
      ).toBeLessThanOrEqual(MAX_MODULE_DEPTH);
    }
  });

  it("sums member LOC and takes the dominant layer by LOC", () => {
    const { modules } = deriveModules([
      file("mixed/service.py", 30, "backend"),
      file("mixed/app.tsx", 10, "frontend"),
      file("mixed/style.css", 5, "frontend"),
    ]);

    expect(modules).toEqual([
      { id: "mixed/", path: "mixed/", layer: "backend", loc: 45 },
    ]);
  });

  it("handles an empty file set", () => {
    const { modules, parentByFile } = deriveModules([]);

    expect(modules).toEqual([]);
    expect(parentByFile.size).toBe(0);
  });

  it("sorts modules by id", () => {
    const { modules } = deriveModules([
      file("web/a.ts"),
      file("core/b.py"),
      file("api/c.py"),
    ]);

    expect(modules.map((module) => module.id)).toEqual([
      "api/",
      "core/",
      "web/",
    ]);
  });
});
