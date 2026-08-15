/**
 * Test-only: a **langgraph-shaped** document for story 5.1's AC-2.
 *
 * AC-2 asks for "the langgraph fixture (or an equivalent multi-package Python
 * repo)". The repository ships no langgraph fixture, and adding one to
 * `packages/contract/fixtures/` would make a story whose first constraint is
 * "zero contract change" edit the contract package — so the document is built
 * here, in `viz`, where the ranking that consumes it lives.
 *
 * The shape reproduces what story 5.1 measured on a real langgraph checkout,
 * scaled down but with the same three answers:
 *
 * - a type module every package imports (`langgraph/typing.py`) heads **core**
 * - a `__main__` nobody imports heads **entry points**
 * - the widest-importing test (`tests/test_pregel.py`) heads
 *   **tests as documentation**
 *
 * It is a plain builder rather than a JSON file so the degree counts are
 * derivable by reading it, and it deliberately contains the traps the ranking
 * has to survive: module-level edges alongside file-level ones, a test file
 * that is imported by another test, and a tie that only `id` can break.
 */

import type {
  AnalysisDocument,
  AnalysisEdge,
  AnalysisNode,
  Layer,
} from "@gitnebula/contract";

interface FileSpec {
  readonly path: string;
  readonly layer: Layer;
  readonly imports: readonly string[];
}

/**
 * The file set. `imports` are file ids, so every in-degree in the assertions
 * below is countable by eye from this table.
 */
const FILES: readonly FileSpec[] = [
  // --- langgraph/ : the library ------------------------------------------
  { path: "langgraph/typing.py", layer: "backend", imports: [] },
  {
    path: "langgraph/pregel.py",
    layer: "backend",
    imports: ["langgraph/typing.py", "langgraph/channels.py"],
  },
  {
    path: "langgraph/channels.py",
    layer: "backend",
    imports: ["langgraph/typing.py"],
  },
  {
    path: "langgraph/graph.py",
    layer: "backend",
    imports: ["langgraph/typing.py", "langgraph/pregel.py"],
  },
  {
    path: "langgraph/checkpoint.py",
    layer: "backend",
    imports: ["langgraph/typing.py"],
  },
  // --- bench/ : a second package, and the entry points --------------------
  {
    path: "bench/__main__.py",
    layer: "other",
    imports: [
      "langgraph/graph.py",
      "langgraph/pregel.py",
      "langgraph/checkpoint.py",
      "bench/runner.py",
    ],
  },
  {
    path: "bench/runner.py",
    layer: "other",
    imports: ["langgraph/graph.py", "langgraph/typing.py"],
  },
  // `setup.py` imports one thing and is imported by nothing: a second entry
  // point, below `__main__` on out-degree.
  { path: "setup.py", layer: "infra", imports: ["langgraph/typing.py"] },
  // --- tests/ : the test layer -------------------------------------------
  {
    path: "tests/test_pregel.py",
    layer: "test",
    imports: [
      "langgraph/pregel.py",
      "langgraph/channels.py",
      "langgraph/typing.py",
      "tests/conftest.py",
    ],
  },
  {
    path: "tests/test_graph.py",
    layer: "test",
    imports: ["langgraph/graph.py", "tests/conftest.py"],
  },
  // Imported by both tests, imports nothing: in-degree 2, out-degree 0. It is
  // a test file with an entry point's degree signature, which is exactly the
  // case that catches a category filter written in the wrong order.
  { path: "tests/conftest.py", layer: "test", imports: [] },
];

/** Directory groupings, derived from the file paths like the scanner's. */
const MODULES: readonly { readonly id: string; readonly layer: Layer }[] = [
  { id: "langgraph/", layer: "backend" },
  { id: "bench/", layer: "other" },
  { id: "tests/", layer: "test" },
];

function moduleOf(path: string): string | null {
  const slash = path.indexOf("/");
  return slash === -1 ? null : `${path.slice(0, slash + 1)}`;
}

function fileNode(spec: FileSpec, index: number): AnalysisNode {
  return {
    id: spec.path,
    kind: "file",
    parent: moduleOf(spec.path),
    path: spec.path,
    layer: spec.layer,
    loc: 40 + index * 7,
    churn: 0.1,
    commits: 3,
    authors: 1,
    lastChangedAt: "2026-01-01T00:00:00.000Z",
    description: null,
    descriptionSource: null,
  };
}

function moduleNode(id: string, layer: Layer): AnalysisNode {
  return {
    id,
    kind: "module",
    parent: null,
    path: id,
    layer,
    loc: 200,
    churn: 0.2,
    commits: 9,
    authors: 2,
    lastChangedAt: "2026-01-01T00:00:00.000Z",
    description: null,
    descriptionSource: null,
  };
}

/** Module-level edges, the ones a file's degree must NOT count (D3). */
function moduleEdges(): AnalysisEdge[] {
  // Nested maps rather than one joined string key: no separator is guaranteed
  // absent from a module id, and a joined key is how a fixture quietly grows an
  // edge nobody wrote.
  const pairs = new Map<string, Map<string, number>>();
  for (const file of FILES) {
    const from = moduleOf(file.path);
    for (const target of file.imports) {
      const to = moduleOf(target);
      if (from === null || to === null || from === to) continue;
      const targets = pairs.get(from) ?? new Map<string, number>();
      targets.set(to, (targets.get(to) ?? 0) + 1);
      pairs.set(from, targets);
    }
  }
  return [...pairs].flatMap(([source, targets]) =>
    [...targets].map(([target, weight]) => ({
      source,
      target,
      kind: "import" as const,
      weight,
    })),
  );
}

/**
 * A langgraph-shaped analysis document. Nodes and edges are sorted the way the
 * contract requires (ADR-0005), so it is a faithful stand-in for a real one.
 */
export function langgraphShapedDocument(): AnalysisDocument {
  const nodes: AnalysisNode[] = [
    ...MODULES.map((module) => moduleNode(module.id, module.layer)),
    ...FILES.map(fileNode),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const fileEdges: AnalysisEdge[] = FILES.flatMap((file) =>
    file.imports.map((target) => ({
      source: file.path,
      target,
      kind: "import" as const,
      weight: 1,
    })),
  );

  const edges = [...fileEdges, ...moduleEdges()].sort((a, b) =>
    a.source === b.source
      ? a.target < b.target
        ? -1
        : a.target > b.target
          ? 1
          : 0
      : a.source < b.source
        ? -1
        : 1,
  );

  return {
    schemaVersion: "1.0",
    repo: {
      name: "fixture-langgraph-shape",
      remoteUrl: null,
      analyzedAt: "2026-01-01T00:00:00.000Z",
      defaultBranch: "main",
      analysisWindowDays: 90,
      stats: {
        files: FILES.length,
        loc: 900,
        commits: 120,
        languages: { python: FILES.length },
      },
    },
    nodes,
    edges,
    cochanges: [],
  };
}

/**
 * The same repository with its test layer removed — AC-5's "a repository with
 * no test files" case, kept beside the document it is derived from.
 */
export function langgraphShapedWithoutTests(): AnalysisDocument {
  const document = langgraphShapedDocument();
  const dropped = new Set(
    document.nodes
      .filter((node) => node.layer === "test")
      .map((node) => node.id),
  );
  return {
    ...document,
    nodes: document.nodes.filter((node) => !dropped.has(node.id)),
    edges: document.edges.filter(
      (edge) => !dropped.has(edge.source) && !dropped.has(edge.target),
    ),
  };
}
