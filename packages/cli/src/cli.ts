// The command-line surface. It parses, it validates flag *shapes*, and it
// hands plain values to the pipeline — precedence and semantics live in the
// config resolver (AD-3), not here.
//
// `run` returns an exit code instead of calling `process.exit`, so the failure
// paths are testable without spawning a process.
import { Command, CommanderError } from "commander";

import { StageError, describeThrown } from "./errors.js";
import { runPipeline, type RunPipelineOptions } from "./pipeline.js";
import { createReporter, type Reporter } from "./progress.js";

/** The stage name flag parsing aborts under (AD-7). */
export const INPUT_STAGE = "input";

export interface RunOptions {
  readonly cwd?: string;
  readonly reporter?: Reporter;
  /** Where usage text and failures go. Defaults to stderr. */
  readonly write?: (chunk: string) => void;
  readonly now?: () => number;
}

interface ParsedFlags {
  readonly out?: string;
  readonly exclude?: string[];
  readonly windowDays?: string;
  readonly hotspotThreshold?: string;
  readonly windowAnchor?: string;
}

/**
 * A remote target is recognised so it can be refused clearly. URL mode is
 * story 3.2 (shallow clone into a temp dir); implementing it here would widen
 * this story's scope and duplicate that one.
 */
const REMOTE_TARGET =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|[\w.-]+\.[a-z]{2,}[/:])/i;

export function createProgram(write: (chunk: string) => void): Command {
  const program = new Command();

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
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: write,
      writeErr: write,
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
  const program = createProgram(write);

  let target: string;
  let flags: ParsedFlags;
  try {
    program.parse([...argv], { from: "user" });
    target = program.processedArgs[0] as string;
    flags = program.opts<ParsedFlags>();
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--help` and `--version` come through here as a successful stop.
      return error.exitCode === 0 ? 0 : 2;
    }
    throw error;
  }

  try {
    if (REMOTE_TARGET.test(target)) {
      throw new StageError(
        INPUT_STAGE,
        `analyzing a remote repository (${target}) is not supported in this release`,
        "clone it locally and run gitnebula in the clone — URL mode arrives with the local server, in story 3.2",
      );
    }

    const pipelineOptions: RunPipelineOptions = {
      target,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.reporter === undefined ? {} : { reporter: options.reporter }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(flags.out === undefined ? {} : { out: flags.out }),
      ...(flags.windowAnchor === undefined
        ? {}
        : { windowAnchor: flags.windowAnchor }),
      flags: {
        ...(flags.exclude === undefined ? {} : { excludes: flags.exclude }),
        ...(flags.windowDays === undefined
          ? {}
          : {
              windowDays: positiveInteger("--window-days", flags.windowDays),
            }),
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

    await runPipeline(pipelineOptions);
    return 0;
  } catch (error) {
    write(`${failureLine(error)}\n`);
    return 1;
  }
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
