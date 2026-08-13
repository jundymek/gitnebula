/**
 * Test-only: an `EngineNode` for chrome tests, without booting an engine.
 *
 * Chrome receives `EngineNode`s through the `select` event, so its tests need
 * the shape rather than the simulation. The two derived fields are computed
 * the way `engine/graph.ts` computes them — `hot` from the threshold, the
 * radius from √LOC — so a chrome test cannot pass against a node the engine
 * would never hand it.
 */

import type { AnalysisDocument } from "@gitnebula/contract";

import { HOT_THRESHOLD, type EngineNode } from "../engine/index.js";

export function engineNodeFrom(
  document: AnalysisDocument,
  id: string,
  hotThreshold: number = HOT_THRESHOLD,
): EngineNode {
  const node = document.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`test fixture has no node ${id}`);
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
    radius: node.kind === "module" ? 7 + Math.sqrt(node.loc) / 11 : 1.5,
  };
}
