// The web-tree-sitter loader (ADR-0001, AD-11). One grammar, loaded once per
// process from a file next to this package's source and resolved via
// `import.meta.url`, so the same code path works in source mode and inside the
// tsup bundle whose prepack copies the asset (AD-11).
//
// No network, ever: the `.wasm` is a committed package asset, not a download
// (AD-8). See `scripts/build-grammar.sh` for how it is produced.
import { fileURLToPath } from "node:url";

import { Language, Parser } from "web-tree-sitter";

/** Absolute path of the committed grammar, resolved relative to this module. */
export const grammarPath = fileURLToPath(
  new URL("../../assets/tree-sitter-python.wasm", import.meta.url),
);

export interface LoadedParser {
  readonly parser: Parser;
  readonly language: Language;
}

let loading: Promise<LoadedParser> | undefined;

/**
 * Loads the runtime and the grammar once and hands the same parser to every
 * caller. `Parser.init()` compiles the tree-sitter runtime WASM and is the
 * expensive half; AC-7 measures the pair together, since a caller cannot have
 * one without the other.
 */
export async function loadPythonParser(): Promise<LoadedParser> {
  loading ??= (async (): Promise<LoadedParser> => {
    await Parser.init();
    const language = await Language.load(grammarPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return { parser, language };
  })();
  return loading;
}

/**
 * Drops the memoised parser. Only tests need this — measuring initialisation
 * (AC-7) requires an uninitialised process, and one test must be able to run
 * after another.
 */
export function resetPythonParserForTests(): void {
  loading = undefined;
}
