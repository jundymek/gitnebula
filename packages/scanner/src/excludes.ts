// Default exclusion globs — *data*, exported for cli to resolve against
// (AD-3). Matching happens only here, with picomatch, and the surviving node
// set is the closed universe every later stage works from (AD-13).

import picomatch from "picomatch";

/**
 * Paths never worth mapping: dependency and virtual-environment trees, build
 * output, VCS metadata, lockfiles, generated or minified artifacts, binary
 * assets, and this repository's own tooling directories.
 *
 * Every entry leads with a globstar so it matches at any depth, including the
 * repository root — picomatch lets a leading globstar match zero directories.
 * Directory entries are matched against the directory itself, which prunes
 * the whole subtree in one test.
 *
 * cli merges `.gitnebula.yml` `exclude:` entries over this list and passes the
 * result as `Config.excludes`; the scanner never reads config itself.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  // Version control and tool metadata
  "**/.git",
  "**/.hg",
  "**/.svn",
  "**/.idea",
  "**/.vscode",
  // Dependencies and virtual environments
  "**/node_modules",
  "**/bower_components",
  "**/vendor",
  "**/.venv",
  "**/venv",
  "**/.tox",
  "**/site-packages",
  // Build output and caches
  "**/dist",
  "**/build",
  "**/out",
  "**/target",
  "**/.next",
  "**/.nuxt",
  "**/.svelte-kit",
  "**/.turbo",
  "**/.cache",
  "**/.pytest_cache",
  "**/.mypy_cache",
  "**/.ruff_cache",
  "**/__pycache__",
  "**/coverage",
  "**/.nyc_output",
  "**/.yarn",
  // Lockfiles — machine-written, enormous, and say nothing about architecture
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/npm-shrinkwrap.json",
  "**/bun.lockb",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/uv.lock",
  "**/Gemfile.lock",
  "**/Cargo.lock",
  "**/composer.lock",
  "**/go.sum",
  // Generated and minified artifacts. Test snapshots are written by the test
  // runner, not by a person: on excalidraw they are three of the four largest
  // files in the repository and would decide its module layers on their own.
  "**/__snapshots__",
  "**/*.snap",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.d.ts",
  "**/*.pyc",
  "**/*.pyo",
  "**/*.class",
  "**/*.o",
  "**/*.tsbuildinfo",
  // Binary assets: images, fonts, media, archives, native artifacts
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.bmp",
  "**/*.tiff",
  "**/*.webp",
  "**/*.avif",
  "**/*.ico",
  "**/*.icns",
  "**/*.svg",
  "**/*.pdf",
  "**/*.psd",
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.otf",
  "**/*.eot",
  "**/*.mp3",
  "**/*.mp4",
  "**/*.wav",
  "**/*.ogg",
  "**/*.webm",
  "**/*.mov",
  "**/*.avi",
  "**/*.zip",
  "**/*.tar",
  "**/*.gz",
  "**/*.bz2",
  "**/*.xz",
  "**/*.7z",
  "**/*.rar",
  "**/*.jar",
  "**/*.wasm",
  "**/*.so",
  "**/*.dylib",
  "**/*.dll",
  "**/*.exe",
  "**/*.bin",
  "**/*.db",
  "**/*.sqlite",
  "**/*.sqlite3",
  // This project's own non-source directories (CLAUDE.md: excluded from the
  // map gitnebula draws of itself)
  "**/_bmad",
  "**/.claude",
];

/** Tests one repository-relative POSIX path against a compiled exclude set. */
export type ExcludeMatcher = (relativePath: string) => boolean;

/**
 * Compiles the exclude globs once, up front. `dot: true` because a great many
 * of the paths worth excluding start with a dot, and picomatch hides those by
 * default.
 */
export function compileExcludes(globs: readonly string[]): ExcludeMatcher {
  const matchers = globs.map((glob) => picomatch(glob, { dot: true }));
  return (relativePath: string) =>
    matchers.some((isMatch) => isMatch(relativePath));
}
