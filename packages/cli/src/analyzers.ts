// The seam between the pipeline and the three analyzers (AD-2: cli is the
// only composer). Each analyzer exposes AD-3's single entry
// `analyze(input, config, onProgress?)`.
//
// TEMPORARY — story 2.4 runs while 2.3 (githist) is still an open PR. Until
// its story merges into the epic branch that package is the story-1.1 scaffold
// stub, which has no `analyze`. This module detects that and substitutes an
// inert result so the pipeline is testable end to end. The detection
// disappears with the last story: by the time 2.4 opens its PR all three are
// wired for real (AC-5) and `stubbedAnalyzers` is empty.
//
// scanner (2.1) and deps (2.2) are merged and imported directly.
//
// The input shapes below are confirmed by 2.1, 2.2 and 2.3: a package-local
// wrapper carrying the absolute repo root, because `ScannedNode.path` is
// repo-relative and putting a root on the contract's `Config` would be a
// contract change — never a side effect of another story.
import type {
  Config,
  DepsResult,
  GitResult,
  ScanResult,
} from "@gitnebula/contract";
import { analyze as depsAnalyze } from "@gitnebula/deps";
import * as githistModule from "@gitnebula/githist";
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

type Analyze<Input, Result> = (
  input: Input,
  config: Config,
  onProgress?: OnProgress,
) => Promise<Result>;

function optionalExport<T>(module: object, name: string): T | undefined {
  return (module as unknown as Record<string, unknown>)[name] as T | undefined;
}

const githistAnalyze = optionalExport<Analyze<UniverseInput, GitResult>>(
  githistModule,
  "analyze",
);

/**
 * scanner's default exclude list is *data it owns* and *cli resolves*
 * (AD-3, ADR-0002) — cli never invents its own list.
 */
export const defaultExcludes: readonly string[] = DEFAULT_EXCLUDES;

/**
 * Analyzers still running as inert stubs, in pipeline order. The entry point
 * prints this, so a stubbed run can never be mistaken for a real one.
 */
export const stubbedAnalyzers: readonly string[] = [
  githistAnalyze === undefined ? "githist" : null,
].filter((name): name is string => name !== null);

const emptyGit: GitResult = {
  history: {},
  cochanges: [],
  commits: 0,
  lastCommitAt: null,
  warnings: [],
};

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
  if (githistAnalyze === undefined) return Promise.resolve(emptyGit);
  return githistAnalyze(input, config, onProgress);
}
