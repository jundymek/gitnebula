// The seam between the pipeline and the three analyzers (AD-2: cli is the
// only composer). Each analyzer exposes AD-3's single entry
// `analyze(input, config, onProgress?)`.
//
// All three analyzers are merged and imported directly. While 2.1/2.2/2.3 were
// open PRs this module carried a detection that substituted inert results for
// whichever package was still the story-1.1 scaffold; it is gone, and AC-5's
// end-to-end suite runs against the real thing.
//
// The input shape is a package-local wrapper carrying the absolute repo root,
// identical across deps and githist by agreement with 2.2 and 2.3:
// `ScannedNode.path` is repo-relative, and putting a root on the contract's
// `Config` would be a contract change — never a side effect of another story.
import type {
  Config,
  DepsResult,
  GitResult,
  ScanResult,
} from "@gitnebula/contract";
import { analyze as depsAnalyze } from "@gitnebula/deps";
import { analyze as githistAnalyze } from "@gitnebula/githist";
import {
  analyze as scannerAnalyze,
  DEFAULT_EXCLUDES,
} from "@gitnebula/scanner";

import type { OnProgress } from "./progress.js";

/** What scanner needs: the absolute root its `ScannedNode.path`s are relative to. */
export interface ScanInput {
  readonly root: string;
}

/** What deps and githist need: the root plus the closed universe (AD-13). */
export interface UniverseInput extends ScanInput {
  readonly scan: ScanResult;
}

/**
 * scanner's default exclude list is *data it owns* and *cli resolves*
 * (AD-3, ADR-0002) — cli never invents its own list.
 */
export const defaultExcludes: readonly string[] = DEFAULT_EXCLUDES;

export function scan(
  input: ScanInput,
  config: Config,
  onProgress?: OnProgress,
): Promise<ScanResult> {
  return scannerAnalyze(input, config, onProgress);
}

export function deps(
  input: UniverseInput,
  config: Config,
  onProgress?: OnProgress,
): Promise<DepsResult> {
  return depsAnalyze(input, config, onProgress);
}

export function githist(
  input: UniverseInput,
  config: Config,
  onProgress?: OnProgress,
): Promise<GitResult> {
  return githistAnalyze(input, config, onProgress);
}
