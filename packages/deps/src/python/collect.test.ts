import { describe, expect, it } from "vitest";

import {
  collectPythonImports,
  isPythonPath,
  type PythonImport,
} from "./collect.js";

const importsOf = async (source: string): Promise<readonly PythonImport[]> =>
  (await collectPythonImports(source)).imports;

describe("isPythonPath", () => {
  it("claims .py and nothing else", () => {
    expect(isPythonPath("a/b.py")).toBe(true);
    expect(isPythonPath("A/B.PY")).toBe(true);
    // .pyi stubs are resolution targets, never sources: a stub next to its
    // module states the same imports twice (D3).
    expect(isPythonPath("a/b.pyi")).toBe(false);
    expect(isPythonPath("a/b.pyc")).toBe(false);
    expect(isPythonPath("a/b.ts")).toBe(false);
  });
});

describe("collectPythonImports", () => {
  it("reads a plain import, one entry per comma-separated module", async () => {
    expect(await importsOf("import a.b.c, d\n")).toEqual([
      { level: 0, module: ["a", "b", "c"], names: [] },
      { level: 0, module: ["d"], names: [] },
    ]);
  });

  it("sees through an alias", async () => {
    expect(await importsOf("import a.b as ab\n")).toEqual([
      { level: 0, module: ["a", "b"], names: [] },
    ]);
    expect(await importsOf("from a import b as c\n")).toEqual([
      { level: 0, module: ["a"], names: ["b"] },
    ]);
  });

  it("counts the dots of a relative import", async () => {
    expect(await importsOf("from . import x\n")).toEqual([
      { level: 1, module: [], names: ["x"] },
    ]);
    expect(await importsOf("from ..pkg.sub import y\n")).toEqual([
      { level: 2, module: ["pkg", "sub"], names: ["y"] },
    ]);
  });

  it("keeps every name of a parenthesised import", async () => {
    expect(await importsOf("from pkg.mod import (one, two)\n")).toEqual([
      { level: 0, module: ["pkg", "mod"], names: ["one", "two"] },
    ]);
  });

  it("reads a wildcard as the module alone", async () => {
    expect(await importsOf("from pkg import *\n")).toEqual([
      { level: 0, module: ["pkg"], names: [] },
    ]);
  });

  it("reads a __future__ import, which the grammar gives its own node type", async () => {
    expect(await importsOf("from __future__ import annotations\n")).toEqual([
      { level: 0, module: ["__future__"], names: ["annotations"] },
    ]);
  });

  it("finds imports nested inside functions and conditionals", async () => {
    const source = [
      "def load():",
      "    import pkg.lazy",
      "",
      "if True:",
      "    from . import late",
      "",
    ].join("\n");

    expect(await importsOf(source)).toEqual([
      { level: 0, module: ["pkg", "lazy"], names: [] },
      { level: 1, module: [], names: ["late"] },
    ]);
  });

  it("reports a syntax error instead of throwing (AC-4)", async () => {
    const result = await collectPythonImports("import ok\ndef f( :\n  ][\n");

    expect(result.parseFailed).toBe(true);
    expect(result.imports).toEqual([]);
  });

  it("treats an empty file as parsed and importing nothing", async () => {
    expect(await collectPythonImports("")).toEqual({
      imports: [],
      parseFailed: false,
    });
  });
});
