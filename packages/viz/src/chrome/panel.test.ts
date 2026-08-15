// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { AnalysisDocument } from "@gitnebula/contract";

import { renderPanel, type PanelHandle } from "./panel.js";
import { engineNodeFrom } from "../test-support/engine-nodes.js";
import {
  loadContractFixture,
  loadSyntheticFixture,
} from "../test-support/fixtures.js";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function mountPanel(
  overrides: Partial<{ onIsolate(): void; onClose(): void }> = {},
) {
  const handle = renderPanel({
    onIsolate: overrides.onIsolate ?? (() => {}),
    onClose: overrides.onClose ?? (() => {}),
  });
  document.body.replaceChildren(handle.element);
  return handle;
}

function open(
  handle: PanelHandle,
  document_: AnalysisDocument,
  id: string,
  description?: string | null,
): void {
  handle.open({
    document: document_,
    node: engineNodeFrom(document_, id),
    description,
    now: NOW,
  });
}

function text(handle: PanelHandle, selector: string): string {
  return handle.element.querySelector(selector)?.textContent ?? "";
}

function rows(handle: PanelHandle): [string, string][] {
  return [...handle.element.querySelectorAll(".p-row")].map((row) => {
    const spans = row.querySelectorAll("span");
    return [spans[0]?.textContent ?? "", spans[1]?.textContent ?? ""];
  });
}

describe("panel — opening on a node (AC-1)", () => {
  const document_ = loadSyntheticFixture();

  it("starts hidden and opens with the mockup's layout", () => {
    const handle = mountPanel();
    expect(handle.element.hidden).toBe(true);

    open(handle, document_, "mod-000/");

    expect(handle.element.hidden).toBe(false);
    expect(text(handle, ".p-name")).toBe("mod-000/");
    expect(text(handle, ".p-path")).toBe("mod-000/");
    expect(text(handle, ".p-kind")).toBe("module · backend");
    expect(rows(handle).map(([label]) => label)).toEqual([
      "files",
      "loc",
      `churn ${document_.repo.analysisWindowDays}d`,
      "authors",
      "last change",
      "co-changes with",
    ]);
  });

  it("prints the metrics the story lists, locale-formatted", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    const values = Object.fromEntries(rows(handle));
    expect(values["files"]).toBe("20");
    expect(values["loc"]).toBe("3,072");
    expect(values[`churn ${document_.repo.analysisWindowDays}d`]).toBe("99%");
    expect(values["authors"]).toBe("2");
    expect(values["last change"]).toMatch(/ ago$/);
    expect(values["co-changes with"]).toMatch(/^mod-\d+\/ \d+/);
  });

  it("groups the history rows under a caption naming the window (AC-1)", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");

    const group = handle.element.querySelector(".p-history")!;
    const caption = `history · last ${document_.repo.analysisWindowDays} days`;
    expect(text(handle, ".p-window")).toBe(caption);
    // The caption is the accessible name too, so a screen reader reaching any
    // metric inside the group is told which window it covers.
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe(caption);

    // `files` and `loc` describe HEAD, not the window, and stay outside.
    const grouped = [...group.querySelectorAll(".p-row")].map(
      (row) => row.querySelector("span")!.textContent,
    );
    expect(grouped).toEqual([
      `churn ${document_.repo.analysisWindowDays}d`,
      "authors",
      "last change",
      "co-changes with",
    ]);
  });

  it("sets the churn bar's width to the churn percentage", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    const fill = handle.element.querySelector<HTMLElement>(".p-bar i")!;
    expect(fill.style.width).toBe("99%");
  });

  it("shows the hot badge only when the node is hot", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    const badge = handle.element.querySelector<HTMLElement>(".p-badge")!;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("hot spot");

    const cool = loadContractFixture("zero-history");
    open(handle, cool, "core/");
    expect(badge.hidden).toBe(true);
  });

  it("prints an em dash for a file's file count", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/file-00.ts");
    expect(text(handle, ".p-name")).toBe("file-00.ts");
    expect(text(handle, ".p-path")).toBe("mod-000/file-00.ts");
    expect(Object.fromEntries(rows(handle))["files"]).toBe("—");
  });

  it("repaints rather than appending when a second node is opened", () => {
    const handle = mountPanel();
    open(handle, document_, "mod-000/");
    open(handle, document_, "mod-001/");
    expect(rows(handle)).toHaveLength(6);
    expect(text(handle, ".p-name")).toBe("mod-001/");
  });
});

