// AD-10 / FR-8: the describe boundary, and the whole of it inside the
// pipeline.
//
// The pipeline ends with `enrich(analysis) → analysis`, a named extension
// point that MVP implements as identity. It exists now so the post-MVP LLM
// layer is an implementation of a stage that is already wired, rather than a
// change that has to cut its way through the pipeline.
//
// It is deliberately async and deliberately total: an enricher that talks to a
// backend will be async, and one that fails must return the analysis it was
// given rather than degrade the run (product principle 3 — the absence of an
// LLM backend degrades nothing but the descriptions).
import type { AnalysisDocument } from "@gitnebula/contract";

/** The stage name this hook runs under. */
export const ENRICH_STAGE = "enrich";

/**
 * MVP: identity. Every node keeps `description: null` and
 * `descriptionSource: null`, and no warning is printed — with no llm
 * configuration there is nothing to warn about (FR-8).
 */
export async function enrich(
  analysis: AnalysisDocument,
): Promise<AnalysisDocument> {
  return analysis;
}
