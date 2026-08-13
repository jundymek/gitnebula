// The command-line surface. It parses, it validates flag *shapes*, and it
// hands plain values to the pipeline — precedence and semantics live in the
// config resolver (AD-3), not here.
//
// `run` returns an exit code instead of calling `process.exit`, so the failure
// paths are testable without spawning a process.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { Command, CommanderError } from "commander";

import { openBrowser as defaultOpenBrowser } from "./browser.js";
import {
  DEFAULT_BUNDLE_DIR,
  assembleBundle,
  describeViewerSize,
  measureViewer,
  missingViewerError,
  prepareBundleDir,
} from "./bundle.js";
import { cloneRepository, isRemoteTarget, type Checkout } from "./clone.js";
import { DEFAULT_WINDOW_DAYS } from "./config.js";
import { DEFAULT_OUTPUT_FILENAME } from "./emit.js";
import { StageError, describeThrown } from "./errors.js";
import { runPipeline, type RunPipelineOptions } from "./pipeline.js";
import { createReporter, type Reporter } from "./progress.js";
import {
  awaitShutdown,
  missingDistError,
  resolveVizDist,
  startServer,
  type SignalSource,
} from "./serve.js";

/** The stage name flag parsing aborts under (AD-7). */
export const INPUT_STAGE = "input";

export interface RunOptions {
  readonly cwd?: string;
  readonly reporter?: Reporter;
  /** Where usage text and failures go. Defaults to stderr. */
  readonly write?: (chunk: string) => void;
  readonly now?: () => number;
  /** Test seam: what receives the shutdown signals. Defaults to `process`. */
  readonly signals?: SignalSource;
  /** Test seam: the browser hand-off. Defaults to the `open` package. */
  readonly openBrowser?: (url: string) => Promise<void>;
  /** Test seam: the viewer dist to serve. Defaults to the built one (AD-11). */
  readonly vizDist?: string;
  /** Test seam: first port of the scan. Defaults to serve.ts's. */
  readonly port?: number;
  /** Test seam: where URL mode puts its checkout. Defaults to the temp dir. */
  readonly cloneTempDir?: string;
}

interface ParsedFlags {
  readonly out?: string;
  readonly exclude?: string[];
  readonly windowDays?: string;
  readonly hotspotThreshold?: string;
  readonly windowAnchor?: string;
  /** commander's `--no-*` convention: these default to true. */
  readonly serve?: boolean;
  readonly open?: boolean;
}

/**
 * The flags both the default command and `build` take. Declared once: two
 * copies of `--window-days` that drift apart is a bug report about the
 * pipeline behaving differently depending on how it was invoked.
 */
function addAnalysisOptions(command: Command): Command {
  return command
    .option(
      "-e, --exclude <glob>",
      "additional exclusion glob; repeatable, added to the defaults and to .gitnebula.yml",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option("--window-days <days>", "length of the analysis window in days")
    .option(
      "--hotspot-threshold <number>",
      "hot spot cutoff on the normalized churn scale, 0..1",
    )
    .option(
      "--window-anchor <iso>",
      "TEST ONLY — pin the instant the analysis window is measured back from, e.g. 2026-01-01T00:00:00Z. Makes snapshot output stable across days; it never changes analyzedAt.",
    );
}

/**
 * Which command ran and what it parsed.
 *
 * Both commands report through an action handler, and the default command's is
 * not optional: once a subcommand exists, commander reads an operand it does
 * not recognise as an unknown *command* unless the parent has an action of its
 * own. Without it, `gitnebula ./some/repo` becomes a usage error.
 */
interface Invocation {
  readonly kind: "analyze" | "build";
  readonly target: string;
  readonly flags: ParsedFlags;
}

export function createProgram(
  write: (chunk: string) => void,
  onInvoke: (invocation: Invocation) => void = () => {},
): Command {
  const program = new Command();

  addAnalysisOptions(
    program
      .name("gitnebula")
      .description(
        "Turn a git repository into an interactive architecture map. Analyzes the repository and writes analysis.json.",
      )
      .argument(
        "[path|url]",
        "repository to analyze; defaults to the current directory",
        ".",
      )
      .option(
        "-o, --out <path>",
        "where to write analysis.json (default: ./analysis.json)",
      )
      .option(
        "--no-serve",
        "write analysis.json and exit, instead of serving the map on 127.0.0.1",
      )
      .option("--no-open", "serve the map but do not open a browser"),
  )
    .allowExcessArguments(false)
    // Without this, `gitnebula build -o site` writes the bundle to
    // `./gitnebula-bundle` and says nothing: the parent declares `-o` too, and
    // commander hands a shared short flag to the parent, leaving the
    // subcommand's `--out` unset. Positional parsing puts each option with the
    // command it was typed after, which is the only reading a user has in
    // mind. Found by a test asserting where `-o` actually put the files.
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: write,
      writeErr: write,
    })
    .action((target: string, flags: ParsedFlags) => {
      onInvoke({ kind: "analyze", target, flags });
    });

  // FR-23: the static bundle. A subcommand rather than a flag on the default
  // command, because it answers a different question — not "show me this
  // repository" but "give me a directory I can publish".
  addAnalysisOptions(
    program
      .command("build")
      .description(
        `write a static, self-contained bundle — index.html + ${DEFAULT_OUTPUT_FILENAME} — hostable on any static server`,
      )
      .argument(
        "[path|url]",
        "repository to analyze; defaults to the current directory",
        ".",
      )
      .option(
        "-o, --out <dir>",
        `directory to write the bundle into (default: ./${DEFAULT_BUNDLE_DIR})`,
      ),
  ).action((target: string, flags: ParsedFlags) => {
    onInvoke({ kind: "build", target, flags });
  });

  return program;
}

