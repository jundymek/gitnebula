import { describe, expect, it } from "vitest";

import { contractEdge, packageName } from "./index.js";

describe("@gitnebula/scanner", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@gitnebula/scanner");
  });

  it("resolves @gitnebula/contract (AD-2 edge)", () => {
    expect(contractEdge).toBe("@gitnebula/contract");
  });
});
