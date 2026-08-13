import { describe, expect, it } from "vitest";

import * as scanner from "./index.js";

// The package's public surface is what cli codes against (AD-3). This test
// exists so that removing or renaming a member is a deliberate, visible act.
describe("@gitnebula/scanner public surface", () => {
  it("exports the single analyzer entry", () => {
    expect(typeof scanner.analyze).toBe("function");
    expect(scanner.analyze.length).toBeGreaterThanOrEqual(2);
  });

  it("exports the exclude and layer rule data cli resolves against", () => {
    expect(scanner.DEFAULT_EXCLUDES.length).toBeGreaterThan(0);
    expect(scanner.LAYER_RULES.length).toBeGreaterThan(0);
  });

  it("keeps the 1.1 scaffold seam alive for the cli stub until 2.4 drops it", () => {
    expect(scanner.packageName).toBe("@gitnebula/scanner");
  });

  it("exports the module derivation thresholds it was tuned to", () => {
    expect(scanner.DESCENT_THRESHOLD).toBe(0.7);
    expect(scanner.MAX_MODULE_DEPTH).toBe(2);
  });
});
