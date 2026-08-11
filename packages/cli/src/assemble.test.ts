import type {
  Config,
  DepsResult,
  GitResult,
  ScanResult,
} from "@gitnebula/contract";
import { validateAnalysis } from "@gitnebula/contract";
import { describe, expect, it } from "vitest";

import { assemble, type AssembleInput } from "./assemble.js";
import { StageError } from "./errors.js";
import type { RepoInfo } from "./repo.js";

const repo: RepoInfo = {
  root: "/tmp/demo",
  name: "demo",
  remoteUrl: "https://github.com/owner/demo.git",
  defaultBranch: "main",
};

const config: Config = {
  windowAnchor: "2026-01-01T00:00:00.000Z",
  windowDays: 365,
  excludes: [],
  layers: {},
  hotspotThreshold: 0.5,
};

const scan: ScanResult = {
  nodes: [
    {
      id: "web/",
      kind: "module",
      parent: null,
      path: "web",
      layer: "frontend",
      loc: 12,
    },
    {
      id: "core/",
      kind: "module",
      parent: null,
      path: "core",
      layer: "backend",
      loc: 8,
    },
    {
      id: "web/api.ts",
      kind: "file",
      parent: "web/",
      path: "web/api.ts",
      layer: "frontend",
      loc: 12,
    },
    {
      id: "core/scoring.py",
      kind: "file",
      parent: "core/",
      path: "core/scoring.py",
      layer: "backend",
      loc: 8,
    },
  ],
  stats: { files: 2, loc: 20, languages: { TypeScript: 0.6, Python: 0.4 } },
  warnings: [],
};

const deps: DepsResult = {
  edges: [
    {
      source: "web/api.ts",
      target: "core/scoring.py",
      kind: "import",
      weight: 1,
    },
    { source: "web/", target: "core/", kind: "import", weight: 1 },
  ],
  warnings: [],
};

const git: GitResult = {
  history: {
    "web/api.ts": {
      churn: 1,
      commits: 3,
      authors: 3,
      lastChangedAt: "2025-05-20T16:45:00Z",
    },
    "core/scoring.py": {
      churn: 1,
      commits: 3,
      authors: 2,
      lastChangedAt: "2025-06-30T08:00:00Z",
    },
  },
  cochanges: [
    { a: "core/", b: "web/", count: 2 },
    { a: "core/scoring.py", b: "web/api.ts", count: 5 },
  ],
  commits: 5,
  lastCommitAt: "2025-06-30T08:00:00Z",
  warnings: [],
};

const input: AssembleInput = {
  repo,
  analyzedAt: "2026-02-03T10:00:00.000Z",
  config,
  scan,
  deps,
  git,
};

describe("assemble (AC-3)", () => {
  it("produces a document that passes validateAnalysis", () => {
    expect(validateAnalysis(assemble(input)).valid).toBe(true);
  });

  it("injects analyzedAt and the window length from cli, not from an analyzer", () => {
    const analysis = assemble(input);
    expect(analysis.repo.analyzedAt).toBe("2026-02-03T10:00:00.000Z");
    expect(analysis.repo.analysisWindowDays).toBe(365);
  });

  it("fills repo.stats.commits from githist and the rest from scanner", () => {
    expect(assemble(input).repo.stats).toEqual({
      files: 2,
      loc: 20,
      commits: 5,
      languages: { Python: 0.4, TypeScript: 0.6 },
    });
  });

  it("merges history onto scanner's nodes and sorts them by id", () => {
    const analysis = assemble(input);

    expect(analysis.nodes.map((node) => node.id)).toEqual([
      "core/",
      "core/scoring.py",
      "web/",
      "web/api.ts",
    ]);
    expect(analysis.nodes[1]).toMatchObject({
      commits: 3,
      authors: 2,
      churn: 1,
      lastChangedAt: "2025-06-30T08:00:00Z",
    });
  });

  it("gives a node githist never mentioned an honest empty history", () => {
    const analysis = assemble({ ...input, git: { ...git, history: {} } });

    for (const node of analysis.nodes) {
      expect(node).toMatchObject({
        churn: 0,
        commits: 0,
        authors: 0,
        lastChangedAt: null,
      });
    }
  });

  it("keeps description and descriptionSource present and null on every node (AD-10)", () => {
    for (const node of assemble(input).nodes) {
      expect(node.description).toBeNull();
      expect(node.descriptionSource).toBeNull();
    }
  });

  it("sorts edges by source then target", () => {
    expect(
      assemble(input).edges.map((edge) => `${edge.source}->${edge.target}`),
    ).toEqual(["web/->core/", "web/api.ts->core/scoring.py"]);
  });

  it("sorts co-change pairs by count descending, then by ids", () => {
    expect(assemble(input).cochanges.map((pair) => pair.count)).toEqual([5, 2]);
  });

  it("aborts in the AD-7 shape when the merged document violates the schema", () => {
    const broken: ScanResult = {
      ...scan,
      nodes: [
        {
          id: "core/",
          kind: "module",
          parent: null,
          path: "core",
          // A layer outside the contract enum: exactly what validation is for.
          layer: "database" as ScanResult["nodes"][number]["layer"],
          loc: 8,
        },
      ],
    };

    let thrown: unknown;
    try {
      assemble({ ...input, scan: broken });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StageError);
    const error = thrown as StageError;
    expect(error.stage).toBe("assemble");
    expect(error.cause).toContain("/nodes/0/layer");
    expect(error.remedy).toContain("gitnebula bug");
  });
});
