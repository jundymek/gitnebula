// The one place githist spawns git — its single declared side effect (AD-3).
// Everything downstream of `readGitLog` is pure and testable without a
// repository.

import { spawn } from "node:child_process";

/** A file touched by a commit, as `--name-status` reports it. */
export interface RawChange {
  /** Single-letter status: `A`, `M`, `D`, `R`, `C`, `T`, `U`. */
  readonly status: string;
  /** Path after the change — the new name for a rename or copy. */
  readonly path: string;
  /** Path before the change; present only for renames and copies. */
  readonly oldPath?: string;
}

/** One commit of the analysis window, newest first. */
export interface RawCommit {
  readonly hash: string;
  /** Committer instant, unix seconds (see DECISIONS D2). */
  readonly committedAt: number;
  /** Lowercased committer-recorded author email — the author identity (D4). */
  readonly authorEmail: string;
  readonly changes: readonly RawChange[];
}

// Record and field separators. `git log -z` NUL-terminates every path and the
// header, so NUL cannot delimit commits; 0x1e/0x1f are the ASCII separators
// reserved for exactly this and can never appear in a hash, a unix timestamp
// or an email address. The commit message is deliberately not requested, so
// no user-controlled text reaches the parser.
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const LOG_FORMAT = `%x1e%H%x1f%ct%x1f%ae`;

/** Statuses that carry a second path (rename, copy). */
const TWO_PATH_STATUS = /^[RC]/;

/**
 * The exact argument list handed to git. Exported so the story README and the
 * tests quote one definition rather than two.
 *
 * `--follow` is deliberately absent and is banned by AD-13: it only works for
 * a single path, so following renames with it costs one git process per file
 * (thousands on a real repo) and it cannot observe co-change at all, since a
 * per-file log never shows which files moved together. `-M` gives the same
 * rename information inline, in the one pass this analyzer is allowed.
 *
 * `--no-merges` is deliberately absent too. Merges must stay in the stream
 * because `GitResult.commits` is contractually the repo-wide count and
 * `lastCommitAt` the newest instant in the window — on a merge-based workflow,
 * filtering them would undercount and could report a stale last-changed
 * instant. Their *file* records are another matter: git prints none for a
 * merge, and that is correct, since a merge's content already arrived through
 * the commits being merged. So a merge counts once, repo-wide, and attributes
 * to no node.
 */
export function gitLogArgs(sinceIso: string, untilIso: string): string[] {
  return [
    "log",
    "-M",
    "-z",
    "--name-status",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    `--format=${LOG_FORMAT}`,
  ];
}

/**
 * Parses the raw `git log` stream. Splitting on the record separator is safe
 * for a partial stream: the caller feeds whole output, but the parser is
 * written so a trailing incomplete record is simply the last chunk.
 */
export function parseGitLog(raw: string): RawCommit[] {
  const commits: RawCommit[] = [];

  for (const record of raw.split(RECORD_SEP)) {
    if (record.length === 0) continue;

    // -z NUL-terminates the header and every path, so the last token is the
    // empty string after the final NUL.
    const tokens = record.split("\0");
    const header = tokens[0] ?? "";
    const [hash = "", committedAt = "", authorEmail = ""] =
      header.split(FIELD_SEP);
    if (hash.length === 0) continue;

    const changes: RawChange[] = [];
    let i = 1;
    while (i < tokens.length) {
      // git separates the header from the file list with a newline, which -z
      // leaves glued to the first status token ("\nR100"). Trimming is what
      // makes the first change parse like every other one.
      const status = tokens[i]?.trim();
      if (status === undefined || status.length === 0) {
        i += 1;
        continue;
      }
      if (TWO_PATH_STATUS.test(status)) {
        const oldPath = tokens[i + 1];
        const path = tokens[i + 2];
        if (oldPath !== undefined && path !== undefined && path.length > 0) {
          changes.push({ status: status[0] ?? status, path, oldPath });
        }
        i += 3;
      } else {
        const path = tokens[i + 1];
        if (path !== undefined && path.length > 0) {
          changes.push({ status: status[0] ?? status, path });
        }
        i += 2;
      }
    }

    commits.push({
      hash,
      committedAt: Number.parseInt(committedAt, 10),
      authorEmail: authorEmail.toLowerCase(),
      changes,
    });
  }

  return commits;
}

/** git's message when the repository exists but holds no commits yet (D10). */
const EMPTY_REPO = /does not have any commits yet|unknown revision/i;

/**
 * Runs the single log pass over `[sinceIso, untilIso]` and returns its commits,
 * newest first. A repository with no commits yields an empty list; anything
 * else that fails throws with the cause, for cli to wrap in the AD-7 shape.
 */
export async function readGitLog(
  repoRoot: string,
  sinceIso: string,
  untilIso: string,
): Promise<RawCommit[]> {
  const args = gitLogArgs(sinceIso, untilIso);
  const raw = await run("git", ["-C", repoRoot, ...args]);
  return parseGitLog(raw);
}

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Collected as chunks and joined once: git's output on a large repository
    // is many megabytes, and repeated string concatenation is what makes that
    // slow.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));

    child.on("error", (cause: NodeJS.ErrnoException) => {
      reject(
        new Error(
          cause.code === "ENOENT"
            ? "git executable not found on PATH"
            : `failed to spawn git: ${cause.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
        return;
      }
      if (EMPTY_REPO.test(stderr)) {
        resolve("");
        return;
      }
      reject(
        new Error(
          `git log exited ${code ?? "with a signal"}: ${stderr.trim() || "no output"}`,
        ),
      );
    });
  });
}
