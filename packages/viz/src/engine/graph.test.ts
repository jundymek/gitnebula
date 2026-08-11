import { describe, expect, it } from "vitest";

import { buildGraph, nodeRadius } from "./graph.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

describe("buildGraph", () => {
  it("keeps every contract node and separates the module set", () => {
    const document = loadSyntheticFixture();
    const graph = buildGraph(document);
    expect(graph.nodes).toHaveLength(document.nodes.length);
    expect(graph.moduleIndices).toHaveLength(100);
    expect(graph.nodes.map((node) => node.id)).toEqual(
      document.nodes.map((node) => node.id),
    );
  });

  it("splits import edges by level and never mixes the two", () => {
    const graph = buildGraph(loadSyntheticFixture());
    expect(graph.moduleEdges.length).toBeGreaterThan(0);
    expect(graph.fileEdges.length).toBeGreaterThan(0);
    for (const edge of graph.moduleEdges) {
      expect(graph.nodes[edge.source]!.kind).toBe("module");
      expect(graph.nodes[edge.target]!.kind).toBe("module");
    }
  });

  it("indexes members by their parent module (story 3.3 unfolds these)", () => {
    const graph = buildGraph(loadSyntheticFixture());
    const members = graph.membersByModule.get("mod-000/");
    expect(members).toHaveLength(20);
    for (const index of members ?? []) {
      expect(graph.nodes[index]!.parent).toBe("mod-000/");
    }
  });

  it("marks hot spots against the configured threshold", () => {
    const document = loadSyntheticFixture();
    const strict = buildGraph(document, 0.9);
    const loose = buildGraph(document, 0.1);
    const hot = (graph: ReturnType<typeof buildGraph>) =>
      graph.nodes.filter((node) => node.hot).length;
    expect(hot(strict)).toBeLessThan(hot(loose));
    expect(strict.nodes.every((node) => !node.hot || node.churn >= 0.9)).toBe(
      true,
    );
  });

  it("builds a one-hop neighbourhood in both directions", () => {
    const graph = buildGraph(loadContractFixture("cyclic-imports"));
    for (const [id, neighbours] of graph.neighboursById) {
      for (const neighbour of neighbours) {
        expect(graph.neighboursById.get(neighbour)).toContain(id);
      }
    }
  });

  it("survives the edge-case fixtures the contract ships", () => {
    for (const name of [
      "empty-graph",
      "single-module",
      "module-zero-files",
      "zero-history",
    ]) {
      const graph = buildGraph(loadContractFixture(name));
      expect(graph.nodes.every((node) => Number.isFinite(node.radius))).toBe(
        true,
      );
    }
  });
});

describe("nodeRadius", () => {
  it("never returns NaN for a zero-LOC node", () => {
    expect(nodeRadius("module", 0)).toBe(7);
    expect(nodeRadius("file", 0)).toBe(1.5);
  });
});
