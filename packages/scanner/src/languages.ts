// Language detection by extension, and the language-share computation that
// feeds `RepoStats.languages`.

/**
 * Language name a file with no recognized extension is counted under. AC-5:
 * unknown-language files still count towards LOC and stats, so their lines
 * need a bucket — otherwise the shares could not sum to 1.
 */
export const UNKNOWN_LANGUAGE = "unknown";

/**
 * Extension to language name. Extensions are compared lowercased and include
 * the dot. A handful of extension-less filenames that are unmistakably code
 * (`Makefile`, `Dockerfile`) are handled by {@link detectLanguage} directly.
 */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".m": "objective-c",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".lua": "lua",
  ".pl": "perl",
  ".r": "r",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".styl": "stylus",
  ".html": "html",
  ".htm": "html",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".ps1": "powershell",
  ".bat": "batch",
  ".json": "json",
  ".jsonc": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".cfg": "ini",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".rst": "restructuredtext",
  ".txt": "text",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".proto": "protobuf",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".dockerfile": "dockerfile",
};

/**
 * Languages that serialize *data* rather than express behaviour. Small ones
 * are configuration a reader recognizes (`package.json`, a CI workflow) and
 * belong on the map; enormous ones are generated blobs, which is what
 * {@link isDataLanguage} exists to let the scanner notice.
 *
 * Markup and prose (`markdown`, `html`, `text`) are deliberately absent: a
 * long document is written by a person and is part of what a repository is.
 *
 * Every name here is one {@link detectLanguage} can actually produce. `.csv`
 * and `.tsv` carry no entry in {@link LANGUAGE_BY_EXTENSION}, so they detect
 * as {@link UNKNOWN_LANGUAGE} and are out of reach of this rule; adding them
 * would change `stats.languages` for every repository, which is a wider
 * change than the defect asks for.
 */
const DATA_LANGUAGES: ReadonlySet<string> = new Set([
  "json",
  "yaml",
  "toml",
  "ini",
  "xml",
]);

/** Whether a language, as {@link detectLanguage} names it, serializes data. */
export function isDataLanguage(language: string): boolean {
  return DATA_LANGUAGES.has(language);
}

/** Extension-less filenames worth naming; compared case-sensitively. */
const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  Makefile: "make",
  makefile: "make",
  GNUmakefile: "make",
  Dockerfile: "dockerfile",
  Jenkinsfile: "groovy",
};

/**
 * Detects the language of one repository-relative POSIX path. Never fails:
 * anything unrecognized is {@link UNKNOWN_LANGUAGE}.
 */
export function detectLanguage(relativePath: string): string {
  const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);

  const byName = LANGUAGE_BY_FILENAME[fileName];
  if (byName !== undefined) return byName;

  // `.gitignore` is a dotfile, not an extension-less name with extension
  // `gitignore` — only a dot that is not the first character starts one.
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return UNKNOWN_LANGUAGE;

  const extension = fileName.slice(dot).toLowerCase();
  // `Dockerfile.prod` and friends: the *first* segment carries the meaning.
  if (LANGUAGE_BY_EXTENSION[extension] === undefined) {
    const base = fileName.slice(0, fileName.indexOf("."));
    const byBaseName = LANGUAGE_BY_FILENAME[base];
    if (byBaseName !== undefined) return byBaseName;
  }

  return LANGUAGE_BY_EXTENSION[extension] ?? UNKNOWN_LANGUAGE;
}

/**
 * Turns per-language line totals into the contract's share map: language name
 * to share of analyzed lines, in 0..1 (`RepoStats.languages`). Shares sum to
 * 1 within floating-point error; a repository with no analyzed lines yields an
 * empty map, because there is no total to take a share of.
 *
 * Keys are emitted in sorted order so two runs serialize identically (AD-4).
 */
export function computeLanguageShares(
  locByLanguage: Readonly<Record<string, number>>,
): Record<string, number> {
  const total = Object.values(locByLanguage).reduce((sum, loc) => sum + loc, 0);
  if (total === 0) return {};

  const shares: Record<string, number> = {};
  for (const language of Object.keys(locByLanguage).sort()) {
    const loc = locByLanguage[language] ?? 0;
    if (loc > 0) shares[language] = loc / total;
  }
  return shares;
}