/**
 * Parses `argv` (user arguments, without node and script) and runs the
 * pipeline.
 *
 * @returns the process exit code: 0 on success, 1 on a stage failure, 2 on a
 * usage error.
 */
export async function run(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<number> {
  const write =
    options.write ?? ((chunk: string) => void process.stderr.write(chunk));

  // Written by whichever command's action commander runs during `parse`.
  let parsed: Invocation | null = null;
  const program = createProgram(write, (invocation) => {
    parsed = invocation;
  });

  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` and `--version` come through here as a successful stop.
      return error.exitCode === 0 ? 0 : 2;
    }
    throw error;
  }
  const invocation = parsed as Invocation | null;
  // `--help` on a subcommand can stop the parse without either action having
  // run; there is nothing left to do and nothing went wrong.
  if (invocation === null) return 0;

  const { target, flags } = invocation;
  const bundling = invocation.kind === "build";

  const cwd = options.cwd ?? process.cwd();
  const reporter = options.reporter ?? createReporter();
  let checkout: Checkout | null = null;

  try {
    const windowDays =
      flags.windowDays === undefined
        ? DEFAULT_WINDOW_DAYS
        : positiveInteger("--window-days", flags.windowDays);

    if (isRemoteTarget(target, cwd)) {
      // The one network operation in the system (AD-8). Everything downstream
      // reads the temp checkout and is identical to a local run.
      checkout = await reporter.runStage("clone", async () =>
        cloneRepository(target, {
          // `.gitnebula.yml` lives inside the repository we do not have yet,
          // so the shallow window comes from the flag or the default; a wider
          // window in the file simply sees what the clone fetched.
          windowDays,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.cloneTempDir === undefined
            ? {}
            : { tempDir: options.cloneTempDir }),
        }),
      );
    }

    const repoTarget = checkout === null ? target : checkout.root;

    // Resolved before the analysis, not after it: a `build` that spends a
    // minute analyzing and only then discovers it has no viewer to copy has
    // wasted the minute and told the user nothing they could not have been
    // told first.
    const bundle = bundling ? planBundle(cwd, flags, options) : null;

    const pipelineOptions: RunPipelineOptions = {
      target: repoTarget,
      cwd,
      reporter,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(bundle === null
        ? flags.out === undefined
          ? {}
          : { out: flags.out }
        : { out: bundle.analysisPath }),
      ...(flags.windowAnchor === undefined
        ? {}
        : { windowAnchor: flags.windowAnchor }),
      flags: {
        ...(flags.exclude === undefined ? {} : { excludes: flags.exclude }),
        ...(flags.windowDays === undefined ? {} : { windowDays }),
        ...(flags.hotspotThreshold === undefined
          ? {}
          : {
              hotspotThreshold: unitInterval(
                "--hotspot-threshold",
                flags.hotspotThreshold,
              ),
            }),
      },
    };

    if (bundle !== null) {
      await runPipeline(pipelineOptions);
      assembleBundle(bundle.vizDist, bundle.outDir);

      const size = measureViewer(bundle.outDir);
      // AC-2 wants the number printed, not merely checked. It is printed on
      // the way past whether or not it is over budget; the abort below only
      // decides whether the run continues.
      write(`${describeViewerSize(size)}\n`);
      if (!size.withinBudget) {
        throw new StageError(
          "bundle",
          `the viewer is over ADR-0004's ${size.budget}-byte gzipped budget at ${size.gzipped} bytes`,
          "find what grew — a webfont, an inlined fixture, a new dependency — and take it back out; the budget is a product requirement, not a lint",
        );
      }
      write(
        `bundle written to ${bundle.outDir} — serve it with any static server (e.g. \`npx serve ${bundle.outDir}\`)\n`,
      );
      return 0;
    }

    const result = await runPipeline(pipelineOptions);

    if (flags.serve === false) return 0;
    await serveUntilInterrupted(
      result.outputPath,
      flags.open !== false,
      write,
      options,
    );
    return 0;
  } catch (error) {
    write(`${failureLine(error)}\n`);
    return 1;
  } finally {
    // AC-4: the temp checkout goes away on both paths, including the one where
    // the pipeline threw halfway through.
    checkout?.dispose();
  }
}

