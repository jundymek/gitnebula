import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONFIG_FILENAME,
  DEFAULT_HOTSPOT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  LLM_IGNORED_NOTICE,
  resolveConfig,
} from "./config.js";
import { StageError } from "./errors.js";

const ANCHOR = "2026-01-01T00:00:00.000Z";
const created: string[] = [];

function repoWith(yaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gitnebula-config-"));
  created.push(dir);
  if (yaml !== undefined) writeFileSync(join(dir, CONFIG_FILENAME), yaml);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("resolveConfig (AC-1, AD-3)", () => {
  it("falls back to defaults when no config file exists", () => {
    const { config, notices, source } = resolveConfig({
      repoRoot: repoWith(),
      windowAnchor: ANCHOR,
    });

    expect(source).toBeNull();
    expect(notices).toEqual([]);
    expect(config).toEqual({
      windowAnchor: ANCHOR,
      windowDays: DEFAULT_WINDOW_DAYS,
      excludes: [],
      layers: {},
      hotspotThreshold: DEFAULT_HOTSPOT_THRESHOLD,
    });
  });

  it("seeds excludes from scanner's data, then the file, then the flags (AD-3 precedence)", () => {
    const { config } = resolveConfig({
      repoRoot: repoWith('excludes:\n  - "vendor/**"\n'),
      windowAnchor: ANCHOR,
      defaultExcludes: ["**/node_modules"],
      flags: { excludes: ["docs/**"] },
    });

    expect(config.excludes).toEqual([
      "**/node_modules",
      "vendor/**",
      "docs/**",
    ]);
  });

  it("drops a duplicate glob rather than passing it to picomatch twice", () => {
    const { config } = resolveConfig({
      repoRoot: repoWith('excludes:\n  - "dist"\n'),
      windowAnchor: ANCHOR,
      defaultExcludes: ["dist"],
    });

    expect(config.excludes).toEqual(["dist"]);
  });

  it("lets a flag win over the same key in the file", () => {
    const { config } = resolveConfig({
      repoRoot: repoWith("windowDays: 30\nhotspotThreshold: 0.9\n"),
      windowAnchor: ANCHOR,
      flags: { windowDays: 7, hotspotThreshold: 0.25 },
    });

    expect(config.windowDays).toBe(7);
    expect(config.hotspotThreshold).toBe(0.25);
  });

  it("carries layer overrides through untouched, for scanner to prepend (ADR-0002)", () => {
    const { config } = resolveConfig({
      repoRoot: repoWith(
        'layers:\n  "src/api/**": backend\n  "ui/**": frontend\n',
      ),
      windowAnchor: ANCHOR,
    });

    expect(config.layers).toEqual({
      "src/api/**": "backend",
      "ui/**": "frontend",
    });
  });

  it("prints exactly one ignored-in-MVP notice for the llm key (AD-10)", () => {
    const { config, notices } = resolveConfig({
      repoRoot: repoWith("llm:\n  backend: ollama\n  model: llama3\n"),
      windowAnchor: ANCHOR,
    });

    expect(notices).toEqual([LLM_IGNORED_NOTICE]);
    expect(config.llm).toEqual({ backend: "ollama", model: "llama3" });
  });

  it("says nothing about llm when the key is absent (FR-8: nothing degrades)", () => {
    const { notices, config } = resolveConfig({
      repoRoot: repoWith("windowDays: 30\n"),
      windowAnchor: ANCHOR,
    });

    expect(notices).toEqual([]);
    expect("llm" in config).toBe(false);
  });

  it("treats an empty config file as no overrides", () => {
    const { config } = resolveConfig({
      repoRoot: repoWith("# nothing here yet\n"),
      windowAnchor: ANCHOR,
    });

    expect(config.windowDays).toBe(DEFAULT_WINDOW_DAYS);
  });
});

describe("resolveConfig failures (AC-1: fail fast naming key and line)", () => {
  it("names an unknown key and its line", () => {
    const root = repoWith("windowDays: 30\nexcludes: []\nwindowdays: 7\n");

    let thrown: unknown;
    try {
      resolveConfig({ repoRoot: root, windowAnchor: ANCHOR });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StageError);
    const error = thrown as StageError;
    expect(error.stage).toBe("config");
    expect(error.cause).toContain(`${CONFIG_FILENAME}:3:`);
    expect(error.cause).toContain('unknown key "windowdays"');
    expect(error.message).toMatch(/^config: .+ — .+$/s);
  });

  it("names a badly typed key and its line", () => {
    const root = repoWith("excludes: []\nwindowDays: soon\n");

    expect(() =>
      resolveConfig({ repoRoot: root, windowAnchor: ANCHOR }),
    ).toThrow(/\.gitnebula\.yml:2: "windowDays" must be a whole number/);
  });

  it("rejects a hotspotThreshold outside 0..1, naming its line", () => {
    const root = repoWith("windowDays: 30\n\nhotspotThreshold: 5\n");

    expect(() =>
      resolveConfig({ repoRoot: root, windowAnchor: ANCHOR }),
    ).toThrow(
      /\.gitnebula\.yml:3: "hotspotThreshold" must be a number between 0 and 1/,
    );
  });

  it("rejects an unknown layer value", () => {
    const root = repoWith('layers:\n  "src/**": database\n');

    expect(() =>
      resolveConfig({ repoRoot: root, windowAnchor: ANCHOR }),
    ).toThrow(/layer "database" for "src\/\*\*" is not a known layer/);
  });

  it("reports a YAML syntax error with its line", () => {
    const root = repoWith("excludes:\n  - ok\n :\n bad: [\n");

    expect(() =>
      resolveConfig({ repoRoot: root, windowAnchor: ANCHOR }),
    ).toThrow(/^config: .*\.gitnebula\.yml:\d+:/);
  });

  it("rejects a config file that is not a mapping", () => {
    const root = repoWith("- one\n- two\n");

    expect(() =>
      resolveConfig({ repoRoot: root, windowAnchor: ANCHOR }),
    ).toThrow(/must be a mapping of keys/);
  });
});
