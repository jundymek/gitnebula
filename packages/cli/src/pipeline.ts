// The staged pipeline: repo → config → scan → (deps ∥ githist) →
// assemble + validate → enrich → emit.
//
// Everything the pipeline is not allowed to read for itself arrives as an
// option: the clock, the reporter, the working directory. That is what makes
// FR-7's determinism testable — pin the anchor and two runs differ only in
// `analyzedAt`.
import { isAbsolute, resolve } from "node:path";

import type {
  AnalysisDocument,
  AnalyzerWarning,
  Config,
} from "@gitnebula/contract";

import * as analyzers from "./analyzers.js";
import { assemble } from "./assemble.js";
import { resolveConfig, type CliFlags } from "./config.js";
import { DEFAULT_OUTPUT_FILENAME, emit } from "./emit.js";
import { enrich } from "./enrich.js";
import { StageError } from "./errors.js";
import { createReporter, formatElapsed, type Reporter } from "./progress.js";
import { resolveRepo, type RepoInfo } from "./repo.js";

export interface RunPipelineOptions {
  /** Repository to analyze. Relative paths resolve against `cwd`. */
  readonly target?: string;
  /** Output file. Defaults to `analysis.json` in `cwd`. */
  readonly out?: string;
  /** Directory the command was invoked in; defaults to the process cwd. */
  readonly cwd?: string;
  readonly flags?: CliFlags;
  /**
   * Test-only override for AD-13's window anchor (AC-6). Pinning it is what
   * makes a fixture snapshot stable across days; it never affects
   * `analyzedAt`, which is always the real run start.
   */
  readonly windowAnchor?: string;
  readonly reporter?: Reporter;
  /** Injectable clock. cli is exempt from AD-4's ban; its tests still pin it. */
  readonly now?: () => number;
}

export interface PipelineResult {
  readonly analysis: AnalysisDocument;
  readonly outputPath: string;
  readonly repo: RepoInfo;
  readonly config: Config;
  /** Every analyzer warning, tagged with the stage that reported it (AD-7). */
  readonly warnings: readonly TaggedWarning[];
}

export interface TaggedWarning extends AnalyzerWarning {
  readonly stage: string;
}

export async function runPipeline(
  options: RunPipelineOptions = {},
): Promise<PipelineResult> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => Date.now());
  const reporter = options.reporter ?? createReporter({ now });

  const startedAt = now();
  // The single clock read of the whole run (AD-4): it is both the document's
  // `analyzedAt` and, unless pinned, the window anchor every analyzer measures
  // back from (AD-13).
  const analyzedAt = new Date(startedAt).toISOString();
  const windowAnchor =
    options.windowAnchor === undefined
      ? analyzedAt
      : normalizeAnchor(options.windowAnchor);

  if (analyzers.stubbedAnalyzers.length > 0) {
    reporter.notice(
      `note: running with inert stubs for ${analyzers.stubbedAnalyzers.join(", ")} — their stories have not merged yet.`,
    );
  }

  const repo = await reporter.runStage("repo", async () =>
    resolveRepo(resolve(cwd, options.target ?? ".")),
  );

  const resolution = await reporter.runStage("config", async () =>
    resolveConfig({
      repoRoot: repo.root,
      windowAnchor,
      flags: options.flags,
      defaultExcludes: analyzers.defaultExcludes,
    }),
  );
  for (const notice of resolution.notices) reporter.notice(notice);
  const config = resolution.config;

  const scan = await reporter.runStage("scan", (onProgress) =>
    analyzers.scan({ root: repo.root }, config, onProgress),
  );

  // The two analyzers that consume the scan universe are independent, so they
  // run together; the reporter degrades its within-stage counts to plain lines
  // while both are in flight.
  const universe = { root: repo.root, scan };
  const [deps, git] = await Promise.all([
    reporter.runStage("deps", (onProgress) =>
      analyzers.deps(universe, config, onProgress),
    ),
    reporter.runStage("githist", (onProgress) =>
      analyzers.githist(universe, config, onProgress),
    ),
  ]);

  const assembled = await reporter.runStage("assemble", async () =>
    assemble({ repo, analyzedAt, config, scan, deps, git }),
  );

  const analysis = await reporter.runStage("enrich", () => enrich(assembled));

  const outputPath = resolveOutputPath(cwd, options.out);
  await reporter.runStage("emit", async () => emit(outputPath, analysis));

  const warnings = tagWarnings([
    ["scan", scan.warnings],
    ["deps", deps.warnings],
    ["githist", git.warnings],
  ]);
  for (const warning of warnings) {
    const detail =
      warning.detail === undefined ? "" : ` (e.g. ${warning.detail})`;
    reporter.warn(
      `${warning.stage}: ${warning.code} ×${warning.count}${detail}`,
    );
  }

  reporter.finish(
    `${outputPath} — ${analysis.nodes.length} nodes, ${analysis.edges.length} edges, ${analysis.cochanges.length} co-change pairs in ${formatElapsed(now() - startedAt)}`,
  );

  return { analysis, outputPath, repo, config, warnings };
}

function resolveOutputPath(cwd: string, out: string | undefined): string {
  if (out === undefined) return resolve(cwd, DEFAULT_OUTPUT_FILENAME);
  return isAbsolute(out) ? out : resolve(cwd, out);
}

/**
 * Canonicalizes the test-only anchor so a run pinned to `2026-01-01T00:00:00Z`
 * and one pinned to `2026-01-01T01:00:00+01:00` produce identical bytes.
 */
function normalizeAnchor(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new StageError(
      "config",
      `--window-anchor "${value}" is not an ISO-8601 instant`,
      "pass an instant such as 2026-01-01T00:00:00Z, or drop the flag to use the run start",
    );
  }
  return new Date(parsed).toISOString();
}

function tagWarnings(
  groups: readonly (readonly [string, readonly AnalyzerWarning[]])[],
): readonly TaggedWarning[] {
  return groups.flatMap(([stage, warnings]) =>
    warnings.map((warning) => ({ ...warning, stage })),
  );
}
