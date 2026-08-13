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
  if (major === null) {
    return {
      ok: false,
      failure: {
        kind: "malformed",
        title: "analysis.json declares an unreadable schemaVersion",
        detail: `\`${version}\` is not a version. A gitnebula document carries \`<major>.<minor>\`, both integers.`,
      },
    };
  }
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

  const shapeError = describeShapeProblem(parsed);
  if (shapeError !== null) {
    return {
      ok: false,
      failure: {
        kind: "malformed",
        title: "analysis.json is not a gitnebula document",
        detail: `It declares schemaVersion ${version}, but ${shapeError}. Re-run gitnebula to regenerate the file.`,
      },
    };
  }

  return { ok: true, document: parsed as AnalysisDocument };
}

/**
 * A structural check on the fields the Viewer immediately dereferences.
 *
 * Not full schema validation: running ajv in the browser would pull the
 * validator and the schema into the bundle to re-check what the pipeline
 * already validated at emit time (story 1.2, AD-9), and story 4.1 wants that
 * bundle self-contained. But "the version matched" is not the same as "this is
 * a document" — a file containing only `{"schemaVersion": "1.0"}` passes the
 * gate and then blanks the page on `repo.name`. This turns that into the
 * malformed screen, which is what FR-6 asks for.
 */
function isNodeShaped(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const candidate = node as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.kind === "module" || candidate.kind === "file") &&
    typeof candidate.path === "string" &&
    typeof candidate.layer === "string" &&
    typeof candidate.loc === "number" &&
    typeof candidate.churn === "number"
  );
}

function isEdgeShaped(edge: unknown): boolean {
  if (typeof edge !== "object" || edge === null) return false;
  const candidate = edge as Record<string, unknown>;
  return (
    typeof candidate.source === "string" && typeof candidate.target === "string"
  );
}

function describeShapeProblem(parsed: unknown): string | null {
  const document = parsed as Partial<AnalysisDocument>;
  if (!Array.isArray(document.nodes)) return "its `nodes` array is missing";
  // The elements matter as much as the array: a `nodes: [null]` passes an
  // Array.isArray check and then throws inside the graph builder.
  const badNode = document.nodes.findIndex((node) => !isNodeShaped(node));
  if (badNode !== -1) return `its node at index ${badNode} is not a node`;
  if (!Array.isArray(document.edges)) return "its `edges` array is missing";
  const badEdge = document.edges.findIndex((edge) => !isEdgeShaped(edge));
  if (badEdge !== -1) return `its edge at index ${badEdge} is not an edge`;
  if (!Array.isArray(document.cochanges)) {
    return "its `cochanges` array is missing";
  }
  const repo = document.repo;
  if (typeof repo !== "object" || repo === null) {
    return "it carries no `repo` metadata";
  }
  if (typeof repo.name !== "string") return "its `repo.name` is missing";
  const stats = repo.stats;
  if (typeof stats !== "object" || stats === null) {
    return "it carries no `repo.stats`";
  }
  for (const field of ["files", "loc", "commits"] as const) {
    if (typeof stats[field] !== "number") {
      return `its \`repo.stats.${field}\` is missing`;
    }
  }
  if (typeof stats.languages !== "object" || stats.languages === null) {
    return "its `repo.stats.languages` map is missing";
  }
  return null;
}

function readSchemaVersion(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = (parsed as { schemaVersion?: unknown }).schemaVersion;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * `"1.0"` → 1; anything that is not `<integer>.<integer>` → null.
 *
 * The whole string is matched on purpose. `Number.parseInt` reads a *prefix*,
 * so `"1garbage"` and `"1.x"` both come back as 1 and would sail through the
 * compatibility gate as if they were `1.0`.
 */
function majorOf(version: string): number | null {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : Number.parseInt(match[1]!, 10);
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
