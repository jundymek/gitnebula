/**
 * `AnalysisDocument` → the engine's graph model.
 *
 * Pure and canvas-free, so the settle-timing, determinism and encoding tests
 * run headless. The engine adds positions on top of this; nothing here knows
 * about a camera or a context.
 */

import type { AnalysisDocument } from "@gitnebula/contract";

import {
  FILE_RADIUS_BASE,
  HOT_THRESHOLD,
  MODULE_RADIUS_BASE,
  RADIUS_LOC_DIVISOR,
} from "./constants.js";
import type { EngineNode } from "./types.js";

/** An import edge between two nodes of the same level, by graph index. */
export interface GraphEdge {
  readonly source: number;
  readonly target: number;
  readonly weight: number;
}

export interface Graph {
  /** Every node of the document, contract order preserved. */
  readonly nodes: readonly EngineNode[];
  /** Indices of the module nodes — the set ADR-0006's unfold rule ranges over. */
  readonly moduleIndices: readonly number[];
  /**
   * Indices of the repository's root files — `kind: "file"`, `parent: null`
   * (story 2.1's decision, story 4.7's case).
   */
  readonly rootFileIndices: readonly number[];
  /**
   * What the module-level layout simulates and draws: the modules **and** the
   * root files. A root file belongs to no module, so it can only be a
   * top-level node or nothing at all — and for every real repository with a
   * README, "nothing at all" was 9.5%–82% of the lines in the map (4.7).
   */
  readonly topLevelIndices: readonly number[];
  /** Module-level import edges, by index into `nodes`. */
  readonly moduleEdges: readonly GraphEdge[];
  /** File-level import edges, by index into `nodes` (story 3.3 draws them). */
  readonly fileEdges: readonly GraphEdge[];
  /** Module id → indices of its member files (story 3.3 unfolds them). */
  readonly membersByModule: ReadonlyMap<string, readonly number[]>;
  /** Node id → index into `nodes`. */
  readonly indexById: ReadonlyMap<string, number>;
  /** Node id → ids one import hop away, both directions. */
  readonly neighboursById: ReadonlyMap<string, readonly string[]>;
}

/** Rendered radius of a node in world units — ∝ √LOC (UX-DR4). */
export function nodeRadius(kind: "module" | "file", loc: number): number {
  const base = kind === "module" ? MODULE_RADIUS_BASE : FILE_RADIUS_BASE;
  return base + Math.sqrt(Math.max(0, loc)) / RADIUS_LOC_DIVISOR;
}

export function buildGraph(
  document: AnalysisDocument,
  hotThreshold: number = HOT_THRESHOLD,
): Graph {
  const indexById = new Map<string, number>();
  const nodes: EngineNode[] = document.nodes.map((node, index) => {
    indexById.set(node.id, index);
    return {
      id: node.id,
      kind: node.kind,
      parent: node.parent,
      path: node.path,
      layer: node.layer,
      loc: node.loc,
      churn: node.churn,
      commits: node.commits,
      authors: node.authors,
      lastChangedAt: node.lastChangedAt,
      description: node.description,
      hot: node.churn >= hotThreshold,
      radius: nodeRadius(node.kind, node.loc),
    };
  });

  const moduleIndices: number[] = [];
  const membersByModule = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    if (node.kind === "module") {
      moduleIndices.push(index);
      if (!membersByModule.has(node.id)) membersByModule.set(node.id, []);
    }
  });
  const rootFileIndices: number[] = [];
  nodes.forEach((node, index) => {
    if (node.kind !== "file") return;
    if (node.parent === null) {
      // A repository-root file: `setup.py`, `README.md`, `eslint.config.js`.
      // Not an orphan and not a contract violation — story 2.1 deliberately
      // leaves these parentless rather than inventing a synthetic `./` module
      // that would have to claim a layer over an arbitrary bag of files. They
      // are top-level nodes, drawn beside the modules (story 4.7).
      rootFileIndices.push(index);
      return;
    }
    const members = membersByModule.get(node.parent);
    // A parent naming a module outside the document *would* be a contract
    // violation — but the Viewer draws what it was given rather than throwing
    // on it, so such a file is simply not a member of anything.
    if (members) members.push(index);
  });
  const topLevelIndices = [...moduleIndices, ...rootFileIndices];

  const moduleEdges: GraphEdge[] = [];
  const fileEdges: GraphEdge[] = [];
  const neighbours = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const sourceNode = nodes[source]!;
    const targetNode = nodes[target]!;
    if (sourceNode.kind !== targetNode.kind) continue;
    const bucket = sourceNode.kind === "module" ? moduleEdges : fileEdges;
    bucket.push({ source, target, weight: edge.weight });
    addNeighbour(neighbours, sourceNode.id, targetNode.id);
    addNeighbour(neighbours, targetNode.id, sourceNode.id);
  }

  const neighboursById = new Map<string, readonly string[]>();
  for (const [id, set] of neighbours) neighboursById.set(id, [...set]);

  return {
    nodes,
    moduleIndices,
    rootFileIndices,
    topLevelIndices,
    moduleEdges,
    fileEdges,
    membersByModule,
    indexById,
    neighboursById,
  };
}

function addNeighbour(
  map: Map<string, Set<string>>,
  from: string,
  to: string,
): void {
  let set = map.get(from);
  if (!set) {
    set = new Set();
    map.set(from, set);
  }
  set.add(to);
}
