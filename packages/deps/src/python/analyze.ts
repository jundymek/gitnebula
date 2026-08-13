// The Python half of the deps stage: universe files in, resolved file pairs
// out. It records into the *same* warning counter and returns the same
// `FilePair` shape as the TS half, so both languages meet in one aggregation,
// one sort and one output path (AC-5).
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FilePair } from "../edges.js";
import type { WarningCounter } from "../warnings.js";
import {
  collectPythonImports,
  isPythonPath,
  type PythonImport,
} from "./collect.js";
import { createPythonResolver } from "./resolve.js";

export interface PythonSource {
  readonly id: string;
  readonly path: string;
}

export interface PythonAnalysisInput {
  /** Absolute repo root the universe paths are relative to. */
  readonly root: string;
  /** Every file in the closed universe, as `path -> node id` (AD-13). */
  readonly idByPath: ReadonlyMap<string, string>;
  /** Shared with the TS half: one set of counters for the whole stage (AD-7). */
  readonly warnings: WarningCounter;
  /** Called once per file processed, for the stage's progress line. */
  readonly onFileDone?: () => void;
}

/** The `.py` files of the universe, in the order they will be processed. */
export function pythonSourcesOf(
  nodes: readonly {
    readonly kind: string;
    readonly id: string;
    readonly path: string;
  }[],
): PythonSource[] {
  return nodes
    .filter((node) => node.kind === "file" && isPythonPath(node.path))
    .map((node) => ({ id: node.id, path: node.path }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `from ..pkg import x` printed back the way it was written, for a warning. */
function describeImport(imported: PythonImport): string {
  const dots = ".".repeat(imported.level);
  const module = imported.module.join(".");
  const head = `${dots}${module}`;
  return imported.names.length === 0
    ? `import ${head}`
    : `from ${head} import ${imported.names.join(", ")}`;
}

/**
 * Resolves every import of every Python file in the universe.
 *
 * The classification mirrors the TS side's, in Python's terms:
 * - a target inside the universe is an edge;
 * - an **absolute** miss is `external-import` — stdlib and site-packages both
 *   look exactly like this and neither is ever a node in the repo (AC-3);
 * - a **relative** miss is `unresolved-import`: relative imports can only ever
 *   name a file in this repo, so a miss is a genuine failure to resolve;
 * - a file that does not parse contributes no edges and one warning (AC-4).
 */
export async function analyzePythonSources(
  sources: readonly PythonSource[],
  input: PythonAnalysisInput,
): Promise<FilePair[]> {
  const { root, idByPath, warnings, onFileDone } = input;
  if (sources.length === 0) return [];

  const resolver = createPythonResolver(idByPath.keys());

  const pairs: FilePair[] = [];

  for (const source of sources) {
    let text: string;
    try {
      text = await readFile(path.join(root, source.path), "utf8");
    } catch {
      warnings.record("unparsable-file", source.path);
      onFileDone?.();
      continue;
    }

    const { imports, parseFailed } = await collectPythonImports(text);
    if (parseFailed) {
      warnings.record("unparsable-file", source.path);
      onFileDone?.();
      continue;
    }

    for (const imported of imports) {
      const example = `${describeImport(imported)} in ${source.path}`;
      const targets = new Set<string>();

      const resolveModule = (module: readonly string[]): string | undefined =>
        imported.level === 0
          ? resolver.resolveAbsolute(module)
          : resolver.resolveRelative(source.path, imported.level, module);

      // `from pkg import a, b`: each name may itself be a submodule. A name
      // that is not one is a symbol, and then the module is the dependency.
      let symbolImported = imported.names.length === 0;
      for (const name of imported.names) {
        const submodule = resolveModule([...imported.module, name]);
        if (submodule === undefined) symbolImported = true;
        else targets.add(submodule);
      }
      if (symbolImported) {
        const moduleTarget = resolveModule(imported.module);
        if (moduleTarget !== undefined) targets.add(moduleTarget);
      }

      if (targets.size === 0) {
        warnings.record(
          imported.level === 0 ? "external-import" : "unresolved-import",
          example,
        );
        continue;
      }
      for (const target of targets) {
        const targetId = idByPath.get(target);
        // Every target came out of the universe index, so this lookup cannot
        // miss; the guard keeps the types honest rather than guarding a case.
        if (targetId !== undefined)
          pairs.push({ source: source.id, target: targetId });
      }
    }

    onFileDone?.();
  }

  return pairs;
}
