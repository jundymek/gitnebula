import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatValidationErrors, validateAnalysis } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");
const generatorScript = join(
  here,
  "..",
  "scripts",
  "generate-synthetic-fixture.mjs",
);
const syntheticFixture = join(fixturesDir, "synthetic-100x2000.json");

const fixtureFiles = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

describe("contract fixtures", () => {
  it("ships the edge-case set the story requires", () => {
    expect(fixtureFiles).toEqual([
      "cyclic-imports.json",
      "empty-graph.json",
      "module-zero-files.json",
      "single-module.json",
      "synthetic-100x2000.json",
      "zero-history.json",
    ]);
  });

  // Looping over the directory means a newly added fixture is validated with
  // no test-code change (see fixtures/README.md).
  it.each(fixtureFiles)("%s validates against the schema", (file) => {
    const data: unknown = JSON.parse(
      readFileSync(join(fixturesDir, file), "utf8"),
    );
    const result = validateAnalysis(data);
    // ValidationResult is a discriminated union: `errors` exists only on the
    // invalid branch, so narrow before reading it.
    if (!result.valid) {
      expect.fail(
        `${file} does not satisfy analysis.schema.json:\n${formatValidationErrors(result.errors)}`,
      );
    }
  });
});

describe("synthetic fixture generator", () => {
  it("regenerates byte-identically (seeded, no clock or RNG)", () => {
    const committed = readFileSync(syntheticFixture, "utf8");
    execFileSync(process.execPath, [generatorScript], { stdio: "ignore" });
    expect(readFileSync(syntheticFixture, "utf8")).toBe(committed);
  });

  it("produces the 100-module / 2,000-file perf yardstick", () => {
    const data = JSON.parse(readFileSync(syntheticFixture, "utf8")) as {
      nodes: { kind: string }[];
      repo: { stats: { files: number } };
    };
    const files = data.nodes.filter((node) => node.kind === "file");
    const modules = data.nodes.filter((node) => node.kind === "module");
    expect(modules).toHaveLength(100);
    expect(files).toHaveLength(2000);
    expect(data.repo.stats.files).toBe(2000);
  });
});
