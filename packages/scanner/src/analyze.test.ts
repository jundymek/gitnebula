import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Config } from "@gitnebula/contract";
import { afterEach, describe, expect, it } from "vitest";

import { analyze, DATA_BLOB_LOC_THRESHOLD } from "./analyze.js";
import { DEFAULT_EXCLUDES } from "./excludes.js";

const temporaryRoots: string[] = [];

/** Materializes a repository-shaped directory tree in a temp directory. */
async function buildTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gitnebula-scan-"));
  temporaryRoots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
  }
  return root;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    windowAnchor: "2026-01-01T00:00:00Z",
    windowDays: 365,
    excludes: DEFAULT_EXCLUDES,
    layers: {},
    hotspotThreshold: 0.5,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("analyze — excludes (AC-1)", () => {
  it("drops everything the default excludes cover", async () => {
    const root = await buildTree({
      "src/main.ts": "export const main = 1;\n",
      "node_modules/left-pad/index.js": "module.exports = 1;\n",
      "dist/bundle.js": "console.log(1);\n",
      "build/out.js": "console.log(1);\n",
      ".venv/lib/thing.py": "x = 1\n",
      "venv/lib/thing.py": "x = 1\n",
      ".git/config": "[core]\n",
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "package-lock.json": "{}\n",
      "vendor/lib.js": "var x = 1;\n",
      "public/app.min.js": "var a=1;\n",
      "public/app.js.map": '{"version":3}\n',
      "docs/logo.png": "not really a png\n",
      "_bmad/config.toml": "a = 1\n",
      ".claude/settings.json": "{}\n",
    });

    const result = await analyze({ root }, makeConfig());
    const filePaths = result.nodes
      .filter((node) => node.kind === "file")
      .map((node) => node.path);

    expect(filePaths).toEqual(["src/main.ts"]);
    expect(result.stats.files).toBe(1);
  });

  it("excludes nothing when the resolved config carries no globs", async () => {
    const root = await buildTree({
      "src/main.ts": "export const main = 1;\n",
      "node_modules/left-pad/index.js": "module.exports = 1;\n",
    });

    const result = await analyze({ root }, makeConfig({ excludes: [] }));

    expect(result.stats.files).toBe(2);
  });

  it("honors extra globs the config adds", async () => {
    const root = await buildTree({
      "src/main.ts": "export const main = 1;\n",
      "generated/api.ts": "export const api = 1;\n",
    });

    const result = await analyze(
      { root },
      makeConfig({ excludes: [...DEFAULT_EXCLUDES, "**/generated"] }),
    );

    expect(result.nodes.map((node) => node.id)).not.toContain(
      "generated/api.ts",
    );
  });
});