describe("panel — the window's empty states (5.5 AC-2, AC-3)", () => {
  function notice(handle: PanelHandle) {
    return handle.element.querySelector<HTMLElement>(".p-notice")!;
  }

  it("marks an absent last-change visibly distinct from a real zero", () => {
    const base = loadContractFixture("single-module");
    const quiet = base.nodes.find((node) => node.kind === "file")!;
    const document_: AnalysisDocument = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === quiet.id ? { ...node, lastChangedAt: null } : node,
      ),
    };

    const handle = mountPanel();
    open(handle, document_, quiet.id);

    const emptyRows = [...handle.element.querySelectorAll(".p-row.is-empty")];
    expect(emptyRows).toHaveLength(1);
    expect(emptyRows[0]!.querySelector("span")!.textContent).toBe(
      "last change",
    );
    expect(emptyRows[0]!.textContent).toContain("no change in last 365 days");

    // The distinction is a class the stylesheet can act on, not wording alone:
    // a reader scanning the panel must see it without reading it.
    const authors = [...handle.element.querySelectorAll(".p-row")].find(
      (row) => row.querySelector("span")!.textContent === "authors",
    )!;
    expect(authors.className).not.toContain("is-empty");
  });

  it("names --window-days as the exit for an out-of-window node (AC-2)", () => {
    const base = loadContractFixture("single-module");
    const quiet = base.nodes.find((node) => node.kind === "file")!;
    const document_: AnalysisDocument = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === quiet.id ? { ...node, lastChangedAt: null } : node,
      ),
    };

    const handle = mountPanel();
    open(handle, document_, quiet.id);

    expect(notice(handle).hidden).toBe(false);
    expect(notice(handle).dataset["kind"]).toBe("node-out-of-window");
    expect(notice(handle).textContent).toContain("--window-days");
  });

  it("says nothing at all when the node has history in the window", () => {
    const document_ = loadContractFixture("single-module");
    const handle = mountPanel();
    open(handle, document_, "app/");

    expect(notice(handle).hidden).toBe(true);
    expect(notice(handle).textContent).toBe("");
    expect(handle.element.querySelector(".p-row.is-empty")).toBeNull();
  });

  it("states a zero-history repository once per panel, not once per row (AC-3)", () => {
    const document_ = loadContractFixture("zero-history");
    const handle = mountPanel();
    open(handle, document_, "core/scoring.py");

    expect(notice(handle).dataset["kind"]).toBe("repo-zero-history");
    expect(notice(handle).textContent).toContain(
      "no commits in the last 365 days",
    );

    // Once. The sentence naming the repository-wide cause must not also be
    // repeated down the metric rows — that repetition is the failure AC-3
    // exists to prevent.
    const occurrences = handle.element.querySelectorAll(".p-notice").length;
    expect(occurrences).toBe(1);
    expect(
      handle.element.textContent!.match(/no commits in the last/g),
    ).toHaveLength(1);
  });

  it("clears the notice when moving from a quiet node to a busy one", () => {
    const base = loadContractFixture("single-module");
    const quiet = base.nodes.find((node) => node.kind === "file")!;
    const document_: AnalysisDocument = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === quiet.id ? { ...node, lastChangedAt: null } : node,
      ),
    };

    const handle = mountPanel();
    open(handle, document_, quiet.id);
    expect(notice(handle).hidden).toBe(false);

    open(handle, document_, "app/");
    expect(notice(handle).hidden).toBe(true);
    expect(notice(handle).dataset["kind"]).toBeUndefined();
  });
});

describe("panel — the inert description slot (AC-2, AD-10)", () => {
  it("renders nothing at all for a description it is given", () => {
    const document_ = loadSyntheticFixture();
    const handle = mountPanel();
    const secret = "This module orchestrates the billing pipeline.";

    open(handle, document_, "mod-000/", secret);

    // Not the text, and not a placeholder standing in for it: MVP shows no
    // trace that the describe layer exists.
    expect(handle.element.textContent).not.toContain(secret);
    expect(handle.element.textContent).not.toMatch(
      /description|summary|coming soon|ai/i,
    );
    expect(handle.element.querySelector(".p-description")).toBeNull();
  });
});

describe("panel — actions (AC-3)", () => {
  const document_ = loadContractFixture("single-module");
  const onGitHub = (remoteUrl: string | null): AnalysisDocument => ({
    ...document_,
    repo: { ...document_.repo, remoteUrl },
  });

  it("omits the GitHub action entirely for a non-GitHub remote", () => {
    const handle = mountPanel();
    open(handle, document_, "app/");
    expect(handle.element.querySelector("#p-github")).toBeNull();

    open(handle, onGitHub("https://gitlab.com/o/r.git"), "app/");
    expect(handle.element.querySelector("#p-github")).toBeNull();
  });

  it("links a module to its tree page and a file to its blob page", () => {
    const remote = onGitHub("git@github.com:jundymek/gitnebula.git");
    const handle = mountPanel();

    open(handle, remote, "app/");
    const link = handle.element.querySelector<HTMLAnchorElement>("#p-github")!;
    expect(link.getAttribute("href")).toBe(
      "https://github.com/jundymek/gitnebula/tree/main/app",
    );
    // A `_blank` link without noopener hands the opened page window.opener.
    expect(link.rel).toContain("noopener");

    const file = remote.nodes.find((node) => node.kind === "file")!;
    open(handle, remote, file.id);
    expect(
      handle.element.querySelector<HTMLAnchorElement>("#p-github")!.href,
    ).toContain("/blob/main/");
  });

  it("reports isolate and close, and reflects isolate on aria-pressed", () => {
    const onIsolate = vi.fn();
    const onClose = vi.fn();
    const handle = mountPanel({ onIsolate, onClose });
    open(handle, document_, "app/");

    const isolate =
      handle.element.querySelector<HTMLButtonElement>("#p-isolate")!;
    expect(isolate.getAttribute("aria-pressed")).toBe("false");

    isolate.click();
    expect(onIsolate).toHaveBeenCalledOnce();

    handle.setIsolated(true);
    expect(isolate.getAttribute("aria-pressed")).toBe("true");
    expect(isolate.textContent).toBe("isolated");

    handle.element.querySelector<HTMLButtonElement>(".p-close")!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("drops isolate state when it closes (AC-4)", () => {
    const handle = mountPanel();
    open(handle, document_, "app/");
    handle.setIsolated(true);

    handle.close();

    expect(handle.element.hidden).toBe(true);
    expect(
      handle.element.querySelector("#p-isolate")!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("labels the close control for a screen reader", () => {
    const handle = mountPanel();
    expect(
      handle.element.querySelector(".p-close")!.getAttribute("aria-label"),
    ).toBe("Close panel");
    expect(handle.element.getAttribute("aria-live")).toBe("polite");
  });
});
