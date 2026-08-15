// @vitest-environment jsdom
/**
 * Story 5.6: blast radius from co-change (FR-27).
 *
 * The `cochanges` array has shipped in every `analysis.json` since epic 1 and
 * the UI read it in exactly one place — a three-partner metric row. This suite
 * covers what turning it into a section has to guarantee: a deterministic
 * order (AC-1), navigation through the existing selection path (AC-2), an
 * empty state that reads as a measurement rather than a bug (AC-3), and pairs
 * that can never be mistaken for the wrong level (AC-5).
 *
 * Its own file rather than more cases in `panel.test.ts` / `panel-model.test.ts`:
 * bob (5.7) and I both work in this package this wave, and a new file is a
 * merge neither of us can lose.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { AnalysisDocument, CochangePair } from "@gitnebula/contract";

import {
  buildPanelModel,
  cochangePartners,
  formatSharedCommits,
  MIN_COCHANGE_COUNT,
  topCochanges,
} from "./panel-model.js";
import { renderPanel, type PanelActions, type PanelHandle } from "./panel.js";
import { engineNodeFrom } from "../test-support/engine-nodes.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function mountPanel(overrides: Partial<PanelActions> = {}): PanelHandle {
  const handle = renderPanel({
    onIsolate: overrides.onIsolate ?? ((): void => {}),
    onClose: overrides.onClose ?? ((): void => {}),
    onSelectPartner: overrides.onSelectPartner ?? ((): void => {}),
    onShowBlastRadius: overrides.onShowBlastRadius ?? ((): void => {}),
  });
  document.body.replaceChildren(handle.element);
  return handle;
}

function open(
  handle: PanelHandle,
  document_: AnalysisDocument,
  id: string,
): void {
  handle.open({
    document: document_,
    node: engineNodeFrom(document_, id),
    now: NOW,
  });
}

function partnerRows(handle: PanelHandle): HTMLButtonElement[] {
  return [
    ...handle.element.querySelectorAll<HTMLButtonElement>(".p-blast-row"),
  ];
}

// ---------------------------------------------------------------------------
// AC-1 — ordering is deterministic
// ---------------------------------------------------------------------------

describe("blast radius — deterministic ordering (AC-1, NFR-12)", () => {
  const document_ = loadSyntheticFixture();
  const node = engineNodeFrom(document_, "mod-000/");

  it("orders by shared-commit count descending", () => {
    const counts = cochangePartners(document_, node).map(
      (partner) => partner.count,
    );
    expect(counts.length).toBeGreaterThan(1);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("breaks ties by id ascending, in code-unit order", () => {
    const partners = cochangePartners(document_, node);
    for (let i = 1; i < partners.length; i += 1) {
      const previous = partners[i - 1]!;
      const current = partners[i]!;
      if (previous.count !== current.count) continue;
      expect(previous.id < current.id).toBe(true);
    }
  });

  it("is stable against the order the pairs arrive in", () => {
    // The contract does not promise an order, and `githist`'s could change
    // without a schema change. The panel's order must be a function of the
    // pairs' content alone — so the same pairs shuffled must render the same
    // list. Reversed rather than randomised: the suite is deterministic too.
    const shuffled: AnalysisDocument = {
      ...document_,
      cochanges: [...document_.cochanges].reverse(),
    };
    expect(cochangePartners(shuffled, node)).toEqual(
      cochangePartners(document_, node),
    );
  });

  it("orders ids that a locale collation would order differently", () => {
    // The concrete reason `localeCompare` is banned here. Under most ICU
    // locales `a-b` sorts before `ab` (punctuation is ignored at the primary
    // strength); by code unit, `-` (0x2D) precedes `b` (0x62), so `a-b/` comes
    // first — and that is the order every machine must agree on.
    const pairs: CochangePair[] = [
      { a: "src/", b: "ab/", count: 4 },
      { a: "src/", b: "a-b/", count: 4 },
    ];
    const document2: AnalysisDocument = {
      ...document_,
      nodes: [
        nodeStub("src/"),
        nodeStub("ab/"),
        nodeStub("a-b/"),
        ...document_.nodes.filter((n) => n.kind !== "module"),
      ],
      cochanges: pairs,
    };
    const ids = cochangePartners(
      document2,
      engineNodeFrom(document2, "src/"),
    ).map((partner) => partner.id);
    expect(ids).toEqual(["a-b/", "ab/"]);
  });

  it("keeps story 3.4's summary as the head of the same list", () => {
    // One derivation, two renderings — the summary cannot drift from the
    // section because it is literally its first three entries.
    expect(topCochanges(document_, node)).toEqual(
      cochangePartners(document_, node).slice(0, 3),
    );
  });

  it("never reaches for localeCompare in this story's code", () => {
    // AC-1 states this as a property of the source, so it is asserted against
    // the source. A comparison that is locale-aware makes the rendered order a
    // function of the reader's machine, which NFR-12 forbids outright.
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ["panel-model.ts", "panel.ts", "empty-state.ts"]) {
      const source = readFileSync(join(here, file), "utf8");
      expect({ file, hit: /localeCompare/.test(source) }).toEqual({
        file,
        hit: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 — module and file pairs are never confused
// ---------------------------------------------------------------------------

describe("blast radius — level disambiguation (AC-5)", () => {
  /**
   * A document carrying BOTH levels, where the two share a numeric suffix on
   * purpose: if the lookup ever matched on anything but the exact id, `core/`
   * would inherit `core/a.ts`'s partners and the panel would attribute a
   * file's history to a module.
   */
  function bothLevels(): AnalysisDocument {
    const base = loadContractFixture("single-module");
    return {
      ...base,
      nodes: [
        nodeStub("core/"),
        nodeStub("util/"),
        fileStub("core/a.ts", "core/"),
        fileStub("core/b.ts", "core/"),
        fileStub("util/c.ts", "util/"),
      ],
      cochanges: [
        { a: "core/", b: "util/", count: 12 },
        { a: "core/a.ts", b: "core/b.ts", count: 7 },
        { a: "core/a.ts", b: "util/c.ts", count: 5 },
      ],
    };
  }

  const document_ = bothLevels();

  it("gives a module only module partners", () => {
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "core/"),
    );
    expect(model.blastRadius.level).toBe("module");
    expect(model.blastRadius.partners).toEqual([{ id: "util/", count: 12 }]);
  });

  it("gives a file only file partners, never its module's pair", () => {
    // The failure this guards: `core/a.ts` showing `util/ 12`, which is the
    // module's history presented as the file's own. Rolling module pairs down
    // to files (or files up to modules) would also be a new aggregation in the
    // Viewer, which AD-1 puts in the pipeline or nowhere.
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "core/a.ts"),
    );
    expect(model.blastRadius.level).toBe("file");
    expect(model.blastRadius.partners).toEqual([
      { id: "core/b.ts", count: 7 },
      { id: "util/c.ts", count: 5 },
    ]);
    expect(
      model.blastRadius.partners.some((partner) => partner.id === "util/"),
    ).toBe(false);
  });

  it("names the level in the caption, so the reader is never left inferring", () => {
    expect(
      buildPanelModel(document_, engineNodeFrom(document_, "core/")).blastRadius
        .caption,
    ).toContain("modules");
    expect(
      buildPanelModel(document_, engineNodeFrom(document_, "core/a.ts"))
        .blastRadius.caption,
    ).toContain("files");
  });

  it("states the window the counts were measured over", () => {
    const windowed: AnalysisDocument = {
      ...document_,
      repo: { ...document_.repo, analysisWindowDays: 30 },
    };
    expect(
      buildPanelModel(windowed, engineNodeFrom(windowed, "core/")).blastRadius
        .caption,
    ).toBe("blast radius · modules · last 30 days");
  });
});