describe("analyze — per-file measurement (AC-1)", () => {
  it("counts LOC, detects language and assigns layer and module", async () => {
    const root = await buildTree({
      "core/scoring.py": "def score(x):\n\n    return x * 2\n",
      "web/api.ts": 'export const api = () => "v1";\n',
    });

    const result = await analyze({ root }, makeConfig());
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    expect(byId.get("core/scoring.py")).toEqual({
      id: "core/scoring.py",
      kind: "file",
      parent: "core/",
      path: "core/scoring.py",
      layer: "backend",
      loc: 2,
    });
    expect(byId.get("web/api.ts")?.layer).toBe("frontend");
    expect(byId.get("web/api.ts")?.parent).toBe("web/");
    expect(byId.get("core/")).toEqual({
      id: "core/",
      kind: "module",
      parent: null,
      path: "core/",
      layer: "backend",
      loc: 2,
    });
    expect(result.stats.loc).toBe(3);
  });

  it("leaves repository-root files without a module", async () => {
    const root = await buildTree({
      "README.md": "# hello\n",
      "src/main.ts": "export const main = 1;\n",
    });

    const result = await analyze({ root }, makeConfig());
    const readme = result.nodes.find((node) => node.id === "README.md");

    expect(readme?.parent).toBeNull();
    expect(result.nodes.filter((node) => node.kind === "module")).toHaveLength(
      1,
    );
  });

  it("does not count blank or whitespace-only lines", async () => {
    const root = await buildTree({
      "src/main.ts": "const a = 1;\n\n   \n\t\n  \t \nconst b = 2;\n",
    });

    const result = await analyze({ root }, makeConfig());

    expect(result.stats.loc).toBe(2);
  });

  it("counts a final line with no trailing newline", async () => {
    const root = await buildTree({
      "src/main.ts": "const a = 1;\nconst b = 2;",
    });

    const result = await analyze({ root }, makeConfig());

    expect(result.stats.loc).toBe(2);
  });

  it("reports progress once per analyzed file", async () => {
    const root = await buildTree({
      "src/a.ts": "const a = 1;\n",
      "src/b.ts": "const b = 1;\n",
    });

    const seen: [number, number][] = [];
    await analyze({ root }, makeConfig(), (done, total) =>
      seen.push([done, total]),
    );

    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("analyze — layers (AC-2)", () => {
  it("classifies a test file under frontend/ as test, not frontend", async () => {
    const root = await buildTree({
      "frontend/widget.tsx": "export const Widget = () => null;\n",
      "frontend/widget.test.tsx": "it('works', () => {});\n",
    });

    const result = await analyze({ root }, makeConfig());
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    expect(byId.get("frontend/widget.tsx")?.layer).toBe("frontend");
    expect(byId.get("frontend/widget.test.tsx")?.layer).toBe("test");
  });

  it("lets a config layer glob win over the default table, test rules included", async () => {
    const root = await buildTree({
      "frontend/widget.test.tsx": "it('works', () => {});\n",
      "notes/readme.md": "# notes\n",
    });

    const result = await analyze(
      { root },
      makeConfig({
        layers: { "frontend/**": "infra", "notes/**": "backend" },
      }),
    );
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    expect(byId.get("frontend/widget.test.tsx")?.layer).toBe("infra");
    expect(byId.get("notes/readme.md")?.layer).toBe("backend");
  });

  it("gives a module the dominant layer of its files by LOC", async () => {
    const root = await buildTree({
      // 3 backend lines against 1 frontend line, in one module.
      "mixed/service.py": "a = 1\nb = 2\nc = 3\n",
      "mixed/style.css": "a{}\n",
    });

    const result = await analyze({ root }, makeConfig());

    expect(result.nodes.find((node) => node.id === "mixed/")?.layer).toBe(
      "backend",
    );
  });

  it("falls back to other for a path the table does not match", async () => {
    const root = await buildTree({ "notes/todo.md": "- one\n" });

    const result = await analyze({ root }, makeConfig());

    expect(
      result.nodes.find((node) => node.id === "notes/todo.md")?.layer,
    ).toBe("other");
  });
});

describe("analyze — module derivation (AC-3)", () => {
  it("descends one level into a directory holding 95% of the files", async () => {
    const files: Record<string, string> = { "README.md": "# repo\n" };
    // 19 of 20 analyzable files (95%) live under src/.
    for (let index = 0; index < 9; index += 1) {
      files[`src/core/mod${index}.ts`] = `export const m${index} = ${index};\n`;
    }
    for (let index = 0; index < 9; index += 1) {
      files[`src/web/view${index}.tsx`] =
        `export const V${index} = () => null;\n`;
    }
    files["src/index.ts"] = "export * from './core/mod0.js';\n";

    const root = await buildTree(files);
    const result = await analyze({ root }, makeConfig());
    const moduleIds = result.nodes
      .filter((node) => node.kind === "module")
      .map((node) => node.id);

    expect(moduleIds).toEqual(["src/", "src/core/", "src/web/"]);
    for (const id of moduleIds) {
      expect(id.replace(/\/$/, "").split("/").length).toBeLessThanOrEqual(2);
    }

    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    expect(byId.get("src/core/mod0.ts")?.parent).toBe("src/core/");
    // A file directly inside the descended directory keeps it as its module.
    expect(byId.get("src/index.ts")?.parent).toBe("src/");
    expect(byId.get("README.md")?.parent).toBeNull();
  });

  it("never lets a module path exceed two segments", async () => {
    const files: Record<string, string> = {};
    // src/ holds 100% of files, and src/app/ holds 100% of those — a second
    // descent would reach depth 3, which the cap forbids.
    for (let index = 0; index < 10; index += 1) {
      files[`src/app/feature${index}/index.ts`] =
        `export const f = ${index};\n`;
    }

    const root = await buildTree(files);
    const result = await analyze({ root }, makeConfig());
    const moduleIds = result.nodes
      .filter((node) => node.kind === "module")
      .map((node) => node.id);

    expect(moduleIds).toEqual(["src/app/"]);
  });

  it("keeps top-level directories when no directory dominates", async () => {
    const root = await buildTree({
      "core/a.py": "a = 1\n",
      "core/b.py": "b = 1\n",
      "web/c.ts": "const c = 1;\n",
    });

    const result = await analyze({ root }, makeConfig());
    const moduleIds = result.nodes
      .filter((node) => node.kind === "module")
      .map((node) => node.id);

    expect(moduleIds).toEqual(["core/", "web/"]);
  });
});

describe("analyze — determinism (AC-4)", () => {
  it("produces byte-identical output across two runs", async () => {
    const root = await buildTree({
      "core/scoring.py": "def score(x):\n    return x\n",
      "web/api.ts": "export const api = 1;\n",
      "web/app.tsx": "export const App = () => null;\n",
      "README.md": "# repo\n",
    });

    const first = await analyze({ root }, makeConfig());
    const second = await analyze({ root }, makeConfig());

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("sorts nodes by id", async () => {
    const root = await buildTree({
      "web/api.ts": "const a = 1;\n",
      "core/b.py": "b = 1\n",
      "core/a.py": "a = 1\n",
    });

    const result = await analyze({ root }, makeConfig());
    const ids = result.nodes.map((node) => node.id);

    expect(ids).toEqual([...ids].sort());
  });
});

describe("analyze — unknown languages and shares (AC-5)", () => {
  it("counts unknown-extension files and layers them other", async () => {
    const root = await buildTree({
      "misc/data.weird": "one\ntwo\n",
      "src/main.ts": "const a = 1;\n",
    });

    const result = await analyze({ root }, makeConfig());
    const weird = result.nodes.find((node) => node.id === "misc/data.weird");

    expect(weird?.loc).toBe(2);
    expect(weird?.layer).toBe("other");
    expect(result.stats.files).toBe(2);
    expect(result.stats.loc).toBe(3);
    expect(result.stats.languages).toEqual({
      typescript: 1 / 3,
      unknown: 2 / 3,
    });
  });

  it("produces language shares that sum to 1", async () => {
    const root = await buildTree({
      "core/a.py": "a = 1\nb = 2\n",
      "web/b.ts": "const b = 1;\n",
      "web/c.css": "a{}\n",
      "misc/d.unknownext": "x\n",
      "README.md": "# repo\n",
    });

    const result = await analyze({ root }, makeConfig());
    const total = Object.values(result.stats.languages).reduce(
      (sum, share) => sum + share,
      0,
    );

    expect(total).toBeCloseTo(1, 10);
  });

  it("emits an empty share map for a repository with no analyzed lines", async () => {
    const root = await buildTree({ "src/empty.ts": "" });

    const result = await analyze({ root }, makeConfig());

    expect(result.stats.loc).toBe(0);
    expect(result.stats.languages).toEqual({});
    expect(result.stats.files).toBe(1);
  });
});

describe("analyze — warnings (AD-7)", () => {
  it("keeps a binary file in the universe at 0 LOC and counts it", async () => {
    const root = await buildTree({ "src/main.ts": "const a = 1;\n" });
    await writeFile(join(root, "src", "blob.dat"), Buffer.from([1, 0, 2, 3]));

    const result = await analyze({ root }, makeConfig());
    const blob = result.nodes.find((node) => node.id === "src/blob.dat");

    expect(blob?.loc).toBe(0);
    expect(result.warnings).toContainEqual({
      code: "binary-file",
      count: 1,
      detail: "src/blob.dat",
    });
  });

  it("skips symlinks and counts them", async () => {
    const root = await buildTree({ "src/main.ts": "const a = 1;\n" });
    await symlink(join(root, "src", "main.ts"), join(root, "src", "link.ts"));

    const result = await analyze({ root }, makeConfig());

    expect(result.nodes.map((node) => node.id)).not.toContain("src/link.ts");
    expect(result.warnings).toContainEqual({
      code: "symlink-skipped",
      count: 1,
      detail: "src/link.ts",
    });
  });

  it("reports no warnings on a clean tree", async () => {
    const root = await buildTree({ "src/main.ts": "const a = 1;\n" });

    const result = await analyze({ root }, makeConfig());

    expect(result.warnings).toEqual([]);
  });
});

describe("analyze — generated data blobs", () => {
  /** `lines` lines of JSON-ish text, so LOC is the number asked for. */
  const dataLines = (lines: number): string =>
    `${Array.from({ length: lines }, (_, index) => `  "k${index}": ${index},`).join("\n")}\n`;

  it("drops a data document longer than the threshold and counts it", async () => {
    const root = await buildTree({
      "src/main.ts": "const a = 1;\n",
      "fixtures/generated.json": dataLines(DATA_BLOB_LOC_THRESHOLD + 1),
    });

    const result = await analyze({ root }, makeConfig());

    expect(result.nodes.map((node) => node.id)).not.toContain(
      "fixtures/generated.json",
    );
    expect(result.warnings).toContainEqual({
      code: "data-blob",
      count: 1,
      detail: "fixtures/generated.json",
    });
  });

  it("keeps a data document at the threshold", async () => {
    const root = await buildTree({
      "src/main.ts": "const a = 1;\n",
      "fixtures/big-but-not-a-blob.json": dataLines(DATA_BLOB_LOC_THRESHOLD),
    });

    const result = await analyze({ root }, makeConfig());

    expect(result.nodes.map((node) => node.id)).toContain(
      "fixtures/big-but-not-a-blob.json",
    );
    expect(result.warnings).toEqual([]);
  });

  it("never drops source, however long — the rule is about data, not size", async () => {
    const root = await buildTree({
      "src/enormous.ts": `${"const a = 1;\n".repeat(DATA_BLOB_LOC_THRESHOLD + 10)}`,
    });

    const result = await analyze({ root }, makeConfig());

    expect(result.nodes.map((node) => node.id)).toContain("src/enormous.ts");
    expect(result.warnings).toEqual([]);
  });

  it("leaves the dropped blob out of module LOC, module layer and stats", async () => {
    const blobLoc = DATA_BLOB_LOC_THRESHOLD + 500;
    const root = await buildTree({
      "pkg/src/main.ts": "const a = 1;\n",
      // Same shape as this repository's own case: a generated fixture under a
      // `fixtures/` directory, which the layer rules call `test`, large enough
      // to decide its module's layer on its own.
      "pkg/fixtures/synthetic.json": dataLines(blobLoc),
    });

    const result = await analyze({ root }, makeConfig());
    const module = result.nodes.find((node) => node.kind === "module");

    expect(module?.layer).toBe("backend");
    expect(module?.loc).toBe(1);
    expect(result.stats.loc).toBe(1);
    expect(result.stats.files).toBe(1);
    expect(Object.keys(result.stats.languages)).not.toContain("json");
  });

  it("is deterministic — two runs agree, blob and all", async () => {
    const root = await buildTree({
      "src/main.ts": "const a = 1;\n",
      "fixtures/a.json": dataLines(DATA_BLOB_LOC_THRESHOLD + 1),
      "fixtures/b.yaml": dataLines(DATA_BLOB_LOC_THRESHOLD + 1),
    });

    const first = await analyze({ root }, makeConfig());
    const second = await analyze({ root }, makeConfig());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.warnings).toContainEqual({
      code: "data-blob",
      count: 2,
      detail: "fixtures/a.json",
    });
  });
});
