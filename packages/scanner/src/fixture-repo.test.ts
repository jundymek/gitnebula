// AC-4: the scan of the built fixture repository (AD-14) matches committed
// expectations, and two runs are byte-identical.
//
// The expectation is written out in full rather than snapshotted to a file: a
// reviewer can see what the scanner is supposed to say about a known tree
// without opening a second artifact, and an accidental change cannot be
// blessed by re-recording.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Config, ScanResult } from "@gitnebula/contract";
import { beforeAll, describe, expect, it } from "vitest";

import { analyze } from "./analyze.js";
import { DEFAULT_EXCLUDES } from "./excludes.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const buildScript = join(repoRoot, "test-fixtures", "build-fixture-repo.sh");
const fixtureRepo = join(
  repoRoot,
  "test-fixtures",
  ".generated",
  "history-repo",
);

// Fixture tests pin the window (AD-13). The scanner ignores both fields — it
// has no history to window — but the config it receives is the real one.
const config: Config = {
  windowAnchor: "2026-01-01T00:00:00Z",
  windowDays: 365,
  excludes: DEFAULT_EXCLUDES,
  layers: {},
  hotspotThreshold: 0.5,
};

/**
 * The fixture repository's working tree at HEAD:
 *
 *   core/scoring.py   4 non-blank lines, python  -> backend (.py)
 *   legacy/old.ts     2 non-blank lines, ts      -> backend (.ts)
 *   web/api.ts        2 non-blank lines, ts      -> frontend (under web/)
 *
 * Three top-level directories, none above the 80% descent threshold, so
 * modules stay at depth 1.
 */
const expected: ScanResult = {
  nodes: [
    {
      id: "core/",
      kind: "module",
      parent: null,
      path: "core/",
      layer: "backend",
      loc: 4,
    },
    {
      id: "core/scoring.py",
      kind: "file",
      parent: "core/",
      path: "core/scoring.py",
      layer: "backend",
      loc: 4,
    },
    {
      id: "legacy/",
      kind: "module",
      parent: null,
      path: "legacy/",
      layer: "backend",
      loc: 2,
    },
    {
      id: "legacy/old.ts",
      kind: "file",
      parent: "legacy/",
      path: "legacy/old.ts",
      layer: "backend",
      loc: 2,
    },
    {
      id: "web/",
      kind: "module",
      parent: null,
      path: "web/",
      layer: "frontend",
      loc: 2,
    },
    {
      id: "web/api.ts",
      kind: "file",
      parent: "web/",
      path: "web/api.ts",
      layer: "frontend",
      loc: 2,
    },
  ],
  stats: {
    files: 3,
    loc: 8,
    languages: { python: 0.5, typescript: 0.5 },
  },
  warnings: [],
};

describe("scan of the fixture repository (AC-4)", () => {
  beforeAll(() => {
    // Self-contained: `pnpm --filter @gitnebula/scanner test` must work
    // without the root pretest step having run first.
    execFileSync("sh", [buildScript], { encoding: "utf8" });
  });

  it("matches the committed expectation", async () => {
    const result = await analyze({ root: fixtureRepo }, config);

    expect(result).toEqual(expected);
  });

  it("excludes the .git directory from the universe", async () => {
    const result = await analyze({ root: fixtureRepo }, config);

    expect(result.nodes.every((node) => !node.path.startsWith(".git"))).toBe(
      true,
    );
  });

  it("serializes byte-identically across two runs", async () => {
    const first = await analyze({ root: fixtureRepo }, config);
    const second = await analyze({ root: fixtureRepo }, config);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