// ---------------------------------------------------------------------------
// AC-3 — the empty case is the majority case
// ---------------------------------------------------------------------------

describe("blast radius — the empty state names its cause (AC-3, UX-DR14)", () => {
  const document_ = loadSyntheticFixture();

  /** A node the fixture's pairs never mention — the common case on a real repo. */
  function lonelyNode(): AnalysisDocument {
    return { ...document_, cochanges: [] };
  }

  it("names the threshold and the window rather than showing nothing", () => {
    const empty = buildPanelModel(
      lonelyNode(),
      engineNodeFrom(document_, "mod-000/"),
      { now: NOW },
    ).blastRadius.empty;
    expect(empty).not.toBeNull();
    expect(empty!.cause).toBe(
      `nothing changed with it in ${MIN_COCHANGE_COUNT} or more commits of the last 365 days`,
    );
  });

  it("offers --window-days as the lever, per 5.5's convention", () => {
    const empty = buildPanelModel(
      lonelyNode(),
      engineNodeFrom(document_, "mod-000/"),
      { now: NOW },
    ).blastRadius.empty;
    expect(empty!.exit).toContain("--window-days");
  });

  it("never hardcodes the window it names", () => {
    // `--window-days` makes the window configurable, so copy carrying a
    // literal starts lying the first time anyone uses the flag (5.5's AC-1).
    const source = lonelyNode();
    const windowed: AnalysisDocument = {
      ...source,
      repo: { ...source.repo, analysisWindowDays: 14 },
    };
    const empty = buildPanelModel(
      windowed,
      engineNodeFrom(windowed, "mod-000/"),
      { now: NOW },
    ).blastRadius.empty;
    expect(empty!.cause).toContain("last 14 days");
    expect(empty!.exit).toContain("14 days");
    expect(`${empty!.cause}${empty!.exit}`).not.toContain("365");
  });

  it("stays silent when the repository already stated the cause (5.5)", () => {
    // Zero commits in the window is a property of the repository. The panel
    // says it once at the top; a section repeating it under every node would
    // be the same sentence twice and would blame the node for it.
    const quiet = loadContractFixture("zero-history");
    const model = buildPanelModel(quiet, engineNodeFrom(quiet, "core/"), {
      now: NOW,
    });
    expect(model.blastRadius.suppressed).toBe(true);
    expect(model.blastRadius.empty).toBeNull();
    expect(model.notice?.kind).toBe("repo-zero-history");
  });

  it("hides the whole section when it is suppressed, DOM and all", () => {
    const quiet = loadContractFixture("zero-history");
    const handle = mountPanel();
    open(handle, quiet, "core/");
    const section = handle.element.querySelector<HTMLElement>(".p-blast")!;
    expect(section.hidden).toBe(true);
    // 5.5's "state it once" assertion counts `.p-notice`; this section must
    // never add a second one.
    expect(handle.element.querySelectorAll(".p-notice")).toHaveLength(1);
  });

  it("offers no show-on-map control when there is nothing to mark", () => {
    // Absence over disablement, the same rule the GitHub action follows: a
    // control that can only ever mark an empty set is a promise the map
    // cannot keep.
    const handle = mountPanel();
    open(handle, lonelyNode(), "mod-000/");
    expect(
      handle.element.querySelector<HTMLElement>(".p-blast-show")!.hidden,
    ).toBe(true);
    expect(partnerRows(handle)).toHaveLength(0);
    expect(handle.element.textContent).toContain("or more commits of the last");
  });
});

