// @gitnebula/contract — the analysis.json schema and shared pipeline types.
// This package is the only interface between modules (AD-1) and is
// environment-neutral: no `node:` imports, no DOM (AD-11) — both the Node
// pipeline and the browser bundle consume it.

/**
 * Scaffold seam from story 1.1: every other package imports this to prove its
 * AD-2 dependency edge resolves. Kept deliberately — the stories that give
 * those packages real contract imports drop it there, one at a time.
 */
export const packageName = "@gitnebula/contract";

/**
 * Major `schemaVersion` this build understands. The Viewer compares a loaded
 * document against it and shows the FR-6 error screen on mismatch (AD-12).
 * A bump is a breaking change: its own story, plus an ADR (AD-9).
 */
export const SUPPORTED_SCHEMA_MAJOR = 1;

export { default as analysisSchema } from "./analysis.schema.json" with { type: "json" };

export type {
  AnalysisDocument,
  AnalysisEdge,
  AnalysisNode,
  CochangePair,
  Layer,
  NodeKind,
  RepoMetadata,
  RepoStats,
} from "./generated/analysis.js";

export type {
  AnalyzerWarning,
  Config,
  DepsResult,
  GitResult,
  NodeHistory,
  ScanResult,
  ScannedNode,
} from "./pipeline.js";

export { formatValidationErrors, validateAnalysis } from "./validate.js";
export type { ValidationError, ValidationResult } from "./validate.js";
