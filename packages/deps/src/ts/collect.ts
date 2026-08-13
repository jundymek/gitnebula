// Language stage 1: source text -> import specifiers. Knows nothing about the
// filesystem, the repo universe or edges, so story 3.1's Python parser slots in
// beside this module rather than inside it.
import ts from "typescript";

/** Extensions this parser claims. `.d.ts` is ordinary source here (D8). */
const TS_JS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export function isTsJsPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return TS_JS_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export interface CollectResult {
  /** Specifiers in source order, duplicates kept — the edge builder dedupes. */
  readonly specifiers: readonly string[];
  /**
   * True when the file did not parse. AD-7: the caller drops the file, counts
   * it, and carries on — a broken file never fails the stage (AC-4).
   */
  readonly parseFailed: boolean;
}

/**
 * `ts.createSourceFile` reports syntax errors on an internal property rather
 * than by throwing. Reading it through a narrow local type keeps the cast
 * honest and the failure mode safe: anything but an array is read as "parsed
 * cleanly", so a future TypeScript release costs us warnings, never a crash
 * (DECISIONS.md D5).
 */
interface SourceFileWithParseDiagnostics {
  readonly parseDiagnostics?: unknown;
}

function hasParseErrors(sourceFile: ts.SourceFile): boolean {
  const { parseDiagnostics } = sourceFile as SourceFileWithParseDiagnostics;
  return Array.isArray(parseDiagnostics) && parseDiagnostics.length > 0;
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function literalSpecifier(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node)
    ? node.text
    : undefined;
}

/**
 * Every specifier form that names a module: static `import`, `export … from`,
 * `import x = require(…)`, dynamic `import()` and CommonJS `require()`. A
 * computed specifier (`require(name)`) names nothing resolvable and is skipped
 * silently — it is not an unresolved import, there is no import string to
 * resolve.
 */
function specifierOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node)) {
    return literalSpecifier(node.moduleSpecifier);
  }
  if (ts.isExportDeclaration(node)) {
    return literalSpecifier(node.moduleSpecifier);
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return literalSpecifier(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node)) {
    const isDynamicImport =
      node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire =
      ts.isIdentifier(node.expression) && node.expression.text === "require";
    if (isDynamicImport || isRequire) {
      return literalSpecifier(node.arguments[0]);
    }
  }
  return undefined;
}

export function collectSpecifiers(
  filePath: string,
  text: string,
): CollectResult {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(filePath),
  );

  if (hasParseErrors(sourceFile)) {
    return { specifiers: [], parseFailed: true };
  }

  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined) specifiers.push(specifier);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return { specifiers, parseFailed: false };
}
