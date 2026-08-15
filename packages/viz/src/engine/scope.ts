/**
 * Story 5.4's pure half: which nodes a frame carries.
 *
 * **Scoping is a frame concern, not a layout concern.** The simulation keeps
 * running on the whole graph; this module decides what the built scene and the
 * pick loop are allowed to see. That separation is what makes leaving a scope
 * instant and guarantees the settle is never re-run (AC-4) — there is nothing
 * here to tear down or rebuild.
 *
 * Everything is a pure function of the graph, so AC-1, AC-3 and AC-6 are
 * decidable without a canvas, and determinism (AD-6) holds by construction:
 * no clock, no RNG, and no dependence on the order a caller happens to iterate.
 */

import type { Graph } from "./graph.js";

/** The active filters, as the engine holds them. */
export interface SceneFilter {
  /** Module the map is scoped to, or null for the whole repository. */
  readonly scopeId: string | null;
  /** Drop nodes that carry no edge at all (AC-3). */
  readonly connectedOnly: boolean;
}

/** What survived, and what each cause removed — never one merged total. */
export interface VisibleNodes {
  readonly visible: ReadonlySet<string>;
  /** Removed because they fell outside the active scope. */
  readonly hiddenByScope: number;
  /**
   * Removed because their degree is 0. Counted over what the scope left, not
   * over the whole graph — the two causes are reported separately so a reader
   * can tell them apart (UX-DR14), and they are deliberately not additive.
   */
  readonly hiddenByDegree: number;
}

/**
 * The id set a scope carries: the focus module, its member files, and the
 * modules it actually imports or is imported by (AC-1).
 *
 * A neighbour module is in scope; **its members are not**. That is the literal
 * reading of AC-1 — "that module, its member files, and the modules it
 * imports" attaches the files to the focus and stops — and it is what makes
 * the reduction real: on the spec's measurement a scope takes 662 nodes down
 * to 169, a ratio that only holds while neighbours stay collapsed.
 *
 * Returns an empty set for anything that is not a module in this document.
 * Only a module is drillable: a file has no members to reveal, and scoping to
 * one would leave a frame of exactly one node.
 */
export function inScopeIds(graph: Graph, focusId: string): ReadonlySet<string> {
  const index = graph.indexById.get(focusId);
  if (index === undefined) return new Set();
  if (graph.nodes[index]!.kind !== "module") return new Set();

  const scope = new Set<string>([focusId]);
  for (const memberIndex of graph.membersByModule.get(focusId) ?? []) {
    scope.add(graph.nodes[memberIndex]!.id);
  }
  for (const neighbourId of graph.neighboursById.get(focusId) ?? []) {
    const neighbourIndex = graph.indexById.get(neighbourId);
    if (neighbourIndex === undefined) continue;
    // Module neighbours only. `neighboursById` mixes both levels, and a file
    // one hop from the focus module would arrive here without its module.
    if (graph.nodes[neighbourIndex]!.kind !== "module") continue;
    scope.add(neighbourId);
  }
  return scope;
}

/**
 * How many edges a node carries **in the drawn frame** — which is not the same
 * question as how many imports it declares.
 *
 * For a file it is its import neighbours. For a module it is its import
 * neighbours **plus its member files**, because `buildScene` draws a
 * module → member edge for every member: a module with twenty files and no
 * imports is not edgeless, and hiding it would take its whole subtree out of
 * the frame with it. AC-3's own measurement counts files (232 of 650), so the
 * module case is the one the criterion leaves to judgement — recorded in
 * `DECISIONS.md`.
 */
export function degreeOf(graph: Graph, id: string): number {
  const index = graph.indexById.get(id);
  if (index === undefined) return 0;
  const imports = graph.neighboursById.get(id)?.length ?? 0;
  if (graph.nodes[index]!.kind !== "module") return imports;
  return imports + (graph.membersByModule.get(id) ?? []).length;
}

/**
 * The one place the two filters are applied, consulted by both the scene
 * builder and the pick loop — so a node that is not drawn is also not
 * hoverable and not clickable (AC-6). Two callers reading two different
 * predicates is exactly how "absent, not dimmed" quietly becomes "absent to
 * look at, present to the pointer".
 */
export function visibleNodeIds(
  graph: Graph,
  filter: SceneFilter,
): VisibleNodes {
  const total = graph.nodes.length;

  const surviving: Set<string> =
    filter.scopeId === null
      ? new Set(graph.nodes.map((node) => node.id))
      : new Set(inScopeIds(graph, filter.scopeId));
  const hiddenByScope = total - surviving.size;

  let hiddenByDegree = 0;
  if (filter.connectedOnly) {
    for (const id of [...surviving]) {
      if (degreeOf(graph, id) === 0) {
        surviving.delete(id);
        hiddenByDegree += 1;
      }
    }
  }

  return { visible: surviving, hiddenByScope, hiddenByDegree };
}
