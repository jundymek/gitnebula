// AC-2 (the grammar loads from the package's own source tree, addressed via
// `import.meta.url`) and AC-7 (what that costs). Kept in its own file so the
// measurement is taken in a cold process: vitest isolates test files, and a
// second `Parser.init()` in the same worker measures nothing.
import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectPythonImports } from "./collect.js";
import { grammarPath, loadPythonParser } from "./parser.js";

/** AC-7 feeds the SM-1 60 s budget; over this, the spec wants it flagged. */
const INIT_BUDGET_MS = 2000;

describe("grammar loading (AC-2)", () => {
  it("resolves the .wasm next to the package source, not through a bundler", async () => {
    expect(path.basename(grammarPath)).toBe("tree-sitter-python.wasm");
    expect(grammarPath.split(path.sep).slice(-3).join("/")).toBe(
      "deps/assets/tree-sitter-python.wasm",
    );
    await expect(access(grammarPath)).resolves.toBeUndefined();
  });

  it("initialises the runtime and the grammar inside the AC-7 budget", async () => {
    const started = performance.now();
    const { language } = await loadPythonParser();
    const elapsed = performance.now() - started;

    // Recorded in docs/dev/epic-3/3.1-deps-python/PERFORMANCE.md.
    console.log(
      `web-tree-sitter init + grammar load: ${elapsed.toFixed(1)} ms`,
    );
    expect(language.abiVersion).toBeGreaterThanOrEqual(14);
    expect(elapsed).toBeLessThan(INIT_BUDGET_MS);
  });

  it("parses with the loaded grammar", async () => {
    const { imports, parseFailed } = await collectPythonImports(
      "from pkg import mod\n",
    );

    expect(parseFailed).toBe(false);
    expect(imports).toEqual([{ level: 0, module: ["pkg"], names: ["mod"] }]);
  });
});
