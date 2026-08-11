import { describe, expect, it } from "vitest";

import { contractEdge, packageName } from "./index.js";

describe("@gitnebula/viz", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@gitnebula/viz");
  });

  it("resolves @gitnebula/contract (AD-2 edge)", () => {
    expect(contractEdge).toBe("@gitnebula/contract");
  });
});
