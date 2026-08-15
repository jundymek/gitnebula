/**
 * Story 5.4's pure half: what a scope carries, what degree 0 means, and which
 * ids survive the two filters.
 *
 * No canvas and no jsdom — the whole point of putting this in its own module
 * is that AC-1, AC-3 and AC-6 are decidable from the document alone.
 */
import { describe, expect, it } from "vitest";

import { buildGraph } from "./graph.js";
import { degreeOf, inScopeIds, visibleNodeIds } from "./scope.js";
import { langgraphShapedDocument } from "../test-support/langgraph-shape.js";
import { loadContractFixture } from "../test-support/fixtures.js";

const graph = buildGraph(langgraphShapedDocument());

/**
 * The connected-only assertions need a document that actually contains
 * edgeless nodes. The langgraph-shaped one does not — story 5.1 built it so
 * every file ranks, so every file has an edge. `synthetic-100x2000` carries
 * **869 edgeless files of 2,000**, which is the same shape as AC-3's measured
 * "232 of 650 on langgraph" at the fixture scale FR-12 already uses.
 */
const bigGraph = buildGraph(loadContractFixture("synthetic-100x2000"));

/** Ids of every module in the fixture, for the "not everything" assertions. */
const moduleIds = graph.nodes
  .filter((node) => node.kind === "module")
  .map((node) => node.id);

function idsOf(kind: "module" | "file", scope: ReadonlySet<string>): string[] {
  return [...scope].filter(
    (id) => graph.nodes[graph.indexById.get(id)!]!.kind === kind,
  );
}

describe("inScopeIds — AC-1", () => {
  it("carries the focus module itself", () => {
    const focus = moduleIds[0]!;
    expect(inScopeIds(graph, focus).has(focus)).toBe(true);
  });

  it("carries every member file of the focus module", () => {
    const focus = moduleIds[0]!;
    const members = (graph.membersByModule.get(focus) ?? []).map(
      (index) => graph.nodes[index]!.id,
    );
    expect(members.length).toBeGreaterThan(0);
    const scope = inScopeIds(graph, focus);
    for (const member of members) expect(scope.has(member)).toBe(true);
  });

  it("carries the modules the focus imports or is imported by", () => {
    const focus = moduleIds[0]!;
    const neighbours = (graph.neighboursById.get(focus) ?? []).filter(
      (id) => graph.nodes[graph.indexById.get(id)!]!.kind === "module",
    );
    expect(neighbours.length).toBeGreaterThan(0);
    const scope = inScopeIds(graph, focus);
    for (const neighbour of neighbours) expect(scope.has(neighbour)).toBe(true);
  });

  it("does NOT carry a neighbour module's member files", () => {
    // The literal reading of AC-1: "that module, its member files, and the
    // modules it imports". Members attach to the focus and stop there — this
    // is what turns 662 nodes into 169 rather than into "most of them".
    const focus = moduleIds[0]!;
    const scope = inScopeIds(graph, focus);
    const neighbours = (graph.neighboursById.get(focus) ?? []).filter(
      (id) => graph.nodes[graph.indexById.get(id)!]!.kind === "module",
    );
    for (const neighbour of neighbours) {
      for (const index of graph.membersByModule.get(neighbour) ?? []) {
        expect(scope.has(graph.nodes[index]!.id)).toBe(false);
      }
    }
  });

  it("leaves unrelated modules out of the frame entirely", () => {
    const focus = moduleIds[0]!;
    const scope = inScopeIds(graph, focus);
    expect(idsOf("module", scope).length).toBeLessThan(moduleIds.length);
  });

  it("is a pure function of the document — same answer every call (AD-6)", () => {
    const focus = moduleIds[0]!;
    const once = [...inScopeIds(graph, focus)].sort();
    const twice = [...inScopeIds(buildGraph(langgraphShapedDocument()), focus)]
      .slice()
      .sort();
    expect(twice).toEqual(once);
  });

  it("returns an empty scope for an id the document does not carry", () => {
    expect(inScopeIds(graph, "nope/does-not-exist").size).toBe(0);
  });

  it("returns an empty scope for a file — only modules are drillable", () => {
    const file = graph.nodes.find((node) => node.kind === "file");
    expect(file).toBeDefined();
    expect(inScopeIds(graph, file!.id).size).toBe(0);
  });
});

describe("degreeOf — AC-3", () => {
  it("counts a file's import neighbours", () => {
    const file = graph.nodes.find(
      (node) =>
        node.kind === "file" &&
        (graph.neighboursById.get(node.id)?.length ?? 0) > 0,
    );
    expect(file).toBeDefined();
    expect(degreeOf(graph, file!.id)).toBe(
      graph.neighboursById.get(file!.id)!.length,
    );
  });

  it("is 0 for a file nothing imports and which imports nothing", () => {
    const orphan = bigGraph.nodes.find(
      (node) => node.kind === "file" && !bigGraph.neighboursById.has(node.id),
    );
    expect(orphan).toBeDefined();
    expect(degreeOf(bigGraph, orphan!.id)).toBe(0);
  });

  it("counts a module's member files as well as its import edges", () => {
    // A module with members carries module -> member edges in the frame, so
    // it is not edgeless however few modules it imports. Hiding it would take
    // its whole subtree out with it, which is not what "hide what carries no
    // edge" means to a reader.
    const withMembers = moduleIds.find(
      (id) => (graph.membersByModule.get(id) ?? []).length > 0,
    );
    expect(withMembers).toBeDefined();
    const imports = graph.neighboursById.get(withMembers!)?.length ?? 0;
    const members = graph.membersByModule.get(withMembers!)!.length;
    expect(degreeOf(graph, withMembers!)).toBe(imports + members);
  });

  it("is 0 for an id the document does not carry", () => {
    expect(degreeOf(graph, "nope/does-not-exist")).toBe(0);
  });
});

