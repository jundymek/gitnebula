import { describe, expect, it } from "vitest";

import { packageName, pipelineEdges } from "./index.js";

describe("@gitnebula/cli", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@gitnebula/cli");
  });

  it("resolves all four pipeline packages (AD-2 edges)", () => {
    expect(pipelineEdges).toEqual([
      "@gitnebula/contract",
      "@gitnebula/scanner",
      "@gitnebula/deps",
      "@gitnebula/githist",
    ]);
  });
});
