import { describe, expect, it } from "vitest";

import { collectSpecifiers, isTsJsPath } from "./collect.js";

const collect = (source: string, fileName = "/repo/a.ts"): string[] => {
  const result = collectSpecifiers(fileName, source);
  expect(result.parseFailed).toBe(false);
  return [...result.specifiers];
};

describe("isTsJsPath", () => {
  it("claims every TS and JS extension, and nothing else", () => {
    for (const claimed of [
      "a.ts",
      "a.tsx",
      "a.mts",
      "a.cts",
      "a.d.ts",
      "a.js",
      "a.jsx",
      "a.mjs",
      "a.cjs",
    ]) {
      expect(isTsJsPath(claimed), claimed).toBe(true);
    }
    for (const other of ["a.py", "a.json", "a.css", "a.tsx.snap", "ts"]) {
      expect(isTsJsPath(other), other).toBe(false);
    }
  });
});

describe("collectSpecifiers", () => {
  it("collects every specifier form named by AC-1", () => {
    expect(
      collect(`
        import a from "./a";
        import { b } from "./b";
        import type { c } from "./c";
        import * as d from "./d";
        import "./side-effect";
        export * from "./e";
        export { f } from "./f";
        import g = require("./g");
        const h = await import("./h");
        const i = require("./i");
      `),
    ).toEqual([
      "./a",
      "./b",
      "./c",
      "./d",
      "./side-effect",
      "./e",
      "./f",
      "./g",
      "./h",
      "./i",
    ]);
  });

  it("finds imports nested inside expressions and blocks", () => {
    expect(
      collect(`
        export const load = async () => {
          if (Boolean(1)) {
            const { a } = await import("./deep");
            return a;
          }
          return require("./fallback");
        };
      `),
    ).toEqual(["./deep", "./fallback"]);
  });

  it("keeps duplicates for the edge builder to deduplicate", () => {
    expect(
      collect(`
        import { a } from "./same";
        import type { B } from "./same";
      `),
    ).toEqual(["./same", "./same"]);
  });

  it("ignores computed specifiers — there is no import string to resolve", () => {
    expect(
      collect(`
        const name = process.env.PLUGIN;
        const plugin = require(name);
        const other = await import(\`./\${name}\`);
      `),
    ).toEqual([]);
  });

  it("does not mistake a local require-alike for CommonJS", () => {
    expect(
      collect(`
        const loader = { require: (x) => x };
        loader.require("./not-an-import");
      `),
    ).toEqual([]);
  });

  it("parses TSX only when the file claims that extension", () => {
    const tsx = `export const view = () => <div className="x" />;`;
    expect(collectSpecifiers("/repo/view.tsx", tsx).parseFailed).toBe(false);
    // The same text as .ts is a syntax error — which is what makes the
    // extension-driven ScriptKind worth having.
    expect(collectSpecifiers("/repo/view.ts", tsx).parseFailed).toBe(true);
  });

  it("reports a syntax error and yields no specifiers (AC-4)", () => {
    const result = collectSpecifiers(
      "/repo/broken.ts",
      `import { real } from "./real";\nexport const broken = ( => {\n  ][\n`,
    );
    expect(result.parseFailed).toBe(true);
    expect(result.specifiers).toEqual([]);
  });

  it("treats a type error as parseable — only syntax stops the file", () => {
    // `parseFailed` must not react to semantics: this file is well-formed and
    // its import is a real edge, however wrong the types are.
    const result = collectSpecifiers(
      "/repo/typed.ts",
      `import { n } from "./n";\nexport const wrong: number = "not a number" + n;\n`,
    );
    expect(result.parseFailed).toBe(false);
    expect(result.specifiers).toEqual(["./n"]);
  });
});
