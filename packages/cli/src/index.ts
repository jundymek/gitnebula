// @gitnebula/cli — pipeline orchestration, config, emit, the loopback viewer
// server and URL mode. Published as `gitnebula` (AD-11).
//
// Story 1.1's scaffold exports (`pipelineEdges`, a placeholder `main`) are
// gone: the AD-2 edges they existed to prove are now proven by the pipeline
// importing all three analyzers for real.

export const packageName = "@gitnebula/cli";

export { openBrowser } from "./browser.js";
export { main, run, type RunOptions } from "./cli.js";
export {
  cloneRepository,
  isRemoteTarget,
  type Checkout,
  type CloneOptions,
} from "./clone.js";
export {
  ANALYSIS_URL_PATH,
  DEFAULT_PORT,
  LOOPBACK_ADDRESS,
  awaitShutdown,
  resolveVizDist,
  startServer,
  type RunningServer,
  type ServeOptions,
} from "./serve.js";
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
export {
  BUNDLE_CONTENTS,
  DEFAULT_BUNDLE_DIR,
  VIEWER_GZIP_BUDGET_BYTES,
  assembleBundle,
  describeViewerSize,
  formatBytes,
  measureViewer,
  type ViewerSize,
} from "./bundle.js";
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
