import { describe, expect, it } from "vitest";

import { buildGraph } from "./graph.js";
import { ModuleLayout } from "./layout.js";
import { seededRng } from "./prng.js";
import { SETTLE_DISPLACEMENT_PX, SETTLE_FRAMES } from "./settle.js";
import { loadSyntheticFixture } from "../test-support/fixtures.js";

const FRAMES_PER_SECOND = 60;

function layoutFor(name: string, document = loadSyntheticFixture()) {
  const graph = buildGraph(document);
  return new ModuleLayout(graph, seededRng(name));
}

describe("ModuleLayout — FR-12 settle budget", () => {
  it("reaches Settled in 2–3 s on the 100-module fixture", () => {
    const document = loadSyntheticFixture();
    expect(document.nodes.filter((n) => n.kind === "module")).toHaveLength(100);

    const layout = layoutFor(document.repo.name, document);
    const frames = layout.runToSettled();

    expect(layout.timedOut).toBe(false);
    // "2–3 s" is a frame count, because the settle loop advances one tick per
    // rendered frame and the frame budget is 60 fps (FR-14).
    expect(frames).toBeGreaterThanOrEqual(2 * FRAMES_PER_SECOND);
    expect(frames).toBeLessThanOrEqual(3 * FRAMES_PER_SECOND);
  });

  it("stops on the AD-6 definition, not on an alpha threshold", () => {
    const layout = layoutFor("gitnebula");
    layout.runToSettled();
    expect(layout.lastMaxDisplacement).toBeLessThan(SETTLE_DISPLACEMENT_PX);
    expect(SETTLE_FRAMES).toBe(30);
  });

  it("simulates modules only — files wake with story 3.3's unfold", () => {
    const document = loadSyntheticFixture();
    const layout = layoutFor(document.repo.name, document);
    expect(layout.nodes).toHaveLength(100);
  });
});

describe("ModuleLayout — AD-6 determinism", () => {
  it("settles the same document into the same map every time", () => {
    const document = loadSyntheticFixture();
    const first = layoutFor(document.repo.name, document);
    const second = layoutFor(document.repo.name, document);
    first.runToSettled();
    second.runToSettled();

    expect(first.frames).toBe(second.frames);
    expect(first.nodes.map((n) => [n.id, n.x, n.y])).toEqual(
      second.nodes.map((n) => [n.id, n.x, n.y]),
    );
  });

  it("gives a differently named repository a different map", () => {
    const document = loadSyntheticFixture();
    const first = layoutFor("one", document);
    const second = layoutFor("another", document);
    first.runToSettled();
    second.runToSettled();

    expect(first.nodes.map((n) => [n.x, n.y])).not.toEqual(
      second.nodes.map((n) => [n.x, n.y]),
    );
  });

  it("handles a document with no nodes at all", () => {
    const layout = layoutFor("empty", {
      ...loadSyntheticFixture(),
      nodes: [],
      edges: [],
    });
    expect(layout.runToSettled()).toBe(1);
    expect(layout.bounds()).toBeNull();
  });
});
