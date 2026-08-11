// Module derivation: which directories become the map's modules, and which
// module each file belongs to.

import type { Layer } from "@gitnebula/contract";

import { dominantLayer } from "./layers.js";

/**
 * Share of analyzable files one directory must exceed before the derivation
 * descends into it — the `src/` pattern, where taking top-level directories
 * literally would yield a single module holding the entire repository (PRD
 * FR-9).
 *
 * The PRD carried 0.8 as an explicit assumption to be validated against the
 * demo repos. It was, and 0.8 missed: excalidraw's `packages/` holds 79.2% of
 * its files, one fifth of a percent under the bar, and the repository drew as
 * a single 228k-line module. 0.5 overshoots the other way — fastapi's `docs/`
 * (58.0%) shatters into thirteen translation modules. 0.7 sits between the two
 * measured boundaries with margin on both sides. Numbers in the story README.
 */
export const DESCENT_THRESHOLD = 0.7;

/** Maximum number of path segments in a module path (PRD FR-9). */
export const MAX_MODULE_DEPTH = 2;

/** The per-file facts module derivation needs. */
export interface FileForDerivation {
  /** Repository-relative POSIX path. */
  readonly path: string;
  readonly loc: number;
  readonly layer: Layer;
}

/** A derived module. `id` and `path` both carry the trailing slash (ADR-0005). */
export interface DerivedModule {
  readonly id: string;
  readonly path: string;
  readonly layer: Layer;
  readonly loc: number;
}

export interface ModuleDerivation {
  readonly modules: readonly DerivedModule[];
  /** File path to owning module id, or `null` for a repository-root file. */
  readonly parentByFile: ReadonlyMap<string, string | null>;
}

/** Directory part of a path, or `""` for a file sitting in the repository root. */
function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** First `depth` segments of a path's directory, or `""` if it has fewer. */
function prefixAtDepth(path: string, depth: number): string {
  const directory = directoryOf(path);
  if (directory === "") return "";
  const segments = directory.split("/");
  if (segments.length < depth) return "";
  return segments.slice(0, depth).join("/");
}

/**
 * Derives modules from the surviving file set.
 *
 * Modules start as the repository's top-level directories. If a single one
 * holds more than {@link DESCENT_THRESHOLD} of the analyzable files, it is
 * replaced by its immediate child directories — plus itself, when it holds
 * files directly, so a repository's entry points (`src/index.ts`) do not fall
 * out of the module structure. Descent repeats while a module still exceeds
 * the threshold, but a module path never grows past {@link MAX_MODULE_DEPTH}
 * segments.
 *
 * Files sitting in the repository root belong to no module: the contract
 * already encodes that as `parent: null` (ADR-0005), and a synthetic root
 * module would draw a module the repository does not have.
 *
 * A module's layer is the dominant layer of its files by LOC (ADR-0002).
 */
export function deriveModules(
  files: readonly FileForDerivation[],
): ModuleDerivation {
  const total = files.length;

  // Prefixes are directory paths without a trailing slash; the slash is added
  // when they become module ids.
  let prefixes = new Set<string>();
  for (const file of files) {
    const top = prefixAtDepth(file.path, 1);
    if (top !== "") prefixes.add(top);
  }

  const countUnder = (prefix: string): number =>
    files.filter((file) => file.path.startsWith(`${prefix}/`)).length;

  for (let depth = 1; depth < MAX_MODULE_DEPTH; depth += 1) {
    // Only one prefix can hold more than 80% of the files, so the first hit is
    // the only hit.
    const dominant = [...prefixes].find(
      (prefix) => total > 0 && countUnder(prefix) / total > DESCENT_THRESHOLD,
    );
    if (dominant === undefined) break;

    const descended = new Set(prefixes);
    descended.delete(dominant);

    for (const file of files) {
      if (!file.path.startsWith(`${dominant}/`)) continue;
      const child = prefixAtDepth(file.path, depth + 1);
      // A file directly inside the dominant directory has no deeper prefix —
      // it keeps the dominant directory itself as its module.
      descended.add(child === "" ? dominant : child);
    }

    prefixes = descended;
  }

  // Longest prefix first: after a descent into `src/`, `src/app/main.ts` must
  // land in `src/app/` rather than in `src/`.
  const ordered = [...prefixes].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
  );

  const parentByFile = new Map<string, string | null>();
  const locByModule = new Map<string, number>();
  const locByModuleAndLayer = new Map<string, Partial<Record<Layer, number>>>();

  for (const file of files) {
    const prefix = ordered.find((candidate) =>
      file.path.startsWith(`${candidate}/`),
    );
    if (prefix === undefined) {
      parentByFile.set(file.path, null);
      continue;
    }

    const id = `${prefix}/`;
    parentByFile.set(file.path, id);
    locByModule.set(id, (locByModule.get(id) ?? 0) + file.loc);

    const byLayer = locByModuleAndLayer.get(id) ?? {};
    byLayer[file.layer] = (byLayer[file.layer] ?? 0) + file.loc;
    locByModuleAndLayer.set(id, byLayer);
  }

  const modules: DerivedModule[] = [...locByModule.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => ({
      id,
      path: id,
      layer: dominantLayer(locByModuleAndLayer.get(id) ?? {}),
      loc: locByModule.get(id) ?? 0,
    }));

  return { modules, parentByFile };
}
