// The validator for analysis.json. The schema is compiled once, at module
// load, because the cli validates the document it just assembled and viz
// validates the document it just fetched — both on a hot path.
//
// Environment-neutral by AC-5/AD-11: ajv runs in Node and in the browser, and
// nothing here imports a `node:` module.
import { Ajv2020 } from "ajv/dist/2020.js";

import analysisSchema from "./analysis.schema.json" with { type: "json" };
import type { AnalysisDocument } from "./generated/analysis.js";

/** A single schema violation, addressed by JSON Pointer. */
export interface ValidationError {
  /** JSON Pointer to the offending value, e.g. `/nodes/0/layer`. */
  readonly path: string;
  /** Human-readable cause, e.g. `must be equal to one of the allowed values`. */
  readonly message: string;
}

export type ValidationResult =
  | { readonly valid: true; readonly data: AnalysisDocument }
  | { readonly valid: false; readonly errors: readonly ValidationError[] };

// RFC 3339 date-time, the shape `new Date().toISOString()` and `git log
// --date=iso-strict` both produce. Registered here rather than pulled in with
// ajv-formats: `date-time` is the only format the contract uses.
const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const ajv = new Ajv2020({
  allErrors: true,
  // Every list in the contract is stably sorted and fully specified; an
  // unknown keyword in the schema is an authoring mistake, not a feature.
  strict: true,
});
ajv.addFormat("date-time", RFC3339_DATE_TIME);

const compiled = ajv.compile<AnalysisDocument>(analysisSchema);

/**
 * Validates a parsed `analysis.json` against the contract schema.
 *
 * Missing-property errors point at the absent field itself rather than at its
 * parent object, so a caller can print the pointer verbatim.
 */
export function validateAnalysis(data: unknown): ValidationResult {
  if (compiled(data)) {
    return { valid: true, data };
  }

  const errors = (compiled.errors ?? []).map((error): ValidationError => {
    const missing =
      error.keyword === "required"
        ? `/${(error.params as { missingProperty: string }).missingProperty}`
        : "";
    return {
      path: `${error.instancePath}${missing}` || "/",
      message: error.message ?? "is invalid",
    };
  });

  return { valid: false, errors };
}

/**
 * Renders validation errors as an indented block for a cli failure message.
 * Follows AD-7's `«stage»: «cause» — «remedy»` shape at the call site; this
 * helper supplies the cause.
 */
export function formatValidationErrors(
  errors: readonly ValidationError[],
): string {
  return errors.map((error) => `  ${error.path} ${error.message}`).join("\n");
}
