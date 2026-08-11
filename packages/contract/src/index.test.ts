import { describe, expect, it } from "vitest";

import { packageName } from "./index.js";

describe("@gitnebula/contract", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@gitnebula/contract");
  });
});
