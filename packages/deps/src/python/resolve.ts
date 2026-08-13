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
/**
 * Stub extensions. A `.pyi` is never parsed as a source — it would state the
 * same imports its module already states — but it is a real target: a
 * stubs-only distribution has nothing else to point at. Modules always win over
 * stubs of the same name, which is also what a type checker does.
 */
const PYI = ".pyi";
const INIT_PYI = "__init__.pyi";

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
 *
 * Package markers alone are not enough, though. A PEP 420 namespace package has
 * no `__init__.py` at all — `src/acme/tools.py` is imported as `acme.tools` and
 * nothing on disk says so — so the two conventional layout directories are
 * source roots whenever they hold Python at all. Adding a root only ever adds
 * candidates to the index; `.py` still beats `.pyi` and the shortest root still
 * wins a tie, so this cannot change an answer that already resolved.
 */
const CONVENTIONAL_ROOTS = ["src", "lib"] as const;

function sourceRootsOf(pythonFiles: readonly string[]): string[] {
  const isPackageMarker = (file: string): boolean =>
    [INIT, INIT_PYI].some((name) => file === name || file.endsWith(`/${name}`));

  const packageDirs = new Set(
    pythonFiles.filter(isPackageMarker).map((file) => dirOf(file)),
  );

  const roots = new Set<string>([""]);
  for (const dir of packageDirs) {
    if (dir === "") continue;
    const parent = dirOf(dir);
    if (!packageDirs.has(parent)) roots.add(parent);
  }
  for (const file of pythonFiles) {
    // The `src`/`lib` segment of this file's path, if it has one: a namespace
    // package needs its layout directory named as a root, and no marker file
    // will ever say which.
    const segments = dirOf(file).split("/");
    for (const [index, segment] of segments.entries()) {
      if ((CONVENTIONAL_ROOTS as readonly string[]).includes(segment)) {
        roots.add(segments.slice(0, index + 1).join("/"));
      }
    }
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
  const stubFiles = [...files].filter((file) => file.endsWith(PYI)).sort();
  // A stub package (`__init__.pyi`) marks a package just as a module does, so
  // the root detection sees both kinds.
  const sourceRoots = sourceRootsOf([...pythonFiles, ...stubFiles].sort());

  /** The dotted module a root-relative path names, or "" for the root itself. */
  const dottedOf = (inRoot: string): string => {
    for (const marker of [INIT, INIT_PYI]) {
      if (inRoot === marker) return "";
      if (inRoot.endsWith(`/${marker}`))
        return inRoot
          .slice(0, -(marker.length + 1))
          .split("/")
          .join(".");
    }
    const extension = inRoot.endsWith(PY) ? PY : PYI;
    return inRoot.slice(0, -extension.length).split("/").join(".");
  };

  const byDotted = new Map<string, string>();
  // Modules first, stubs second: a `.py` always wins over a `.pyi` of the same
  // dotted name, whichever root each came from.
  for (const group of [pythonFiles, stubFiles]) {
    for (const root of sourceRoots) {
      const prefix = root === "" ? "" : `${root}/`;
      for (const file of group) {
        if (!file.startsWith(prefix)) continue;
        const inRoot = file.slice(prefix.length);
        if (inRoot === "") continue;
        const dotted = dottedOf(inRoot);
        if (dotted !== "" && !byDotted.has(dotted)) byDotted.set(dotted, file);
      }
    }
  }

  /** A directory + module segments -> the file that is that module. */
  const resolveUnder = (
    base: string,
    module: readonly string[],
  ): string | undefined => {
    const target = module.reduce((acc, segment) => join(acc, segment), base);
    const candidates =
      module.length === 0
        ? // `from . import x` with the dots alone: the package itself.
          [join(target, INIT), join(target, INIT_PYI)]
        : [
            `${target}${PY}`,
            join(target, INIT),
            `${target}${PYI}`,
            join(target, INIT_PYI),
          ];
    return candidates.find((candidate) => files.has(candidate));
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
