import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FILES_PER_MODULE,
  MODULE_COUNT,
  fromAnalysisDocument,
  generateSyntheticFixture,
} from "./fixture.js";
import { seededRng } from "./prng.js";

/**
 * The path the dev server's contractFixture plugin serves at /fixture.json.
 * Asserting against the real committed document is the point: the loader
 * silently falling back to the generator is exactly the failure this guards.
 */
const CONTRACT_FIXTURE = fileURLToPath(
  new URL(
    "../../../contract/fixtures/synthetic-100x2000.json",
    import.meta.url,
  ),
);

function loadContractFixture(): unknown {
  return JSON.parse(readFileSync(CONTRACT_FIXTURE, "utf8"));
}

describe("fromAnalysisDocument on the committed 1.3 fixture", () => {
  it("reads the yardstick document at the path the dev server serves", () => {
    const doc = fromAnalysisDocument(loadContractFixture());
    const modules = doc.nodes.filter((n) => n.kind === "module");
    const files = doc.nodes.filter((n) => n.kind === "file");
    expect(modules).toHaveLength(MODULE_COUNT);
    expect(files).toHaveLength(MODULE_COUNT * FILES_PER_MODULE);
  });

  it("keeps membership as parent, with modules parentless", () => {
    const doc = fromAnalysisDocument(loadContractFixture());
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    for (const n of doc.nodes) {
      if (n.kind === "module") {
        // The contract writes `parent: null` for modules; the spike needs
        // undefined, or every module would look like a member of nothing.
        expect(n.parent).toBeUndefined();
      } else {
        expect(n.parent).toBeDefined();
        expect(byId.get(n.parent!)?.kind).toBe("module");
      }
    }
  });

  it("carries edges at both levels, all endpoints resolvable", () => {
    const doc = fromAnalysisDocument(loadContractFixture());
    const kind = new Map(doc.nodes.map((n) => [n.id, n.kind]));
    let moduleLevel = 0;
    let fileLevel = 0;
    for (const e of doc.edges) {
      expect(kind.has(e.source)).toBe(true);
      expect(kind.has(e.target)).toBe(true);
      if (kind.get(e.source) === "module") moduleLevel++;
      else fileLevel++;
    }
    // Both levels must be present: phase (b) draws the module graph, phase (c)
    // the file imports of unfolded modules.
    expect(moduleLevel).toBeGreaterThan(0);
    expect(fileLevel).toBeGreaterThan(0);
  });

  it("rejects a document that is not an analysis document", () => {
    expect(() => fromAnalysisDocument({ nodes: [] })).toThrow(
      /not an analysis document/,
    );
  });
});

describe("generated fallback", () => {
  it("matches the yardstick's node counts so a fallback run is comparable", () => {
    const doc = generateSyntheticFixture(seededRng("gitnebula-spike"));
    expect(doc.nodes.filter((n) => n.kind === "module")).toHaveLength(
      MODULE_COUNT,
    );
    expect(doc.nodes.filter((n) => n.kind === "file")).toHaveLength(
      MODULE_COUNT * FILES_PER_MODULE,
    );
  });
});
