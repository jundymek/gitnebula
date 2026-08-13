// Language stage 2: import specifier -> a file on disk. This is the whole
// reason ADR-0001 chose the TypeScript compiler API over a syntax-level
// parser: `paths` aliases, `baseUrl`, implicit `index.ts` and `.js`-to-`.ts`
// specifier rewriting are resolution behaviour, not syntax.
import path from "node:path";

import ts from "typescript";

/**
 * Resolution options for a repo that ships no tsconfig.json (AC-7), and the
 * second-chance options for a specifier the repo's own config rejects (D3).
 * Deliberately permissive: `Bundler` accepts extensionless relative imports,
 * implicit `index` files and non-relative specifiers alike. It can never widen
 * the graph — every result is still filtered against the ScanResult universe
 * (AD-13).
 */
const PERMISSIVE_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  resolveJsonModule: true,
};

export interface Resolution {
  /** Absolute path of the file the specifier names. */
  readonly fileName: string;
  /** True when resolution landed in a node_modules package. */
  readonly external: boolean;
}

export interface Resolver {
  resolve(specifier: string, containingFile: string): Resolution | undefined;
  /**
   * Whether the repo's own `paths` mapping claims this specifier. A bare
   * specifier that resolves nowhere is normally a package, but one the repo
   * aliased to its own source is a genuine miss — and FR-11 counts the rate of
   * genuine misses.
   */
  isPathAliased(specifier: string, containingFile: string): boolean;
}

/** `paths` patterns hold at most one `*`, matched as a prefix/suffix pair. */
function patternMatches(pattern: string, specifier: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  );
}

/** Caching `ts.ModuleResolutionHost` — the same paths are probed constantly. */
function createHost(): ts.ModuleResolutionHost {
  const fileExists = new Map<string, boolean>();
  const contents = new Map<string, string | undefined>();

  return {
    fileExists(fileName) {
      const cached = fileExists.get(fileName);
      if (cached !== undefined) return cached;
      const exists = ts.sys.fileExists(fileName);
      fileExists.set(fileName, exists);
      return exists;
    },
    readFile(fileName) {
      if (contents.has(fileName)) return contents.get(fileName);
      const text = ts.sys.readFile(fileName);
      contents.set(fileName, text);
      return text;
    },
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
}

/**
 * Resolves against the tsconfig.json nearest to each file, walking up no
 * further than the repo root (a monorepo has one per package, and the nearest
 * one is the one that compiles the file). Malformed or missing config falls
 * back to the permissive options rather than failing the stage (AD-7).
 */
export function createResolver(root: string): Resolver {
  const host = createHost();
  const normalizedRoot = path.resolve(root);

  const configPathByDirectory = new Map<string, string | undefined>();
  const optionsByConfigPath = new Map<string, ts.CompilerOptions>();
  const cacheByOptions = new Map<
    ts.CompilerOptions,
    ts.ModuleResolutionCache
  >();

  const findConfigPath = (directory: string): string | undefined => {
    const cached = configPathByDirectory.get(directory);
    if (cached !== undefined || configPathByDirectory.has(directory))
      return cached;

    const candidate = path.join(directory, "tsconfig.json");
    let found: string | undefined;
    if (host.fileExists(candidate)) {
      found = candidate;
    } else {
      const parent = path.dirname(directory);
      // Stop at the repo root and at the filesystem root: a tsconfig above the
      // repo is not this repo's business.
      found =
        directory === normalizedRoot || parent === directory
          ? undefined
          : findConfigPath(parent);
    }
    configPathByDirectory.set(directory, found);
    return found;
  };

  const optionsFor = (configPath: string): ts.CompilerOptions => {
    const cached = optionsByConfigPath.get(configPath);
    if (cached !== undefined) return cached;

    const read = ts.readConfigFile(configPath, (file) => host.readFile(file));
    const parsed = ts.parseJsonConfigFileContent(
      read.config ?? {},
      ts.sys,
      path.dirname(configPath),
    );
    // `allowJs` is forced on: this stage resolves, never emits, and a repo
    // that excludes JS from its build still has JS files in the scan universe.
    const options: ts.CompilerOptions = read.error
      ? PERMISSIVE_OPTIONS
      : { ...parsed.options, allowJs: true };
    optionsByConfigPath.set(configPath, options);
    return options;
  };

  const cacheFor = (options: ts.CompilerOptions): ts.ModuleResolutionCache => {
    const cached = cacheByOptions.get(options);
    if (cached !== undefined) return cached;
    const cache = ts.createModuleResolutionCache(
      normalizedRoot,
      (fileName) =>
        host.useCaseSensitiveFileNames === true
          ? fileName
          : fileName.toLowerCase(),
      options,
    );
    cacheByOptions.set(options, cache);
    return cache;
  };

  const resolveWith = (
    specifier: string,
    containingFile: string,
    options: ts.CompilerOptions,
  ): Resolution | undefined => {
    const { resolvedModule } = ts.resolveModuleName(
      specifier,
      containingFile,
      options,
      host,
      cacheFor(options),
    );
    if (resolvedModule === undefined) return undefined;
    return {
      fileName: path.normalize(resolvedModule.resolvedFileName),
      external:
        resolvedModule.isExternalLibraryImport === true ||
        resolvedModule.resolvedFileName.includes("/node_modules/"),
    };
  };

  const optionsForFile = (containingFile: string): ts.CompilerOptions => {
    const configPath = findConfigPath(path.dirname(containingFile));
    return configPath === undefined
      ? PERMISSIVE_OPTIONS
      : optionsFor(configPath);
  };

  return {
    isPathAliased(specifier, containingFile) {
      const { paths } = optionsForFile(containingFile);
      return (
        paths !== undefined &&
        Object.keys(paths).some((pattern) => patternMatches(pattern, specifier))
      );
    },

    resolve(specifier, containingFile) {
      const repoOptions = optionsForFile(containingFile);

      const resolved = resolveWith(specifier, containingFile, repoOptions);
      if (resolved !== undefined) return resolved;
      // Second chance under permissive options (D3): a NodeNext package
      // rejecting an extensionless specifier, or a sibling package whose own
      // tsconfig we did not find, should not cost a real edge.
      return repoOptions === PERMISSIVE_OPTIONS
        ? undefined
        : resolveWith(specifier, containingFile, PERMISSIVE_OPTIONS);
    },
  };
}
