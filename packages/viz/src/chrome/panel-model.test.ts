import { describe, expect, it } from "vitest";

import type { AnalysisDocument } from "@gitnebula/contract";

import { buildPanelModel, topCochanges } from "./panel-model.js";
import { engineNodeFrom } from "../test-support/engine-nodes.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function withRemote(
  document: AnalysisDocument,
  remoteUrl: string | null,
): AnalysisDocument {
  return { ...document, repo: { ...document.repo, remoteUrl } };
}

describe("panel model — a module (AC-1)", () => {
  const document_ = loadSyntheticFixture();
  const model = buildPanelModel(
    document_,
    engineNodeFrom(document_, "mod-000/"),
    { now: NOW },
  );

  it("heads with the module id, its path and `kind · layer`", () => {
    expect(model.name).toBe("mod-000/");
    expect(model.path).toBe("mod-000/");
    expect(model.kindLine).toBe("module · backend");
  });

  it("prints the mockup's rows in the mockup's order", () => {
    expect(model.rows.map((row) => row.label)).toEqual([
      "files",
      "loc",
      // The window is the document's, not the mockup's hardcoded 90 — the
      // synthetic fixture analyses a full year.
      `churn ${document_.repo.analysisWindowDays}d`,
      "authors",
      "last change",
      "co-changes with",
    ]);
  });

  it("counts member files from `parent`, the contract's only membership", () => {
    expect(model.rows[0]!.value).toBe("20");
  });

  it("formats loc for the locale and churn as a whole percent", () => {
    expect(model.rows[1]!.value).toBe("3,072");
    expect(model.rows[2]!.value).toBe("99%");
    expect(model.churnPercent).toBe("99%");
  });

  it("marks the hot badge from the engine's own threshold verdict", () => {
    expect(model.hot).toBe(true);
    expect(
      buildPanelModel(document_, engineNodeFrom(document_, "mod-000/", 1.5), {
        now: NOW,
      }).hot,
    ).toBe(false);
  });

  it("names the top three co-changing modules with their counts", () => {
    const partners = topCochanges(
      document_,
      engineNodeFrom(document_, "mod-000/"),
    );
    expect(partners).toHaveLength(3);
    // Descending by count; the contract's own pairs, only selected and sorted.
    const counts = partners.map((partner) => partner.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    for (const partner of partners) {
      expect(partner.id.startsWith("mod-")).toBe(true);
      expect(partner.id).not.toBe("mod-000/");
    }
    expect(model.rows[5]!.value).toBe(
      partners.map((partner) => `${partner.id} ${partner.count}`).join(" · "),
    );
  });
});

describe("panel model — a file (AC-1)", () => {
  const document_ = loadSyntheticFixture();
  const model = buildPanelModel(
    document_,
    engineNodeFrom(document_, "mod-000/file-00.ts"),
    { now: NOW },
  );

  it("heads with the basename but keeps the full path", () => {
    expect(model.name).toBe("file-00.ts");
    expect(model.path).toBe("mod-000/file-00.ts");
    expect(model.kindLine).toBe("file · backend");
  });

  it("prints an em dash for the files row — a file has no members", () => {
    expect(model.rows[0]!.value).toBe("—");
  });

  it("pairs a file only with files, never with modules", () => {
    // Rolling a file's partners up to module level would be an aggregation
    // computed in viz, which AD-1 puts in the pipeline or nowhere.
    const partners = topCochanges(
      document_,
      engineNodeFrom(document_, "mod-005/file-04.ts"),
    );
    expect(partners.length).toBeGreaterThan(0);
    for (const partner of partners) {
      expect(partner.id).toMatch(/\/file-/);
    }
  });
});

describe("panel model — documents with nothing to say", () => {
  it("prints em dashes for a node with no history and no partners", () => {
    const document_ = loadContractFixture("zero-history");
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "core/"),
      { now: NOW },
    );
    expect(model.rows[3]!.value).toBe("0");
    expect(model.rows[4]!.value).toBe("—");
    expect(model.rows[5]!.value).toBe("—");
    expect(model.churnPercent).toBe("0%");
    expect(model.hot).toBe(false);
  });

  it("names the churn window from the document, never from a constant", () => {
    const document_ = loadContractFixture("single-module");
    const windowed: AnalysisDocument = {
      ...document_,
      repo: { ...document_.repo, analysisWindowDays: 30 },
    };
    const model = buildPanelModel(windowed, engineNodeFrom(windowed, "app/"), {
      now: NOW,
    });
    expect(model.rows[2]!.label).toBe("churn 30d");
  });
});

describe("panel model — the GitHub link (AC-3)", () => {
  const document_ = loadContractFixture("single-module");

  it("is null when the document has no remote", () => {
    // Every committed fixture ships `remoteUrl: null`, so this is also the
    // state the dev server shows.
    expect(document_.repo.remoteUrl).toBeNull();
    expect(
      buildPanelModel(document_, engineNodeFrom(document_, "app/"), {
        now: NOW,
      }).githubUrl,
    ).toBeNull();
  });

  it("is a tree URL for a module on a GitHub remote", () => {
    const remote = withRemote(
      document_,
      "git@github.com:jundymek/gitnebula.git",
    );
    expect(
      buildPanelModel(remote, engineNodeFrom(remote, "app/"), { now: NOW })
        .githubUrl,
    ).toBe("https://github.com/jundymek/gitnebula/tree/main/app");
  });

  it("is null for a remote that is not GitHub", () => {
    const remote = withRemote(document_, "https://gitlab.com/o/r.git");
    expect(
      buildPanelModel(remote, engineNodeFrom(remote, "app/"), { now: NOW })
        .githubUrl,
    ).toBeNull();
  });
});
