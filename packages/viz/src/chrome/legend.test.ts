// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { AnalysisDocument } from "@gitnebula/contract";

import {
  coldFileCount,
  isMostlyCold,
  LEGEND_ENTRIES,
  MOSTLY_COLD_SHARE,
  renderLegend,
} from "./legend.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

function withChurn(
  document_: AnalysisDocument,
  churnByIndex: (index: number) => number,
): AnalysisDocument {
  let fileIndex = -1;
  return {
    ...document_,
    nodes: document_.nodes.map((node) => {
      if (node.kind !== "file") return node;
      fileIndex++;
      return { ...node, churn: churnByIndex(fileIndex) };
    }),
  };
}

describe("legend — the layer keys (UX-DR2)", () => {
  it("keys every colour the canvas can draw in structure mode", () => {
    const handle = renderLegend(loadSyntheticFixture());
    const labels = [...handle.element.querySelectorAll("span")]
      .filter((row) => row.querySelector(".dot"))
      .map((row) => row.textContent);
    expect(labels).toEqual(LEGEND_ENTRIES.map((entry) => entry.label));
  });
});

describe("legend — counting the cold files (AD-1)", () => {
  it("counts files only, because modules inherit their members' churn", () => {
    const document_ = loadContractFixture("zero-history");
    const { zero, total } = coldFileCount(document_);
    // The fixture has one module and two files; counting the module too would
    // count the same quiet code twice.
    expect(total).toBe(2);
    expect(zero).toBe(2);
  });

  it("reads a repository with real churn as not mostly cold", () => {
    expect(isMostlyCold(loadSyntheticFixture())).toBe(false);
  });

  it("needs a strict majority of files at zero churn", () => {
    const base = loadSyntheticFixture();
    const { total } = coldFileCount(base);
    const half = Math.floor(total * MOSTLY_COLD_SHARE);

    // Exactly half cold is not "mostly" — the ramp still carries variation.
    expect(isMostlyCold(withChurn(base, (i) => (i < half ? 0 : 0.8)))).toBe(
      false,
    );
    // One more than half is.
    expect(isMostlyCold(withChurn(base, (i) => (i <= half ? 0 : 0.8)))).toBe(
      true,
    );
  });

  it("does not divide by zero on a document with no files", () => {
    const base = loadContractFixture("zero-history");
    const noFiles: AnalysisDocument = {
      ...base,
      nodes: base.nodes.filter((node) => node.kind !== "file"),
    };
    expect(isMostlyCold(noFiles)).toBe(false);
    expect(() => renderLegend(noFiles)).not.toThrow();
  });
});

describe("legend — the near-uniform heatmap says so (AC-4)", () => {
  it("names the case with its count, in heat mode only", () => {
    const document_ = loadContractFixture("zero-history");
    const handle = renderLegend(document_);
    const notice = handle.element.querySelector<HTMLElement>(".legend-notice")!;

    // Structure mode colours by layer, where a cold node is unremarkable.
    handle.setMode("structure");
    expect(notice.hidden).toBe(true);

    handle.setMode("heat");
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain(
      "2 of 2 files unchanged in the last 365 days",
    );
    // The exit, so a flat canvas is something the reader can act on.
    expect(notice.textContent).toContain("--window-days");
  });

  it("takes the window from the document, never from a literal", () => {
    const base = loadContractFixture("zero-history");
    const document_: AnalysisDocument = {
      ...base,
      repo: { ...base.repo, analysisWindowDays: 7 },
    };
    const handle = renderLegend(document_);
    handle.setMode("heat");
    const notice = handle.element.querySelector(".legend-notice")!;
    expect(notice.textContent).toContain("in the last 7 days");
    expect(notice.textContent).not.toContain("90");
  });

  it("draws no notice at all for a repository with real churn", () => {
    const handle = renderLegend(loadSyntheticFixture());
    handle.setMode("heat");
    // Absent, not hidden: a legend key for a case that does not apply is
    // clutter the reader has to rule out.
    expect(handle.element.querySelector(".legend-notice")).toBeNull();
  });

  it("survives repeated mode switches without accumulating elements", () => {
    const handle = renderLegend(loadContractFixture("zero-history"));
    for (let i = 0; i < 5; i++) {
      handle.setMode("heat");
      handle.setMode("structure");
    }
    expect(handle.element.querySelectorAll(".legend-notice")).toHaveLength(1);
  });
});
