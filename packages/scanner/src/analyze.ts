// The scanner's single entry point (AD-3).

import { join } from "node:path";

import type { Config, ScanResult, ScannedNode } from "@gitnebula/contract";

import { compileExcludes } from "./excludes.js";
import { compileLayerRules } from "./layers.js";
import {
  computeLanguageShares,
  detectLanguage,
  isDataLanguage,
} from "./languages.js";
import { deriveModules } from "./modules.js";
import { WarningCollector } from "./warnings.js";
import { collectFiles, countLoc } from "./walk.js";

/**
 * What the scanner needs beyond the resolved `Config`: where the repository
 * is. It is not in `Config` because node paths are repository-relative and the
 * root is a property of the run, not of the analysis — putting it in the
 * contract would make every consumer carry it.
 */
export interface ScanInput {
  /** Absolute path to the repository root. */
  readonly root: string;
}

/** Fire-and-forget progress callback (AD-3). */
export type ScanProgress = (done: number, total: number) => void;

/**
 * Lines above which a *data* document is treated as a generated blob and left
 * out of the analysed universe.
 *
 * The default excludes already drop machine-written files that are "enormous
 * and say nothing about architecture" — lockfiles by name, test snapshots
 * because on excalidraw they would decide their module's layer on their own.
 * A generated fixture is the same category with an unpredictable name, so it
 * is caught by shape instead: only a data language (never source, however
 * long), and only far beyond the size a person maintains by hand.
 *
 * 5,000 is calibrated on this repository, where the gap is unambiguous: the
 * largest hand-maintained data file is `analysis.schema.json` at 229 lines and
 * the largest source file is 1,694, while the generated performance fixture is
 * 40,655 — one file that held 12.8% of the drawn file area and flipped its
 * module's layer to `test`. Nothing is hidden silently: every drop is a
 * counted `data-blob` warning naming the path, which cli prints.
 */
export const DATA_BLOB_LOC_THRESHOLD = 5_000;

/** Node ids sort by code unit, never by locale — a locale is not determinism. */
function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Walks the repository at `input.root`, honoring `config.excludes`, and
 * returns the closed universe every later stage works from (AD-13): one node
 * per surviving file plus the modules derived from them, with LOC, language
 * and layer resolved.
 *
 * Reads the tree and nothing else — no config file, no environment, no clock,
 * no network (AD-3, AD-4, AD-8). Per-file failures are counted warnings, never
 * throws (AD-7).
 */
export async function analyze(
  input: ScanInput,
  config: Config,
  onProgress?: ScanProgress,
): Promise<ScanResult> {
  const warnings = new WarningCollector();
  const isExcluded = compileExcludes(config.excludes);
  const resolveLayer = compileLayerRules(config.layers);

  const paths = await collectFiles(input.root, isExcluded, warnings);

  const files: {
    path: string;
    loc: number;
    layer: ReturnType<typeof resolveLayer>;
  }[] = [];
  const locByLanguage: Record<string, number> = {};
  let totalLoc = 0;

  for (const [index, path] of paths.entries()) {
    const result = await countLoc(join(input.root, path));
    if (result.unreadable) warnings.add("unreadable-file", path);
    else if (result.binary) warnings.add("binary-file", path);

    const language = detectLanguage(path);

    // A generated data blob leaves the universe the way an excluded path does
    // — before anything downstream can see it — so nothing is told to trust a
    // node that is not there. Unlike a binary file, which is kept at 0 LOC
    // because its line count is meaningless rather than misleading, this one
    // has a true and enormous line count that is not a measure of
    // architecture.
    if (isDataLanguage(language) && result.loc > DATA_BLOB_LOC_THRESHOLD) {
      warnings.add("data-blob", path);
      onProgress?.(index + 1, paths.length);
      continue;
    }

    // Binary and unreadable files stay in the node set at 0 LOC: dropping them
    // would open a hole in the universe deps and githist are told to trust.
    files.push({ path, loc: result.loc, layer: resolveLayer(path) });

    locByLanguage[language] = (locByLanguage[language] ?? 0) + result.loc;
    totalLoc += result.loc;

    onProgress?.(index + 1, paths.length);
  }

  const { modules, parentByFile } = deriveModules(files);

  const nodes: ScannedNode[] = [
    ...modules.map((module): ScannedNode => ({
      id: module.id,
      kind: "module",
      parent: null,
      path: module.path,
      layer: module.layer,
      loc: module.loc,
    })),
    ...files.map((file): ScannedNode => ({
      id: file.path,
      kind: "file",
      parent: parentByFile.get(file.path) ?? null,
      path: file.path,
      layer: file.layer,
      loc: file.loc,
    })),
  ].sort(byId);

  return {
    nodes,
    stats: {
      files: files.length,
      loc: totalLoc,
      languages: computeLanguageShares(locByLanguage),
    },
    warnings: warnings.toArray(),
  };
}
