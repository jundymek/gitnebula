import { describe, expect, it } from "vitest";
import { hashString, seededRng } from "./prng.js";

describe("seededRng", () => {
  it("is deterministic for the same repo name", () => {
    const a = seededRng("gitnebula");
    const b = seededRng("gitnebula");
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("differs between repo names", () => {
    expect(seededRng("repo-a")()).not.toBe(seededRng("repo-b")());
  });

  it("emits values in [0, 1)", () => {
    const rng = seededRng("range-check");
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("hashString is stable", () => {
    expect(hashString("gitnebula")).toBe(hashString("gitnebula"));
  });
});
