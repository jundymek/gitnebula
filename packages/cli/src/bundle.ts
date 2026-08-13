// FR-23 / ADR-0004: the static bundle. `gitnebula build` produces a directory
// containing exactly two files —
//
//     index.html      the self-contained Viewer: JS and CSS inlined, system
//                     fonts, zero external requests (AD-8)
//     analysis.json   the sibling the Viewer fetches (AD-12)
//
// — and nothing else, because "nothing else" is what makes it droppable onto
// GitHub Pages with no build step on the other side.
//
// The Viewer is not built here. AC-5 keeps `pnpm build` as the only build
// entry; this module copies what that produced and refuses, by name, when it
// has not.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { DEFAULT_OUTPUT_FILENAME } from "./emit.js";
import { StageError } from "./errors.js";

/** The stage name this module aborts under (AD-7). */
export const BUNDLE_STAGE = "bundle";

/**
 * Where the bundle lands when `-o` is not given. Named rather than `dist/`:
 * the command runs inside the user's own repository, where `dist/` very
 * probably means something already.
 */
export const DEFAULT_BUNDLE_DIR = "gitnebula-bundle";

/**
 * ADR-0004's budget for the Viewer assets, data excluded. Two megabytes
 * gzipped is roughly thirty times what the Viewer currently costs; it is a
 * ceiling against a webfont or an inlined fixture creeping in, not a target to
 * approach.
 */
export const VIEWER_GZIP_BUDGET_BYTES = 2 * 1024 * 1024;

/** Exactly what a finished bundle directory contains (AC-1). */
export const BUNDLE_CONTENTS: readonly string[] = [
  DEFAULT_OUTPUT_FILENAME,
  "index.html",
];

export interface ViewerSize {
  /** Every file measured, largest first, with its gzipped size. */
  readonly files: readonly {
    readonly name: string;
    readonly gzipped: number;
  }[];
  readonly gzipped: number;
  readonly budget: number;
  readonly withinBudget: boolean;
}

/**
 * Measures the Viewer's assets the way a static host serves them: gzipped, per
 * file, summed. `analysis.json` is excluded — ADR-0004's budget is about the
 * viewer, and the data has its own bound (ADR-0005).
 *
 * Level 9 is deliberate: it is what a CDN or `gzip_static` serves, so the
 * number matches what a reader would measure themselves.
 */
export function measureViewer(distDir: string): ViewerSize {
  const files = readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== DEFAULT_OUTPUT_FILENAME)
    .map((entry) => ({
      name: entry.name,
      gzipped: gzipSync(readFileSync(join(distDir, entry.name)), { level: 9 })
        .byteLength,
    }))
    .sort((a, b) => b.gzipped - a.gzipped);

  const gzipped = files.reduce((total, file) => total + file.gzipped, 0);
  return {
    files,
    gzipped,
    budget: VIEWER_GZIP_BUDGET_BYTES,
    withinBudget: gzipped <= VIEWER_GZIP_BUDGET_BYTES,
  };
}

/** `59174` → `57.8 KB`. Printed next to the budget, so the number is readable. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** The one line AC-2 asks CI to print. */
export function describeViewerSize(size: ViewerSize): string {
  return `viewer assets: ${formatBytes(size.gzipped)} gzipped of ${formatBytes(size.budget)} budget (${((size.gzipped / size.budget) * 100).toFixed(1)}%)`;
}

/**
 * Is the `analysis.json` already sitting in the output directory current for
 * this checkout?
 *
 * "Fresh" is defined against the repository's HEAD commit rather than a
 * wall-clock age: a file written after the commit it describes was made
 * describes that commit, whether that was a minute or a month ago. This is the
 * case the CI recipe (story 4.2) hits — a job that has just regenerated the
 * JSON should not pay for the analysis twice — and it is checkable offline.
 *
 * Uncommitted working-tree edits are deliberately NOT considered: a file the
 * user has not committed is not in the map's history, and making the answer
 * depend on dirty state would make it unstable. `--force` is the escape hatch,
 * and the decision is always printed.
 */
export function isAnalysisFresh(
  analysisPath: string,
  repoRoot: string,
): boolean {
  let writtenAt: number;
  try {
    writtenAt = statSync(analysisPath).mtimeMs;
  } catch {
    return false;
  }

  const committedAt = headCommittedAt(repoRoot);
  if (committedAt === null) return false;
  return writtenAt >= committedAt;
}

/** HEAD's commit instant in ms, or null for a repository with no commits. */
function headCommittedAt(repoRoot: string): number | null {
  try {
    const raw = execFileSync("git", ["log", "-1", "--format=%cI"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Copies the built Viewer into `outDir` and checks the result is the two-file
 * bundle ADR-0004 specifies.
 *
 * The whole dist is copied rather than `index.html` alone, so that a Viewer
 * that stops being self-contained is caught here instead of shipping as a
 * bundle with a dangling `<script src>`. The assertion below is what turns
 * that into a failure.
 *
 * @throws {StageError} stage `bundle` when the result is not exactly
 * `index.html` + `analysis.json`.
 */
export function assembleBundle(vizDist: string, outDir: string): void {
  cpSync(vizDist, outDir, { recursive: true });

  const written = readdirSync(outDir).sort();
  const expected = [...BUNDLE_CONTENTS].sort();
  if (written.join("\n") !== expected.join("\n")) {
    throw new StageError(
      BUNDLE_STAGE,
      `the bundle directory holds ${written.join(", ")} — a bundle is exactly ${expected.join(" + ")}`,
      `empty ${outDir} and re-run, or report this if the Viewer build stopped producing a single self-contained index.html (ADR-0004)`,
    );
  }
}

/** Creates the output directory, failing in AD-7's shape rather than raw. */
export function prepareBundleDir(outDir: string): void {
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    throw new StageError(
      BUNDLE_STAGE,
      `cannot create ${outDir}`,
      "check the parent directory exists and is writable, or pass a different -o",
      { underlying: error },
    );
  }
}

/** The AD-7 abort for `build` with no Viewer to copy. */
export function missingViewerError(): StageError {
  return new StageError(
    BUNDLE_STAGE,
    "the viewer has not been built",
    "run `pnpm build`, then re-run `gitnebula build` — the bundle is a copy of the built viewer, never a build of it",
  );
}
