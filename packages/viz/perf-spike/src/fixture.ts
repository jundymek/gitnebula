/**
 * Fixture source for the spike.
 *
 * The story's yardstick is story 1.3's committed synthetic
 * 100-module/2,000-file document, served at `/fixture.json` by the dev server
 * (see vite.config.ts — it lives in the contract package, outside this Vite
 * root). The seeded generator below is kept only as a last-resort fallback so
 * the harness still runs if that wiring breaks; which source produced a run is
 * recorded in the results and stated in the report, and a fallback run is not
 * the story's evidence.
 */

import type { Rng } from "./prng.js";

/** ADR-0005 subset the spike needs: membership by `parent`, edges both levels. */
export interface FixtureNode {
  id: string;
  kind: "module" | "file";
  parent?: string;
}

export interface FixtureEdge {
  source: string;
  target: string;
}

export interface FixtureDoc {
  nodes: FixtureNode[];
  edges: FixtureEdge[];
}

export type FixtureSource = "contract-fixture" | "generated-fallback";

export interface LoadedFixture extends FixtureDoc {
  source: FixtureSource;
}

export const MODULE_COUNT = 100;
export const FILES_PER_MODULE = 20; // 100 x 20 = 2,000 files

/**
 * Seeded stand-in for the 1.3 synthetic document: 100 modules, 2,000 files,
 * a sparse module-level import graph and file-level imports concentrated
 * inside modules (the shape ADR-0005 describes and real repos exhibit).
 */
export function generateSyntheticFixture(rng: Rng): FixtureDoc {
  const nodes: FixtureNode[] = [];
  const edges: FixtureEdge[] = [];

  for (let m = 0; m < MODULE_COUNT; m++) {
    const moduleId = `m${m}`;
    nodes.push({ id: moduleId, kind: "module" });
    for (let f = 0; f < FILES_PER_MODULE; f++) {
      nodes.push({ id: `${moduleId}/f${f}`, kind: "file", parent: moduleId });
    }
  }

  // Module-level edges: ~3 outgoing per module, no self-edges.
  for (let m = 0; m < MODULE_COUNT; m++) {
    for (let k = 0; k < 3; k++) {
      const target = Math.floor(rng() * MODULE_COUNT);
      if (target !== m) edges.push({ source: `m${m}`, target: `m${target}` });
    }
  }

  // File-level edges: ~2 per file, 80% intra-module, 20% crossing modules.
  for (let m = 0; m < MODULE_COUNT; m++) {
    for (let f = 0; f < FILES_PER_MODULE; f++) {
      const source = `m${m}/f${f}`;
      for (let k = 0; k < 2; k++) {
        const crossModule = rng() < 0.2;
        const tm = crossModule ? Math.floor(rng() * MODULE_COUNT) : m;
        const tf = Math.floor(rng() * FILES_PER_MODULE);
        const target = `m${tm}/f${tf}`;
        if (target !== source) edges.push({ source, target });
      }
    }
  }

  return { nodes, edges };
}

/** Shapes a contract `analysis.json` into the subset the spike simulates. */
export function fromAnalysisDocument(doc: unknown): FixtureDoc {
  const d = doc as {
    nodes?: {
      id: string;
      kind?: string;
      type?: string;
      parent?: string | null;
    }[];
    edges?: { source: string; target: string }[];
  };
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) {
    throw new Error(
      "fixture is not an analysis document (missing nodes/edges)",
    );
  }
  return {
    nodes: d.nodes.map((n) => ({
      id: n.id,
      kind: (n.kind ?? n.type) === "module" ? "module" : "file",
      parent: n.parent ?? undefined,
    })),
    edges: d.edges.map((e) => ({ source: e.source, target: e.target })),
  };
}

export async function loadFixture(rng: Rng): Promise<LoadedFixture> {
  try {
    const res = await fetch("./fixture.json");
    if (res.ok) {
      return {
        ...fromAnalysisDocument(await res.json()),
        source: "contract-fixture",
      };
    }
  } catch {
    // fall through to the generator
  }
  console.error(
    "SPIKE_INVALID: /fixture.json did not load, falling back to the seeded " +
      "generator. Story 1.3's committed document is the yardstick — check the " +
      "contractFixture plugin in vite.config.ts. These numbers are not evidence.",
  );
  return { ...generateSyntheticFixture(rng), source: "generated-fallback" };
}