// ---------------------------------------------------------------------------
// AC-1 / AC-2 — the section in the DOM
// ---------------------------------------------------------------------------

describe("blast radius — the panel section (AC-1, AC-2)", () => {
  const document_ = loadSyntheticFixture();

  it("lists every partner with its shared-commit count, in model order", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    const model = buildPanelModel(
      document_,
      engineNodeFrom(document_, "mod-000/"),
      { now: NOW },
    );
    expect(partnerRows(handle).map((row) => row.textContent)).toEqual(
      model.blastRadius.partners.map(
        (partner) => `${partner.id}${formatSharedCommits(partner.count)}`,
      ),
    );
  });

  it("carries the count in the accessible name, not only in the pixels", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    const first = partnerRows(handle)[0]!;
    expect(first.getAttribute("aria-label")).toMatch(/, \d+ commits?$/);
  });

  it("singularises a lone shared commit", () => {
    expect(formatSharedCommits(1)).toBe("1 commit");
    expect(formatSharedCommits(2)).toBe("2 commits");
  });

  it("asks chrome to navigate, and does nothing else itself (AC-2)", () => {
    // The panel owns no camera and no selection: it reports a click and stops.
    // Chrome answers with the `flyTo` the search box already uses, which is
    // what keeps this story from adding a second way to move (AD-5).
    const onSelectPartner = vi.fn();
    const handle = mountPanel({ onSelectPartner });
    open(handle, document_, "mod-000/");
    const first = partnerRows(handle)[0]!;
    first.click();
    expect(onSelectPartner).toHaveBeenCalledExactlyOnceWith(
      first.querySelector("span")!.textContent,
    );
  });

  it("repaints rather than appending when a second node is opened", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    const first = partnerRows(handle).map((row) => row.textContent);
    open(handle, document_, "mod-001/");
    const second = partnerRows(handle).map((row) => row.textContent);
    expect(second).not.toEqual(first);
    expect(second).toEqual(
      buildPanelModel(document_, engineNodeFrom(document_, "mod-001/"), {
        now: NOW,
      }).blastRadius.partners.map(
        (partner) => `${partner.id}${formatSharedCommits(partner.count)}`,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4 — the map toggle, panel side
// ---------------------------------------------------------------------------

describe("blast radius — asking the map to mark the set (AC-4)", () => {
  const document_ = loadSyntheticFixture();

  it("sends the partner ids in model order when switched on", () => {
    const onShowBlastRadius = vi.fn();
    const handle = mountPanel({ onShowBlastRadius });
    open(handle, document_, "mod-000/");
    const toggle =
      handle.element.querySelector<HTMLButtonElement>(".p-blast-show")!;
    toggle.click();

    const expected = buildPanelModel(
      document_,
      engineNodeFrom(document_, "mod-000/"),
      { now: NOW },
    ).blastRadius.partners.map((partner) => partner.id);
    expect(onShowBlastRadius).toHaveBeenCalledExactlyOnceWith(expected);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toBe("hide on map");
  });

  it("asks for the mark to be cleared when switched off", () => {
    // An empty set, not silence: "stop marking" is a request the map has to
    // receive, not an absence chrome can imply.
    const onShowBlastRadius = vi.fn();
    const handle = mountPanel({ onShowBlastRadius });
    open(handle, document_, "mod-000/");
    const toggle =
      handle.element.querySelector<HTMLButtonElement>(".p-blast-show")!;
    toggle.click();
    toggle.click();
    expect(onShowBlastRadius).toHaveBeenLastCalledWith([]);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toBe("show on map");
  });

  it("drops the previous node's mark when the panel moves to another node", () => {
    // Otherwise the map keeps marking one node's partners underneath another
    // node's panel — a mark the reader reads as belonging to what they just
    // clicked.
    const onShowBlastRadius = vi.fn();
    const handle = mountPanel({ onShowBlastRadius });
    open(handle, document_, "mod-000/");
    handle.element.querySelector<HTMLButtonElement>(".p-blast-show")!.click();
    onShowBlastRadius.mockClear();

    open(handle, document_, "mod-001/");
    expect(onShowBlastRadius).toHaveBeenCalledExactlyOnceWith([]);
    expect(
      handle.element
        .querySelector<HTMLElement>(".p-blast-show")!
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("drops the mark when the panel is closed", () => {
    const onShowBlastRadius = vi.fn();
    const handle = mountPanel({ onShowBlastRadius });
    open(handle, document_, "mod-000/");
    handle.element.querySelector<HTMLButtonElement>(".p-blast-show")!.click();
    onShowBlastRadius.mockClear();

    handle.close();
    expect(onShowBlastRadius).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("asks for nothing on a close that never marked anything", () => {
    const onShowBlastRadius = vi.fn();
    const handle = mountPanel({ onShowBlastRadius });
    open(handle, document_, "mod-000/");
    handle.close();
    expect(onShowBlastRadius).not.toHaveBeenCalled();
  });
});

// --- fixtures --------------------------------------------------------------

function nodeStub(id: string): AnalysisDocument["nodes"][number] {
  return {
    id,
    kind: "module",
    parent: null,
    path: id,
    layer: "backend",
    loc: 100,
    commits: 5,
    authors: 1,
    churn: 0.1,
    lastChangedAt: "2026-08-01T00:00:00.000Z",
    // Both halves of the reserved describe-layer slot (AD-10). Null in MVP,
    // and required by the contract — a fixture missing it compiles nowhere.
    description: null,
    descriptionSource: null,
  };
}

function fileStub(
  id: string,
  parent: string,
): AnalysisDocument["nodes"][number] {
  return { ...nodeStub(id), kind: "file", parent, path: id };
}
