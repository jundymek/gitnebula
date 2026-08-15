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
      // Story 3.4's `co-changes with` row is deliberately gone: story 5.6
      // folds it into the blast-radius section, which names the same three
      // partners first and adds the counts, the rest of the list and a way to
      // navigate there. Two renderings of one datum in one panel is the
      // duplication that story was told to reconcile.
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
    // Story 5.6: the summary is the head of the section's list, not a second
    // derivation beside it. One ordering feeds both, so they cannot disagree.
    expect(partners).toEqual(model.blastRadius.partners.slice(0, 3));
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
  it("says the repository was quiet rather than printing a bare dash", () => {
    const document_ = loadContractFixture("zero-history");
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "core/"),
      { now: NOW },
    );
    expect(model.rows[3]!.value).toBe("0");
    // Story 5.5: `—` said "the tool has nothing"; this says "the repository
    // was quiet", which is the truth and the whole point of the story.
    expect(model.rows[4]!.value).toBe("no change in last 365 days");
    expect(model.rows[4]!.empty).toBe(true);
    // Story 5.6: a repository with no commits in the window has no co-change
    // anywhere, and the panel-level notice above already says so. The section
    // adds nothing rather than repeating it per node (5.5's precedence rule).
    expect(model.blastRadius.partners).toEqual([]);
    expect(model.blastRadius.suppressed).toBe(true);
    expect(model.blastRadius.empty).toBeNull();
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

describe("panel model — the analysis window is data, never a literal (AC-1)", () => {
  // Every committed fixture analyses a full year, so a window of 90 appearing
  // anywhere in the output would have to have been hardcoded.
  const document_ = loadContractFixture("single-module");

  it("captions the history rows with the document's window", () => {
    expect(document_.repo.analysisWindowDays).not.toBe(90);
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "app/"),
      {
        now: NOW,
      },
    );
    expect(model.windowDays).toBe(365);
    expect(model.historyCaption).toBe("history · last 365 days");
  });

  it("marks exactly the rows the window applies to", () => {
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "app/"),
      {
        now: NOW,
      },
    );
    const history = model.rows
      .filter((row) => row.history)
      .map((row) => row.label);
    // `files` and `loc` are properties of the tree at HEAD; the rest are
    // measured over the window and must say so.
    expect(history).toEqual(["churn 365d", "authors", "last change"]);
    // The window travels with the co-change counts too — they are commits
    // inside it, and the section's caption is where it now says so (5.6).
    expect(model.blastRadius.caption).toContain("last 365 days");
  });

  it("follows a reconfigured window everywhere it states one", () => {
    const windowed: AnalysisDocument = {
      ...document_,
      repo: { ...document_.repo, analysisWindowDays: 14 },
    };
    const model = buildPanelModel(windowed, engineNodeFrom(windowed, "app/"), {
      now: NOW,
    });
    expect(model.windowDays).toBe(14);
    expect(model.historyCaption).toBe("history · last 14 days");
    expect(model.rows[2]!.label).toBe("churn 14d");
  });
});

describe("panel model — the empty states (AC-2, AC-3)", () => {
  it("offers --window-days as the exit for an out-of-window node (AC-2)", () => {
    // A repository WITH history, holding one node that has none — the case
    // AC-2 is about, and the one that dominates a real checkout: 386 of 650
    // files on a langgraph clone are in exactly this state.
    const base = loadContractFixture("single-module");
    const quietNode = base.nodes.find((node) => node.kind === "file")!;
    const document_: AnalysisDocument = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === quietNode.id ? { ...node, lastChangedAt: null } : node,
      ),
    };

    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, quietNode.id),
      { now: NOW },
    );

    expect(model.notice).not.toBeNull();
    expect(model.notice!.kind).toBe("node-out-of-window");
    expect(model.notice!.cause).toBe("no change in last 365 days");
    expect(model.notice!.exit).toContain("--window-days");
  });

  it("is silent for a node that does have history in the window", () => {
    const document_ = loadContractFixture("single-module");
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "app/"),
      {
        now: NOW,
      },
    );
    expect(model.notice).toBeNull();
    expect(model.rows.some((row) => row.empty)).toBe(false);
  });

  it("states the zero-history repository once, not per node (AC-3)", () => {
    const document_ = loadContractFixture("zero-history");
    expect(document_.repo.stats.commits).toBe(0);

    for (const node of document_.nodes) {
      const model = buildPanelModel(
        document_,
        engineNodeFrom(document_, node.id),
        {
          now: NOW,
        },
      );
      // Every node in this document also has `lastChangedAt: null`, so the
      // per-node notice would fire on all of them. The repository-level case
      // wins precisely so the reader is told once, in the right terms.
      expect(model.notice!.kind).toBe("repo-zero-history");
      expect(model.notice!.cause).toBe("no commits in the last 365 days");
      expect(model.notice!.exit).toContain("--window-days");
    }
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