describe("visibleNodeIds — AC-3 and AC-6", () => {
  it("passes everything through when no filter is active", () => {
    const result = visibleNodeIds(graph, {
      scopeId: null,
      connectedOnly: false,
    });
    expect(result.visible.size).toBe(graph.nodes.length);
    expect(result.hiddenByScope).toBe(0);
    expect(result.hiddenByDegree).toBe(0);
  });

  it("narrows to the scope and reports how many that hid", () => {
    const focus = moduleIds[0]!;
    const result = visibleNodeIds(graph, {
      scopeId: focus,
      connectedOnly: false,
    });
    expect(result.visible).toEqual(inScopeIds(graph, focus));
    expect(result.hiddenByScope).toBe(graph.nodes.length - result.visible.size);
    expect(result.hiddenByScope).toBeGreaterThan(0);
  });

  it("drops degree-0 nodes and reports the count separately (UX-DR14)", () => {
    const result = visibleNodeIds(bigGraph, {
      scopeId: null,
      connectedOnly: true,
    });
    const edgeless = bigGraph.nodes.filter(
      (node) => degreeOf(bigGraph, node.id) === 0,
    );
    // The measured baseline this criterion exists for: a large minority of the
    // node set carries no edge at all and is currently drawn anyway.
    expect(edgeless.length).toBeGreaterThan(500);
    expect(result.hiddenByDegree).toBe(edgeless.length);
    for (const node of edgeless)
      expect(result.visible.has(node.id)).toBe(false);
  });

  it("counts degree inside the frame, not across the whole graph", () => {
    // Codex found this: a scoped file whose only import points OUTSIDE the
    // scope has a positive degree in the whole graph, but `buildScene` drops
    // that edge because one end is missing — so counting globally leaves a
    // visibly edgeless node on screen under a filter whose entire promise is
    // that there are none. Reachable in 1,131 places on this fixture alone.
    const focus = bigGraph.nodes.find((node) => node.kind === "module")!.id;
    const scope = inScopeIds(bigGraph, focus);
    const strandedByScope = [...scope].filter(
      (id) => degreeOf(bigGraph, id) > 0 && degreeOf(bigGraph, id, scope) === 0,
    );
    expect(strandedByScope.length).toBeGreaterThan(0);

    const result = visibleNodeIds(bigGraph, {
      scopeId: focus,
      connectedOnly: true,
    });
    for (const id of strandedByScope) {
      expect(result.visible.has(id)).toBe(false);
    }
  });

  it("leaves nothing edgeless behind — it runs to a fixpoint", () => {
    // One pass is not enough: removing an edgeless node can strand its only
    // neighbour, and that neighbour is exactly what this filter promises to
    // remove too.
    const focus = bigGraph.nodes.find((node) => node.kind === "module")!.id;
    const result = visibleNodeIds(bigGraph, {
      scopeId: focus,
      connectedOnly: true,
    });
    for (const id of result.visible) {
      expect(degreeOf(bigGraph, id, result.visible)).toBeGreaterThan(0);
    }
  });

  it("keeps a module that has members but imports nothing", () => {
    // The judgement call from DECISIONS.md, pinned: a module carries
    // module -> member edges in the frame, so connected-only must not delete
    // it and take its whole subtree with it.
    const withMembers = bigGraph.nodes.find(
      (node) =>
        node.kind === "module" &&
        !bigGraph.neighboursById.has(node.id) &&
        (bigGraph.membersByModule.get(node.id) ?? []).length > 0,
    );
    if (!withMembers) return; // fixture has none; the unit test above covers it
    const result = visibleNodeIds(bigGraph, {
      scopeId: null,
      connectedOnly: true,
    });
    expect(result.visible.has(withMembers.id)).toBe(true);
  });

  it("counts the two causes separately rather than as one total", () => {
    // pamela (5.3) and I agreed each filter names its own cause; within my own
    // module the same rule holds, so a reader can tell scoping from
    // connected-only instead of getting one unattributable number.
    const focus = moduleIds[0]!;
    const result = visibleNodeIds(graph, {
      scopeId: focus,
      connectedOnly: true,
    });
    const scoped = inScopeIds(graph, focus);
    expect(result.hiddenByScope).toBe(graph.nodes.length - scoped.size);
    // Degree is counted over what the scope left, never over the whole graph.
    const edgelessInScope = [...scoped].filter(
      (id) => degreeOf(graph, id) === 0,
    );
    expect(result.hiddenByDegree).toBe(edgelessInScope.length);
  });

  it("never returns an id the graph does not carry", () => {
    const result = visibleNodeIds(graph, {
      scopeId: moduleIds[0]!,
      connectedOnly: true,
    });
    for (const id of result.visible) expect(graph.indexById.has(id)).toBe(true);
  });

  it("holds on the synthetic fixture at DoD scale too", () => {
    const big = buildGraph(loadContractFixture("synthetic-100x2000"));
    const firstModule = big.nodes.find((node) => node.kind === "module")!;
    const result = visibleNodeIds(big, {
      scopeId: firstModule.id,
      connectedOnly: false,
    });
    expect(result.visible.size).toBeGreaterThan(0);
    expect(result.visible.size).toBeLessThan(big.nodes.length);
  });
});
