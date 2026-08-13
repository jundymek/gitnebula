// Language stage 2 for Python: a structured import -> a node in the scan
// universe, or nothing.
//
// Unlike the TS resolver, this one never touches the filesystem. Python's
// import rules are pure path arithmetic over a package tree, and the scanner's
// closed universe (AD-13) already *is* that tree — resolving against the
// universe is both the cheapest and the most honest answer, because a target
// outside the universe could never have become an edge anyway.
/** A dotted module path resolved to a repo-relative file path, or nothing. */
export interface PythonResolver {
  /** `import a.b.c` / the module half of a `from` — absolute, dots already 0. */
  resolveAbsolute(module: readonly string[]): string | undefined;
  /**
   * `from ..pkg import x`: `level` dots counted from the importing file's own
   * package directory. Returns `undefined` when the dots walk out of the repo.
   */
  resolveRelative(
    fromFile: string,
    level: number,
    module: readonly string[],
  ): string | undefined;
  /** The source roots the absolute index was built from, for diagnostics. */
  readonly sourceRoots: readonly string[];
}

const PY = ".py";
const INIT = "__init__.py";

function dirOf(filePath: string): string {
  const cut = filePath.lastIndexOf("/");
  return cut === -1 ? "" : filePath.slice(0, cut);
}

function join(base: string, tail: string): string {
  return base === "" ? tail : `${base}/${tail}`;
}

/**
 * Where absolute imports are rooted. A repo that keeps its package under
 * `lib/` (streamlit) or `src/` writes `from streamlit.x import y`, not
 * `from lib.streamlit.x import y` — so the roots are the *parents* of every
 * top-level package, not the repo root alone. A package is top-level when its
 * own parent directory is not itself a package.
 *
 * The repo root is always a candidate: a flat repo of loose modules has no
 * `__init__.py` anywhere and still imports its own files by name.
 */
function sourceRootsOf(pythonFiles: readonly string[]): string[] {
  const packageDirs = new Set(
    pythonFiles
      .filter((file) => file.endsWith(`/${INIT}`) || file === INIT)
      .map((file) => dirOf(file)),
  );

  const roots = new Set<string>([""]);
  for (const dir of packageDirs) {
    if (dir === "") continue;
    const parent = dirOf(dir);
    if (!packageDirs.has(parent)) roots.add(parent);
  }
  // Shortest first, then lexicographic: a deterministic order for the
  // first-wins rule below (AD-4).
  return [...roots].sort((a, b) =>
    a.length !== b.length ? a.length - b.length : a < b ? -1 : 1,
  );
}

/**
 * Builds the resolver for one scan universe. The absolute index maps a dotted
 * module path to a repo file for every source root; where two roots claim the
 * same dotted path, the earlier root wins — arbitrary but fixed, and the
 * alternative (an ambiguity warning) would fire on every `src`/`tests` layout.
 */
export function createPythonResolver(
  universeFiles: Iterable<string>,
): PythonResolver {
  const files = new Set<string>(universeFiles);

  const pythonFiles = [...files].filter((file) => file.endsWith(PY)).sort();
  const sourceRoots = sourceRootsOf(pythonFiles);

  const byDotted = new Map<string, string>();
  for (const root of sourceRoots) {
    const prefix = root === "" ? "" : `${root}/`;
    for (const file of pythonFiles) {
      if (!file.startsWith(prefix)) continue;
      const inRoot = file.slice(prefix.length);
      if (inRoot === "") continue;
      const dotted = (
        inRoot === INIT
          ? ""
          : inRoot.endsWith(`/${INIT}`)
            ? inRoot.slice(0, -(INIT.length + 1))
            : inRoot.slice(0, -PY.length)
      )
        .split("/")
        .join(".");
      if (dotted !== "" && !byDotted.has(dotted)) byDotted.set(dotted, file);
    }
  }

  /** A directory + module segments -> the file that is that module. */
  const resolveUnder = (
    base: string,
    module: readonly string[],
  ): string | undefined => {
    const target = module.reduce((acc, segment) => join(acc, segment), base);
    if (module.length === 0) {
      // `from . import x` with the dots alone: the package itself.
      const init = join(target, INIT);
      return files.has(init) ? init : undefined;
    }
    const asModule = `${target}${PY}`;
    if (files.has(asModule)) return asModule;
    const asPackage = join(target, INIT);
    return files.has(asPackage) ? asPackage : undefined;
  };

  return {
    sourceRoots,
    resolveAbsolute(module) {
      return module.length === 0 ? undefined : byDotted.get(module.join("."));
    },
    resolveRelative(fromFile, level, module) {
      // Level 1 is the importing file's own package; each further dot climbs.
      let base = dirOf(fromFile);
      for (let step = 1; step < level; step += 1) {
        if (base === "") return undefined; // walked out of the repo
        base = dirOf(base);
      }
      return resolveUnder(base, module);
    },
  };
}
