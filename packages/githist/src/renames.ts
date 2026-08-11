// Rename chains, resolved in the one pass AD-13 allows.

import type { RawCommit } from "./git-log.js";

/**
 * Maps a path as some commit knew it to the name it carries at the tip of the
 * analysis window. Built while walking commits newest first, which is the
 * order `git log` already emits.
 */
export class RenameChain {
  /** Historical path to present-day path. Values are already fully resolved. */
  readonly #aliases = new Map<string, string>();

  /** The name `path` carries today, following any renames seen so far. */
  resolve(path: string): string {
    return this.#aliases.get(path) ?? path;
  }

  /**
   * Records the renames of one commit. Call it *after* attributing that
   * commit's changes: within the commit the file is already known by its new
   * name, and only strictly older commits refer to it by the old one.
   */
  observe(commit: RawCommit): void {
    for (const change of commit.changes) {
      if (change.status !== "R" || change.oldPath === undefined) continue;
      // Resolving the new name first is what makes a chain of renames collapse
      // to a single lookup: a -> b -> c stores both a and b pointing at c.
      this.#aliases.set(change.oldPath, this.resolve(change.path));
    }
  }
}

/**
 * A commit reduced to the present-day paths it touched, deduplicated. Ordering
 * follows the commit's own change order so downstream sets stay deterministic.
 */
export function resolvedPaths(commit: RawCommit, chain: RenameChain): string[] {
  const seen = new Set<string>();
  for (const change of commit.changes) {
    seen.add(chain.resolve(change.path));
  }
  return [...seen];
}
