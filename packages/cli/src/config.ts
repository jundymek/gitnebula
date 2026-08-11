// AD-3: configuration is resolved exactly once, here. Analyzers receive a
// plain `Config` value and never read a file, an env var or the clock.
//
// Precedence is defaults < `.gitnebula.yml` < CLI flags (FR-4). The default
// exclude list is *data owned by scanner* (ADR-0002) — it is passed in rather
// than imported, so this resolver stays a pure function of its inputs and its
// tests need no analyzer.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Config, Layer } from "@gitnebula/contract";
import { isMap, isScalar, parseDocument, type Document } from "yaml";

import { StageError } from "./errors.js";

/** The config file gitnebula looks for in the repository root (FR-4). */
export const CONFIG_FILENAME = ".gitnebula.yml";

/** Analysis window when nothing overrides it (ADR-0003). */
export const DEFAULT_WINDOW_DAYS = 90;

/** Hot spot cutoff on the normalized churn scale (ADR-0003, mockup). */
export const DEFAULT_HOTSPOT_THRESHOLD = 0.5;

/** The exact notice printed when a config carries the post-MVP `llm` key (AD-10, FR-4). */
export const LLM_IGNORED_NOTICE =
  "note: the `llm` key is parsed but ignored in this release — descriptions are a post-MVP feature, and nothing else about the analysis changes.";

const LAYERS: readonly Layer[] = [
  "backend",
  "frontend",
  "infra",
  "test",
  "other",
];

const KNOWN_KEYS = [
  "excludes",
  "windowDays",
  "layers",
  "hotspotThreshold",
  "llm",
] as const;

/** Values supplied on the command line. Every one of them wins over the file. */
export interface CliFlags {
  /** Repeated `--exclude <glob>`; appended to the resolved exclude list. */
  readonly excludes?: readonly string[];
  readonly windowDays?: number;
  readonly hotspotThreshold?: number;
}

export interface ConfigResolution {
  /** The value handed to every analyzer. */
  readonly config: Config;
  /**
   * Lines the entry point prints before the pipeline starts. Currently only
   * AD-10's ignored-in-MVP notice, which appears at most once per run.
   */
  readonly notices: readonly string[];
  /** Path of the config file that contributed, or null when none exists. */
  readonly source: string | null;
}

export interface ResolveConfigOptions {
  /** Directory searched for `.gitnebula.yml`. */
  readonly repoRoot: string;
  /** ISO instant the window is measured back from (AD-13); injected by the caller. */
  readonly windowAnchor: string;
  readonly flags?: CliFlags;
  /** scanner's `DEFAULT_EXCLUDES` data (AD-3); user globs are added to it. */
  readonly defaultExcludes?: readonly string[];
}

/**
 * Resolves the run configuration, failing fast on an invalid file.
 *
 * @throws {StageError} stage `config`, naming the offending key and its line.
 */
export function resolveConfig(options: ResolveConfigOptions): ConfigResolution {
  const path = join(options.repoRoot, CONFIG_FILENAME);
  const text = readConfigFile(path);

  const file = text === null ? emptyFileConfig() : parseConfigFile(text, path);
  const flags = options.flags ?? {};

  const excludes = [
    ...(options.defaultExcludes ?? []),
    ...file.excludes,
    ...(flags.excludes ?? []),
  ];

  const config: Config = {
    windowAnchor: options.windowAnchor,
    windowDays: flags.windowDays ?? file.windowDays ?? DEFAULT_WINDOW_DAYS,
    excludes: dedupe(excludes),
    layers: file.layers,
    hotspotThreshold:
      flags.hotspotThreshold ??
      file.hotspotThreshold ??
      DEFAULT_HOTSPOT_THRESHOLD,
    ...(file.hasLlmKey ? { llm: file.llm } : {}),
  };

  return {
    config,
    notices: file.hasLlmKey ? [LLM_IGNORED_NOTICE] : [],
    source: text === null ? null : path,
  };
}

interface FileConfig {
  readonly excludes: readonly string[];
  readonly windowDays: number | undefined;
  readonly layers: Readonly<Record<string, Layer>>;
  readonly hotspotThreshold: number | undefined;
  readonly hasLlmKey: boolean;
  readonly llm: unknown;
}

function emptyFileConfig(): FileConfig {
  return {
    excludes: [],
    windowDays: undefined,
    layers: {},
    hotspotThreshold: undefined,
    hasLlmKey: false,
    llm: undefined,
  };
}

function readConfigFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StageError(
      "config",
      `cannot read ${CONFIG_FILENAME}`,
      `check the file's permissions at ${path}`,
      { underlying: error },
    );
  }
}

function parseConfigFile(text: string, path: string): FileConfig {
  const doc = parseDocument(text);
  const syntaxError = doc.errors[0];
  if (syntaxError !== undefined) {
    const line = syntaxError.linePos?.[0]?.line ?? lineOf(text, 0);
    throw configError(
      path,
      line,
      syntaxError.message.split("\n")[0] ?? "invalid YAML",
      "fix the YAML syntax — the file must be a mapping of known keys",
    );
  }

  const root = doc.contents;
  // An empty file parses to a null document; treat it as "no overrides".
  if (root === null || (isScalar(root) && root.value === null)) {
    return emptyFileConfig();
  }
  if (!isMap(root)) {
    throw configError(
      path,
      1,
      `${CONFIG_FILENAME} must be a mapping of keys`,
      "write top-level keys such as `excludes:` or `windowDays:`",
    );
  }

  for (const key of root.items.map((item) => item.key)) {
    const name = isScalar(key) ? String(key.value) : "";
    if (!(KNOWN_KEYS as readonly string[]).includes(name)) {
      throw configError(
        path,
        lineOfKey(doc, text, name),
        `unknown key "${name}"`,
        `remove it — the supported keys are ${KNOWN_KEYS.join(", ")}`,
      );
    }
  }

  const raw = doc.toJS() as Record<string, unknown>;
  const at = (key: string): number => lineOfKey(doc, text, key);

  return {
    excludes: readExcludes(raw, path, at),
    windowDays: readWindowDays(raw, path, at),
    layers: readLayers(raw, path, at),
    hotspotThreshold: readHotspotThreshold(raw, path, at),
    hasLlmKey: Object.hasOwn(raw, "llm"),
    llm: raw["llm"],
  };
}

type LineOf = (key: string) => number;

function readExcludes(
  raw: Record<string, unknown>,
  path: string,
  at: LineOf,
): readonly string[] {
  const value = raw["excludes"];
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw configError(
      path,
      at("excludes"),
      `"excludes" must be a list of glob strings`,
      'write it as a YAML list, e.g. `excludes:\n  - "vendor/**"`',
    );
  }
  return value as readonly string[];
}

function readWindowDays(
  raw: Record<string, unknown>,
  path: string,
  at: LineOf,
): number | undefined {
  const value = raw["windowDays"];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw configError(
      path,
      at("windowDays"),
      `"windowDays" must be a whole number of days of at least 1`,
      `use a value such as ${DEFAULT_WINDOW_DAYS}`,
    );
  }
  return value;
}

function readLayers(
  raw: Record<string, unknown>,
  path: string,
  at: LineOf,
): Readonly<Record<string, Layer>> {
  const value = raw["layers"];
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw configError(
      path,
      at("layers"),
      `"layers" must be a mapping of glob to layer`,
      `write it as \`layers:\n  "src/api/**": backend\``,
    );
  }

  const layers: Record<string, Layer> = {};
  for (const [glob, layer] of Object.entries(value as object)) {
    if (
      typeof layer !== "string" ||
      !(LAYERS as readonly string[]).includes(layer)
    ) {
      throw configError(
        path,
        at("layers"),
        `layer "${String(layer)}" for "${glob}" is not a known layer`,
        `use one of ${LAYERS.join(", ")}`,
      );
    }
    layers[glob] = layer as Layer;
  }
  return layers;
}

function readHotspotThreshold(
  raw: Record<string, unknown>,
  path: string,
  at: LineOf,
): number | undefined {
  const value = raw["hotspotThreshold"];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) {
    throw configError(
      path,
      at("hotspotThreshold"),
      `"hotspotThreshold" must be a number between 0 and 1`,
      `use a value such as ${DEFAULT_HOTSPOT_THRESHOLD} — churn is normalized to that scale (ADR-0003)`,
    );
  }
  return value;
}

function configError(
  path: string,
  line: number,
  cause: string,
  remedy: string,
): StageError {
  return new StageError("config", `${path}:${line}: ${cause}`, remedy);
}

/**
 * 1-based line of a top-level key's own token, so an error can point at the
 * key the user wrote rather than at the file.
 */
function lineOfKey(doc: Document, text: string, name: string): number {
  const root = doc.contents;
  if (!isMap(root)) return 1;
  for (const item of root.items) {
    const key = item.key;
    if (isScalar(key) && String(key.value) === name) {
      return lineOf(text, key.range?.[0] ?? 0);
    }
  }
  return 1;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
