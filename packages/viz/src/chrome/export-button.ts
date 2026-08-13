/**
 * The header's PNG button (FR-22), filling the `EXPORT_SLOT_ID` slot story 2.5
 * left for it.
 *
 * Chrome-side, so it knows nothing about canvases or contexts: it asks the
 * engine for a Blob through the AD-5 interface and turns that Blob into a
 * download. `boundary.test.ts` enforces the ignorance.
 */

import type { GraphEngine } from "../engine/index.js";
import type { ChromeState, Store } from "./store.js";

/** Path separators and the Windows-reserved set. */
const RESERVED_FILENAME_CHARS = new Set([
  "/",
  "\\",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

/** Anything below U+0020 is a control character and never belongs in a name. */
function isUnsafeForFilename(char: string): boolean {
  return (
    RESERVED_FILENAME_CHARS.has(char) ||
    char.charCodeAt(0) < 0x20 ||
    /\s/.test(char)
  );
}

/**
 * `gitnebula-<repo-name>.png` — the mockup's convention
 * (`gitnebula-job-finder.png`).
 *
 * The repo name reaches this from `analysis.json`, so it is whatever the
 * scanned directory was called, and it can legally hold a slash (an
 * `owner/repo` name), a colon or a space. Those are folded to `-` here rather
 * than left to the browser, which mangles or silently drops such a download.
 * A name that needs no folding is passed through byte for byte, which is the
 * case AC-2 pins.
 */
export function exportFilename(repoName: string): string {
  const folded = [...repoName]
    .map((char) => (isUnsafeForFilename(char) ? "-" : char))
    .join("")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `gitnebula-${folded === "" ? "map" : folded}.png`;
}

/**
 * Hands a Blob to the browser as a download.
 *
 * The object URL is revoked on the next task rather than immediately: the
 * download starts asynchronously after the synthetic click, and revoking in
 * the same tick can cancel it before it begins.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface ExportButtonOptions {
  /** Injection point for tests; the real download is the default. */
  readonly deliver?: (blob: Blob, filename: string) => void;
  /** Called when the engine refuses to export. */
  readonly onError?: (error: unknown) => void;
}

/**
 * The `↓ png` control. Disabled while an export is in flight — encoding a 2×
 * PNG of a 2,000-node map is not instant, and a second click would start a
 * second re-render rather than doing nothing.
 */
export function renderExportButton(
  store: Store<ChromeState>,
  engine: GraphEngine,
  options: ExportButtonOptions = {},
): HTMLButtonElement {
  const deliver = options.deliver ?? downloadBlob;
  const button = document.createElement("button");
  button.className = "iconbtn";
  button.id = "export";
  button.title = "Export PNG";
  button.textContent = "↓ png";

  let exporting = false;
  button.addEventListener("click", () => {
    if (exporting) return;
    exporting = true;
    button.disabled = true;
    void engine
      .exportPNG()
      .then((blob) => {
        deliver(blob, exportFilename(store.getState().repoName));
      })
      .catch((error: unknown) => {
        // A failed export must not leave a dead button behind, and it must not
        // fail silently either — the map is still on screen, so the user has
        // no other signal that nothing was written.
        options.onError?.(error);
        console.error("gitnebula: PNG export failed", error);
      })
      .finally(() => {
        exporting = false;
        button.disabled = false;
      });
  });

  return button;
}
