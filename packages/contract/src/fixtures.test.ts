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
      "root-files.json",
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

// ADR-0005: module-level edges are aggregates and `weight` is defined as the
// number of underlying file-level import pairs. Schema validation cannot see
// this — it is a cross-record invariant — so every fixture is checked directly.
// A fixture that lies here would silently break any viz story testing module
// aggregation against it.
describe("module edge aggregation (ADR-0005)", () => {
  it.each(fixtureFiles)(
    "%s: weight equals the file pairs beneath it",
    (file) => {
      const doc = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as {
        nodes: { id: string; kind: string; parent: string | null }[];
        edges: { source: string; target: string; weight: number }[];
      };

      const kindById = new Map(doc.nodes.map((node) => [node.id, node.kind]));
      const parentById = new Map(
        doc.nodes.map((node) => [node.id, node.parent]),
      );
      const isModule = (id: string) => kindById.get(id) === "module";

      const pairsBetweenModules = new Map<string, number>();
      for (const edge of doc.edges) {
        if (isModule(edge.source) || isModule(edge.target)) continue;
        const from = parentById.get(edge.source);
        const to = parentById.get(edge.target);
        if (from == null || to == null || from === to) continue;
        const key = `${from}\u0000${to}`;
        pairsBetweenModules.set(key, (pairsBetweenModules.get(key) ?? 0) + 1);
      }

      for (const edge of doc.edges) {
        if (!isModule(edge.source) || !isModule(edge.target)) continue;
        const key = `${edge.source}\u0000${edge.target}`;
        expect(
          pairsBetweenModules.get(key) ?? 0,
          `${edge.source} -> ${edge.target} claims weight ${edge.weight}`,
        ).toBe(edge.weight);
      }
    },
  );
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
