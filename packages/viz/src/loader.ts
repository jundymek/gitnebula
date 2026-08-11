/**
 * The data-loading contract (AD-12): the Viewer fetches `./analysis.json` — a
 * same-directory sibling URL — and nothing else, in every mode. Vite dev
 * serves a chosen contract fixture there, the cli server serves the generated
 * file there, and `gitnebula build` writes it as a sibling.
 *
 * The `schemaVersion` major check happens here, once, before anything is
 * rendered. FR-6 wants the mismatch named, not swallowed: a viewer that draws
 * an empty map because the document was a version it does not understand is
 * worse than one that says so.
 */

import {
  SUPPORTED_SCHEMA_MAJOR,
  type AnalysisDocument,
} from "@gitnebula/contract";

/** The only URL the Viewer ever requests (AD-12, AD-8). */
export const ANALYSIS_URL = "./analysis.json";

export type LoadFailureKind =
  "unreachable" | "malformed" | "unsupported-version";

export interface LoadFailure {
  readonly kind: LoadFailureKind;
  /** One line, shown as the error screen's headline. */
  readonly title: string;
  /** One or two sentences naming what went wrong and what to do. */
  readonly detail: string;
  /** The document's major version, when one could be read. */
  readonly foundVersion?: string;
  /** The major version this build understands. */
  readonly supportedVersion?: string;
}

export type LoadResult =
  | { readonly ok: true; readonly document: AnalysisDocument }
  | { readonly ok: false; readonly failure: LoadFailure };

type FetchLike = (url: string) => Promise<Response>;

export async function loadAnalysis(
  fetchImpl: FetchLike = (url) => globalThis.fetch(url),
): Promise<LoadResult> {
  let response: Response;
  try {
    response = await fetchImpl(ANALYSIS_URL);
  } catch (cause) {
    return unreachable(`the request failed (${describe(cause)})`);
  }
  if (!response.ok) {
    return unreachable(`the server answered ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    return {
      ok: false,
      failure: {
        kind: "malformed",
        title: "analysis.json could not be parsed",
        detail: `${ANALYSIS_URL} was served but is not valid JSON (${describe(cause)}).`,
      },
    };
  }

  return checkVersion(parsed);
}

/**
 * Exported separately from the fetch so the version gate is testable without a
 * network double, and so the cli-served and bundled paths share one check.
 */
export function checkVersion(parsed: unknown): LoadResult {
  const version = readSchemaVersion(parsed);
  if (version === null) {
    return {
      ok: false,
      failure: {
        kind: "malformed",
        title: "analysis.json is missing its schemaVersion",
        detail:
          "Every gitnebula document carries a `schemaVersion` field. This one does not, so it cannot be read safely.",
      },
    };
  }

  const major = majorOf(version);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return {
      ok: false,
      failure: {
        kind: "unsupported-version",
        title: "This analysis.json was written by a different gitnebula",
        detail: `The document declares schemaVersion ${version}; this viewer understands major version ${SUPPORTED_SCHEMA_MAJOR}. Re-run gitnebula to regenerate the file, or open it with a matching viewer.`,
        foundVersion: version,
        supportedVersion: String(SUPPORTED_SCHEMA_MAJOR),
      },
    };
  }

  return { ok: true, document: parsed as AnalysisDocument };
}

function readSchemaVersion(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = (parsed as { schemaVersion?: unknown }).schemaVersion;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `"1.0"` → 1. A version whose major is not a number can never match. */
function majorOf(version: string): number {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? -1 : major;
}

function unreachable(reason: string): LoadResult {
  return {
    ok: false,
    failure: {
      kind: "unreachable",
      title: "analysis.json could not be loaded",
      detail: `The viewer looks for ${ANALYSIS_URL} next to itself, and ${reason}.`,
    },
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
