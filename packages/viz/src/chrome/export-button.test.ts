// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { GraphEngine } from "../engine/index.js";
import { exportFilename, renderExportButton } from "./export-button.js";
import { createStore, type ChromeState } from "./store.js";

function store(repoName = "gitnebula") {
  return createStore<ChromeState>({
    repoName,
    files: 10,
    loc: 100,
    commits: 5,
    modules: 2,
    languages: {},
    settling: false,
  });
}

function engineExporting(blob: Blob | Promise<Blob>): GraphEngine {
  return {
    exportPNG: () => Promise.resolve(blob),
  } as unknown as GraphEngine;
}

describe("exportFilename (AC-2)", () => {
  it("is gitnebula-<repo-name>.png, the mockup's convention", () => {
    expect(exportFilename("job-finder")).toBe("gitnebula-job-finder.png");
  });

  it("passes an ordinary name through byte for byte", () => {
    expect(exportFilename("gitnebula")).toBe("gitnebula-gitnebula.png");
    expect(exportFilename("Repo_2024.v2")).toBe("gitnebula-Repo_2024.v2.png");
  });

  it("folds path separators and spaces, which a repo name may legally hold", () => {
    expect(exportFilename("jundymek/gitnebula")).toBe(
      "gitnebula-jundymek-gitnebula.png",
    );
    expect(exportFilename("my repo")).toBe("gitnebula-my-repo.png");
    expect(exportFilename("a:b*c?d")).toBe("gitnebula-a-b-c-d.png");
  });

  it("never produces a dangling or empty name", () => {
    expect(exportFilename("///")).toBe("gitnebula-map.png");
    expect(exportFilename("")).toBe("gitnebula-map.png");
    expect(exportFilename(" repo ")).toBe("gitnebula-repo.png");
  });
});

describe("renderExportButton (FR-22)", () => {
  it("is the mockup's control", () => {
    const button = renderExportButton(store(), engineExporting(new Blob()));
    expect(button.id).toBe("export");
    expect(button.className).toBe("iconbtn");
    expect(button.title).toBe("Export PNG");
    expect(button.textContent).toBe("↓ png");
  });

  it("delivers the engine's blob under the repo's filename", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const deliver = vi.fn();
    const button = renderExportButton(
      store("job-finder"),
      engineExporting(blob),
      { deliver },
    );
    button.click();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(deliver).toHaveBeenCalledWith(blob, "gitnebula-job-finder.png");
  });

  it("ignores a second click while an export is in flight", async () => {
    const deliver = vi.fn();
    let release!: (blob: Blob) => void;
    const pending = new Promise<Blob>((resolve) => {
      release = resolve;
    });
    const button = renderExportButton(store(), engineExporting(pending), {
      deliver,
    });

    button.click();
    expect(button.disabled).toBe(true);
    button.click();
    release(new Blob());
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    // Two clicks, one re-render: a 2x export of 2,000 nodes is expensive
    // enough that starting a second one is a real cost, not a nuisance.
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("reports a failed export and re-enables the button", async () => {
    const onError = vi.fn();
    const engine = {
      exportPNG: () => Promise.reject(new Error("no context")),
    } as unknown as GraphEngine;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const button = renderExportButton(store(), engine, { onError });
    button.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(button.disabled).toBe(false);
    error.mockRestore();
  });
});
