import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * AC-6 / AD-5, enforced here rather than by a lint plugin.
 *
 * The rule is "chrome talks only to the GraphEngine interface": no canvas, no
 * 2D context, no simulation, and no reaching past `engine/index.ts` into the
 * engine's internals. A lint boundary plugin would express the import half of
 * that but not the "never touch a context" half, and it would be a dependency
 * for one rule — so the check is a test, which also fails loudly in CI and can
 * name the offending line.
 *
 * The mirror rule holds too: the engine must not import chrome.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..");
const chromeDir = here;
const engineDir = join(srcDir, "engine");

/** Things chrome may not name, and why. */
const FORBIDDEN: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /getContext\s*\(/, reason: "acquires a rendering context" },
  { pattern: /CanvasRenderingContext2D/, reason: "names the 2D context type" },
  { pattern: /HTMLCanvasElement/, reason: "names the canvas element type" },
  { pattern: /\bOffscreenCanvas\b/, reason: "names an offscreen canvas" },
  { pattern: /from\s+"d3-force"/, reason: "reaches the simulation library" },
  {
    pattern: /from\s+"\.\.\/engine\/(?!index\.js")/,
    reason: "imports an engine internal instead of the barrel",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

const chromeFiles = sourceFiles(chromeDir).filter(
  (file) => !file.endsWith(".test.ts"),
);

describe("AD-5 boundary — chrome never touches the canvas", () => {
  it("has chrome files to check at all", () => {
    // Guard against the check silently passing because the glob went empty.
    expect(chromeFiles.length).toBeGreaterThan(3);
  });

  it.each(chromeFiles)("%s stays behind the GraphEngine interface", (file) => {
    const source = readFileSync(file, "utf8");
    const offences = FORBIDDEN.filter(({ pattern }) =>
      pattern.test(source),
    ).map(({ reason }) => reason);
    expect(offences).toEqual([]);
  });

  it("keeps the dependency one-way: the engine never imports chrome", () => {
    const engineFiles = sourceFiles(engineDir).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    for (const file of engineFiles) {
      expect(readFileSync(file, "utf8")).not.toMatch(/from\s+"[^"]*chrome\//);
    }
  });

  it("keeps canvas and simulation access inside the engine implementation", () => {
    const engineFiles = sourceFiles(engineDir).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    const withD3 = engineFiles.filter((file) =>
      /from\s+"d3-force"/.test(readFileSync(file, "utf8")),
    );
    // One module owns the simulation; if this grows, the seam is leaking.
    expect(withD3.map((file) => file.replace(`${engineDir}/`, ""))).toEqual([
      "layout.ts",
    ]);
  });
});
