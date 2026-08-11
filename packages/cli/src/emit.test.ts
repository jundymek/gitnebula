import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AnalysisDocument } from "@gitnebula/contract";
import { afterEach, describe, expect, it } from "vitest";

import { emit, serialize } from "./emit.js";
import { enrich } from "./enrich.js";
import { StageError } from "./errors.js";
import { makeTempDir, removeAll } from "./test-support.js";

const temps: string[] = [];
afterEach(() => removeAll(temps));

const analysis: AnalysisDocument = {
  schemaVersion: "1.0",
  repo: {
    name: "demo",
    remoteUrl: null,
    analyzedAt: "2026-02-03T10:00:00.000Z",
    defaultBranch: "main",
    analysisWindowDays: 90,
    stats: { files: 0, loc: 0, commits: 0, languages: {} },
  },
  nodes: [],
  edges: [],
  cochanges: [],
};

describe("serialize", () => {
  it("ends with a newline so the file is a well-formed text artifact", () => {
    expect(serialize(analysis).endsWith("}\n")).toBe(true);
  });

  it("renders equal documents as equal bytes (FR-7)", () => {
    expect(serialize(analysis)).toBe(
      serialize(JSON.parse(JSON.stringify(analysis)) as AnalysisDocument),
    );
  });
});

describe("emit", () => {
  it("writes the document where it is told, creating the directory", () => {
    const path = join(makeTempDir(temps, "gitnebula-emit-"), "out", "a.json");

    emit(path, analysis);

    expect(readFileSync(path, "utf8")).toBe(serialize(analysis));
  });

  it("aborts in the AD-7 shape when the path cannot be written", () => {
    const dir = makeTempDir(temps, "gitnebula-emit-");
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");

    let thrown: unknown;
    try {
      emit(join(blocker, "analysis.json"), analysis);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StageError);
    expect((thrown as StageError).stage).toBe("emit");
    expect((thrown as StageError).remedy).toContain("--out");
  });
});

describe("enrich (AD-10, FR-8)", () => {
  it("is the identity in MVP", async () => {
    await expect(enrich(analysis)).resolves.toBe(analysis);
  });

  it("leaves descriptions null, with nothing to warn about", async () => {
    const enriched = await enrich({
      ...analysis,
      nodes: [
        {
          id: "core/",
          kind: "module",
          parent: null,
          path: "core",
          layer: "backend",
          loc: 1,
          churn: 0,
          commits: 0,
          authors: 0,
          lastChangedAt: null,
          description: null,
          descriptionSource: null,
        },
      ],
    });

    expect(enriched.nodes[0]?.description).toBeNull();
    expect(enriched.nodes[0]?.descriptionSource).toBeNull();
  });
});
