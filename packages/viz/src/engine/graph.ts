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
  /** Indices of the module nodes — the set 2.5 simulates and draws. */
  readonly moduleIndices: readonly number[];
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
  nodes.forEach((node, index) => {
    if (node.kind !== "file" || node.parent === null) return;
    const members = membersByModule.get(node.parent);
    // A parent outside the document would be a contract violation, not
    // something to paper over — but the Viewer draws what it was given rather
    // than throwing on it, so an orphan is simply not a member of anything.
    if (members) members.push(index);
  });

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
