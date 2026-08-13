// @gitnebula/cli — pipeline orchestration, config, emit. Published as
// `gitnebula` (AD-11); the local server and URL mode arrive in story 3.2.
//
// Story 1.1's scaffold exports (`pipelineEdges`, a placeholder `main`) are
// gone: the AD-2 edges they existed to prove are now proven by the pipeline
// importing all three analyzers for real.

export const packageName = "@gitnebula/cli";

export { main, run, type RunOptions } from "./cli.js";
export {
  CONFIG_FILENAME,
  DEFAULT_HOTSPOT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  LLM_IGNORED_NOTICE,
  resolveConfig,
  type CliFlags,
  type ConfigResolution,
} from "./config.js";
export { assemble, type AssembleInput } from "./assemble.js";
export { DEFAULT_OUTPUT_FILENAME, emit, serialize } from "./emit.js";
export { enrich } from "./enrich.js";
export { StageError } from "./errors.js";
export {
  runPipeline,
  type PipelineResult,
  type RunPipelineOptions,
  type TaggedWarning,
} from "./pipeline.js";
export {
  createReporter,
  createSilentReporter,
  formatElapsed,
  type OnProgress,
  type Reporter,
} from "./progress.js";
export { resolveRepo, type RepoInfo } from "./repo.js";
