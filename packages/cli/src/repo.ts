// Repository metadata the contract requires but no analyzer produces:
// `repo.name`, `repo.remoteUrl` and `repo.defaultBranch`.
//
// It lives here because cli is the only composer (AD-2) and is exempt from
// AD-4's clock/RNG ban; giving githist a second job would mean widening a
// contract type as a side effect of this story, which CLAUDE.md forbids.
//
// This is also the pipeline's preflight: a target that is not a git
// repository fails here, before any analyzer starts, in AD-7's shape.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { basename } from "node:path";

import { StageError } from "./errors.js";

/** The stage name this module aborts under (AD-7). */
export const REPO_STAGE = "repo";

export interface RepoInfo {
  /** Absolute path of the working tree root — the root every analyzer receives. */
  readonly root: string;
  /** Repository name, from the remote when there is one, else the directory. */
  readonly name: string;
  /** Origin remote URL, or null when the repository has no remote. */
  readonly remoteUrl: string | null;
  readonly defaultBranch: string;
}

/** Last-resort branch name when the repository has no HEAD to read (empty repo). */
const FALLBACK_BRANCH = "main";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Runs git and returns null instead of throwing — for genuinely optional facts. */
function gitOrNull(cwd: string, args: readonly string[]): string | null {
  try {
    const output = git(cwd, args);
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the repository at `target`.
 *
 * @throws {StageError} stage `repo` when the path is not a git repository, or
 * when git is not on PATH.
 */
export function resolveRepo(target: string): RepoInfo {
  const root = resolveRoot(target);
  const remoteUrl = gitOrNull(root, ["remote", "get-url", "origin"]);

  return {
    root,
    name: repoName(root, remoteUrl),
    remoteUrl,
    defaultBranch: resolveDefaultBranch(root),
  };
}

function resolveRoot(target: string): string {
  // Checked before spawning git, because a missing `cwd` and a missing `git`
  // both surface as ENOENT from `execFileSync` — and telling someone who
  // mistyped a path to install git is worse than saying nothing.
  let stats;
  try {
    stats = statSync(target);
  } catch (error) {
    throw new StageError(
      REPO_STAGE,
      `${target} does not exist`,
      "check the path, or run gitnebula with no argument to analyze the current directory",
      { underlying: error },
    );
  }
  if (!stats.isDirectory()) {
    throw new StageError(
      REPO_STAGE,
      `${target} is not a directory`,
      "pass the path of a git repository, not of a file inside one",
    );
  }

  try {
    return git(target, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StageError(
        REPO_STAGE,
        "git is not available on PATH",
        "install git, or add it to PATH — gitnebula reads history straight from the repository",
        { underlying: error },
      );
    }
    throw new StageError(
      REPO_STAGE,
      `${target} is not a git repository`,
      "run gitnebula inside a git repository, or pass the path to one",
      { underlying: error },
    );
  }
}

/**
 * The default branch as the remote advertises it, falling back to the checked
 * out branch. A detached HEAD reports `HEAD`, which is not a branch name.
 */
function resolveDefaultBranch(root: string): string {
  const remoteHead = gitOrNull(root, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remoteHead !== null) {
    return remoteHead.startsWith("origin/")
      ? remoteHead.slice("origin/".length)
      : remoteHead;
  }

  const current = gitOrNull(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current !== null && current !== "HEAD") return current;

  // Detached HEAD or an unborn branch: read what HEAD points at textually,
  // which survives both cases and is what `git init -b` wrote.
  const symbolic = gitOrNull(root, ["symbolic-ref", "--short", "HEAD"]);
  return symbolic ?? FALLBACK_BRANCH;
}

/**
 * `git@host:owner/name.git` and `https://host/owner/name.git` both reduce to
 * `name`; a repository with no remote is named after its directory.
 */
function repoName(root: string, remoteUrl: string | null): string {
  if (remoteUrl !== null) {
    const withoutTrailingSlash = remoteUrl.replace(/\/+$/, "");
    const lastSegment = withoutTrailingSlash.split(/[/:]/).pop() ?? "";
    const name = lastSegment.replace(/\.git$/, "");
    if (name.length > 0) return name;
  }
  return basename(root);
}
