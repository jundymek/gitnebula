// Language-neutral edge assembly: resolved file pairs in, contract edges out.
// ADR-0005 puts both levels in one `edges[]` and makes module `weight` the
// number of underlying file pairs — so the aggregation happens here, once,
// and the Viewer never recomputes it.
import type { AnalysisEdge } from "@gitnebula/contract";

/** One resolved import, as node ids from the ScanResult universe. */
export interface FilePair {
  readonly source: string;
  readonly target: string;
}

/** Locale-free ordering: `localeCompare` varies by ICU build (AD-4). */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareEdges(a: AnalysisEdge, b: AnalysisEdge): number {
  const bySource = compareIds(a.source, b.source);
  return bySource !== 0 ? bySource : compareIds(a.target, b.target);
}

/** NUL cannot occur in a path, and therefore not in a node id either. */
const SEPARATOR = "\u0000";

function pairKey(source: string, target: string): string {
  return `${source}${SEPARATOR}${target}`;
}

function splitKey(key: string): FilePair {
  const separator = key.indexOf(SEPARATOR);
  return {
    source: key.slice(0, separator),
    target: key.slice(separator + 1),
  };
}

/**
 * File edges deduplicated per (source, target) with `weight: 1`; module edges
 * aggregated from those deduplicated pairs with `weight` = the number of file
 * pairs beneath them. A file importing itself, and a pair whose two files sit
 * in the same module or in no module at all, produce no module edge (D6).
 * The result carries both levels in one array, sorted by source then target.
 */
export function buildEdges(
  pairs: readonly FilePair[],
  parentOf: ReadonlyMap<string, string | null>,
): AnalysisEdge[] {
  const filePairs = new Set<string>();
  for (const { source, target } of pairs) {
    if (source !== target) filePairs.add(pairKey(source, target));
  }

  const moduleWeights = new Map<string, number>();
  for (const key of filePairs) {
    const { source, target } = splitKey(key);
    const sourceModule = parentOf.get(source) ?? null;
    const targetModule = parentOf.get(target) ?? null;
    if (
      sourceModule === null ||
      targetModule === null ||
      sourceModule === targetModule
    ) {
      continue;
    }
    const moduleKey = pairKey(sourceModule, targetModule);
    moduleWeights.set(moduleKey, (moduleWeights.get(moduleKey) ?? 0) + 1);
  }

  const edges: AnalysisEdge[] = [];
  for (const key of filePairs) {
    edges.push({ ...splitKey(key), kind: "import", weight: 1 });
  }
  for (const [key, weight] of moduleWeights) {
    edges.push({ ...splitKey(key), kind: "import", weight });
  }

  return edges.sort(compareEdges);
}