interface BundlePlan {
  readonly outDir: string;
  readonly analysisPath: string;
  readonly vizDist: string;
}

/**
 * Decides everything about a `build` run that can be decided before any work
 * happens: where it goes, what it copies, and whether the analysis is needed
 * at all (AC-1).
 *
 * @throws {StageError} stage `bundle` when the viewer has not been built or
 * the output directory cannot be created.
 */
function planBundle(
  cwd: string,
  flags: ParsedFlags,
  options: RunOptions,
): BundlePlan {
  const vizDist = options.vizDist ?? resolveVizDist(import.meta.url);
  // The `existsSync` is not redundant with the resolver: a dist passed in
  // explicitly, or one emptied since the resolver last looked, would otherwise
  // be copied as nothing and surface as "the bundle directory holds
  // analysis.json" — a true statement about the wrong problem.
  if (vizDist === null || !existsSync(join(vizDist, "index.html"))) {
    throw missingViewerError();
  }

  const outDir = resolve(cwd, flags.out ?? DEFAULT_BUNDLE_DIR);
  prepareBundleDir(outDir);
  const analysisPath = join(outDir, DEFAULT_OUTPUT_FILENAME);

  return { outDir, analysisPath, vizDist };
}

/**
 * Serves the map on the loopback interface, opens a browser at it, and blocks
 * until Ctrl+C — the tail of a zero-config `npx gitnebula` (FR-5).
 *
 * @throws {StageError} stage `serve` when the viewer has not been built.
 */
async function serveUntilInterrupted(
  analysisPath: string,
  openInBrowser: boolean,
  write: (chunk: string) => void,
  options: RunOptions,
): Promise<void> {
  const distDir = options.vizDist ?? resolveVizDist(import.meta.url);
  if (distDir === null) throw missingDistError();

  const server = await startServer({
    distDir,
    analysisPath,
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  write(`serving ${server.url} — press Ctrl+C to stop\n`);

  if (openInBrowser) {
    try {
      await (options.openBrowser ?? defaultOpenBrowser)(server.url);
    } catch (error) {
      // A machine with no default browser is not a failed analysis: the URL is
      // already printed and the server is already up.
      write(`  ! could not open a browser (${describeThrown(error)})\n`);
    }
  }

  await awaitShutdown(options.signals ?? process);
  await server.close();
  write("stopped\n");
}

/** Every abort reaches the terminal in AD-7's shape, whatever threw it. */
function failureLine(error: unknown): string {
  if (error instanceof StageError) return error.message;
  return `gitnebula: ${describeThrown(error)} — this is a gitnebula bug, please open an issue`;
}

function positiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new StageError(
      INPUT_STAGE,
      `${flag} expects a whole number of days of at least 1, got "${raw}"`,
      `pass e.g. ${flag} 90`,
    );
  }
  return value;
}

function unitInterval(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new StageError(
      INPUT_STAGE,
      `${flag} expects a number between 0 and 1, got "${raw}"`,
      `pass e.g. ${flag} 0.5`,
    );
  }
  return value;
}

/** Entry used by the binary: run and exit with the resulting code. */
export async function main(argv: readonly string[]): Promise<void> {
  const code = await run(argv, { reporter: createReporter() });
  process.exitCode = code;
}
