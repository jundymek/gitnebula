// Language stage 1 for Python: source text -> structured imports. The mirror of
// `ts/collect.ts` — it knows nothing about the filesystem, the repo universe or
// edges, and hands `python/resolve.ts` exactly what the language's resolution
// rules need: how many dots, which module, which names.
import { Query, type Node } from "web-tree-sitter";

import { loadPythonParser } from "./parser.js";

/** Extensions this parser claims. `.pyi` stubs are targets, never sources (D3). */
export function isPythonPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".py");
}

/** One import statement, in the terms Python's own resolution rules use. */
export interface PythonImport {
  /**
   * Leading dots: 0 for an absolute import, 1 for `from . import x`, 2 for
   * `from ..pkg import y`.
   */
  readonly level: number;
  /** Dotted module segments; empty for `from . import x`. */
  readonly module: readonly string[];
  /**
   * Names in a `from … import a, b` clause. Each may be a submodule or a
   * symbol — Python only knows which at import time, and so does the resolver.
   * Empty for a plain `import x` and for `import *`.
   */
  readonly names: readonly string[];
}

export interface PythonCollectResult {
  /** Imports in source order, duplicates kept — the edge builder dedupes. */
  readonly imports: readonly PythonImport[];
  /**
   * True when the file did not parse. AD-7: the caller drops the file, counts
   * it and carries on — a broken file never fails the stage (AC-4).
   */
  readonly parseFailed: boolean;
}

/**
 * The three statement forms that name a module. `future_import_statement` is
 * matched too: `from __future__ import annotations` is a real import of a
 * stdlib module, and leaving it out would silently under-count externals.
 */
const IMPORT_QUERY = `
  (import_statement) @import
  (import_from_statement) @from
  (future_import_statement) @future
`;

let query: Query | undefined;

/** Dotted segments of a `dotted_name`, or of the `name` of an alias. */
function dottedSegments(node: Node): string[] {
  const target =
    node.type === "aliased_import" ? node.childForFieldName("name") : node;
  if (target === null) return [];
  return target.namedChildren
    .filter(
      (child): child is Node => child !== null && child.type === "identifier",
    )
    .map((child) => child.text);
}

/** `import a.b, c.d as e` — one entry per comma-separated module. */
function fromImportStatement(node: Node): PythonImport[] {
  return node
    .childrenForFieldName("name")
    .map((child) => dottedSegments(child))
    .filter((module) => module.length > 0)
    .map((module) => ({ level: 0, module, names: [] }));
}

/** `from …` — the module half is `module_name`, the names half is `name`. */
function fromImportFromStatement(node: Node): PythonImport[] {
  const moduleNode = node.childForFieldName("module_name");
  if (moduleNode === null) return [];

  let level = 0;
  let module: string[] = [];
  if (moduleNode.type === "relative_import") {
    // `import_prefix` is the run of dots; the optional `dotted_name` follows.
    const prefix = moduleNode.namedChildren.find(
      (child) => child?.type === "import_prefix",
    );
    level = prefix?.text.length ?? 0;
    const dotted = moduleNode.namedChildren.find(
      (child) => child?.type === "dotted_name",
    );
    module =
      dotted === undefined || dotted === null ? [] : dottedSegments(dotted);
  } else {
    module = dottedSegments(moduleNode);
  }

  // `from pkg import *` has no names: the module itself is the whole import.
  const names = node
    .childrenForFieldName("name")
    .map((child) => dottedSegments(child))
    // A name is a single identifier in practice; join keeps a dotted one whole.
    .map((segments) => segments.join("."))
    .filter((name) => name !== "");

  return [{ level, module, names }];
}

/**
 * `from __future__ import annotations`. The grammar gives this its own node
 * type with the module name baked into the syntax, so the module is spelled
 * out here rather than read off a field.
 */
function fromFutureImportStatement(node: Node): PythonImport {
  const names = node
    .childrenForFieldName("name")
    .map((child) => dottedSegments(child).join("."))
    .filter((name) => name !== "");
  return { level: 0, module: ["__future__"], names };
}

/**
 * Parses one Python file and returns every import it states. Nothing throws: a
 * file with syntax errors comes back as `parseFailed` with no imports, exactly
 * as the TS side reports an unparsable file (AC-4).
 */
export async function collectPythonImports(
  text: string,
): Promise<PythonCollectResult> {
  const { parser, language } = await loadPythonParser();
  query ??= new Query(language, IMPORT_QUERY);

  const tree = parser.parse(text);
  if (tree === null) return { imports: [], parseFailed: true };

  try {
    // tree-sitter always produces a tree; `hasError` is how it reports that the
    // tree contains ERROR/MISSING nodes — the recoverable parser's equivalent
    // of TypeScript's parse diagnostics.
    if (tree.rootNode.hasError) return { imports: [], parseFailed: true };

    const imports: PythonImport[] = [];
    for (const capture of query.captures(tree.rootNode)) {
      const { node, name } = capture;
      if (name === "import") imports.push(...fromImportStatement(node));
      else if (name === "future") imports.push(fromFutureImportStatement(node));
      else imports.push(...fromImportFromStatement(node));
    }
    return { imports, parseFailed: false };
  } finally {
    // The tree owns memory on the WASM heap; a repo-sized run that never
    // released it would grow without bound.
    tree.delete();
  }
}

/** Only tests need this: the query is cached against a language instance. */
export function resetPythonQueryForTests(): void {
  query = undefined;
}
