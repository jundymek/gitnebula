import { describe, expect, it } from "vitest";

import { formatCount, formatInteger, formatLanguages } from "./format.js";

describe("stats formatting", () => {
  it("writes large counts the way the mockup does", () => {
    expect(formatCount(412)).toBe("412");
    expect(formatCount(41_200)).toBe("41.2k");
    expect(formatCount(396_525)).toBe("396.5k");
    expect(formatCount(1_240_000)).toBe("1.2m");
    expect(formatCount(-1)).toBe("0");
  });

  it("separates thousands for the counts written out in full", () => {
    expect(formatInteger(1847)).toBe("1,847");
  });

  it("orders language shares descending and rounds to whole percents", () => {
    expect(formatLanguages({ python: 0.261, typescript: 0.739 })).toBe(
      "typescript 74% · python 26%",
    );
  });

  it("drops empty shares and caps the list", () => {
    expect(formatLanguages({ a: 0.5, b: 0.3, c: 0.2, d: 0 }, 2)).toBe(
      "a 50% · b 30%",
    );
  });

  it("says nothing when there are no languages", () => {
    expect(formatLanguages({})).toBe("");
  });
});
