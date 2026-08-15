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
  /**
   * Ids another filter is already allowing through, or undefined for "no
   * other filter is active".
   *
   * Connected-only has to answer "does this node have an edge **in the frame**",
   * and the frame is narrowed by story 5.3's layer filter as well as by this
   * story's scope. Without this, a visible file whose only dependency sits in
   * a hidden layer survives the filter and is then drawn with no edges at all
   * — the exact thing the filter promises cannot happen — and the hidden count
   * understates by the same amount.
   *
   * Nodes removed by this restriction are **not** counted in `hiddenByDegree`:
   * they belong to the other filter's cause, and each filter names its own.
   */
  readonly restrictTo?: ReadonlySet<string>;
  /**
   * Ids that actually have a position in the current scene, or undefined for
   * "assume everything is materialised".
   *
   * Semantic zoom (ADR-0006) means a file exists in the frame only while its
   * module is unfolded. An edge to a collapsed module's file is dropped by
   * `buildScene` because one end has no position — so counting it here would
   * call a node connected and then draw it with nothing attached, which is
   * the one thing this filter promises cannot happen.
   */
  readonly materialised?: ReadonlySet<string>;
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
export function degreeOf(
  graph: Graph,
  id: string,
  /**
   * When given, only edges whose other end is also in this set are counted.
   *
   * This is what makes connected-only agree with what is actually drawn: a
   * scoped file whose single import points outside the scope has a positive
   * degree in the whole graph, but `buildScene` drops that edge because one
   * end is missing — so counting against the full graph would leave a visibly
   * edgeless node on screen under a filter whose entire promise is that there
   * are none.
   */
  candidates?: ReadonlySet<string>,
): number {
  const index = graph.indexById.get(id);
  if (index === undefined) return 0;
  const neighbours = graph.neighboursById.get(id) ?? [];
  const imports = candidates
    ? neighbours.filter((neighbour) => candidates.has(neighbour)).length
    : neighbours.length;
  if (graph.nodes[index]!.kind !== "module") return imports;
  const members = graph.membersByModule.get(id) ?? [];
  const memberCount = candidates
    ? members.filter((member) => candidates.has(graph.nodes[member]!.id)).length
    : members.length;
  return imports + memberCount;
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

  // Another filter's exclusions, applied before connectivity is judged so that
  // "has an edge" means "has an edge in the frame". Deliberately not counted:
  // this is somebody else's cause and their control states it.
  if (filter.restrictTo) {
    for (const id of [...surviving]) {
      if (!filter.restrictTo.has(id)) surviving.delete(id);
    }
  }

  // AC-3 asks two different questions and they need two different answers.
  //
  // The FRAME question — "is this node drawn with no edges?" — has to be asked
  // about what the scene can actually place. Semantic zoom (ADR-0006) means a
  // file exists only while its module is unfolded, and `buildScene` drops any
  // edge with an unplaced end; counting those would keep a node and then draw
  // it with nothing attached.
  //
  // The COUNT question — "how much of this repository carries no dependency?"
  // — is a property of the document, which is how AC-3 states its own baseline
  // ("232 of 650 files"). Answering it about the frame would print 0 at
  // overview zoom, where no files are drawn at all, and the number that makes
  // the filter worth switching on would never be seen.
  //
  // So: the count is computed over the candidates, the frame narrows further.
  const hiddenByDegree = filter.connectedOnly
    ? countEdgeless(graph, new Set(surviving))
    : 0;

  if (filter.materialised) {
    for (const id of [...surviving]) {
      if (!filter.materialised.has(id)) surviving.delete(id);
    }
  }
  if (filter.connectedOnly) countEdgeless(graph, surviving);

  return { visible: surviving, hiddenByScope, hiddenByDegree };
}

/**
 * Strip every node that carries no edge within `candidates`, mutating it, and
 * return how many went.
 *
 * Run to a fixpoint rather than in one pass: removing an edgeless node can
 * strand its only neighbour, and that neighbour is exactly what this filter
 * promises to remove too. Each round removes at least one node, so it
 * terminates in at most `candidates.size` rounds and normally in one or two.
 */
function countEdgeless(graph: Graph, candidates: Set<string>): number {
  let removed = 0;
  for (;;) {
    const stranded: string[] = [];
    for (const id of candidates) {
      if (degreeOf(graph, id, candidates) === 0) stranded.push(id);
    }
    if (stranded.length === 0) break;
    for (const id of stranded) candidates.delete(id);
    removed += stranded.length;
  }
  return removed;
}
