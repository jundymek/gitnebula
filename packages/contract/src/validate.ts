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
//
// Shape alone is not enough. A digit-placement regex accepts
// `2026-99-99T25:61:61Z`, which the Viewer turns into an `Invalid Date` and
// renders as NaN in the panel — so the component ranges and the calendar are
// checked too, which is what `format: "date-time"` promises.
// The offset sign is not captured: only the magnitude of its components is
// bounded, and no arithmetic is done on the offset.
const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

/** Days per month, 1-indexed; February is resolved against the year. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * True when `value` is a full RFC 3339 timestamp: correct shape, every
 * component in range, and a day that exists in that month of that year.
 *
 * Every accepted value parses with `new Date(...)` — asserted in the tests,
 * because that is what the Viewer does with it.
 */
function isRfc3339DateTime(value: string): boolean {
  const match = RFC3339_DATE_TIME.exec(value);
  if (match === null) return false;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  // Absent for a `Z` timezone, which is an offset of zero.
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);

  // Year 0000 parses in JavaScript, so the Date invariant does not exclude it,
  // but no repository has commits from it: a zero year reaching here is an
  // upstream parsing bug that should surface as a validation failure.
  if (year! < 1) return false;
  if (month! < 1 || month! > 12) return false;

  const lastDay =
    month === 2 && isLeapYear(year!) ? 29 : DAYS_IN_MONTH[month!]!;
  if (day! < 1 || day! > lastDay) return false;

  // Second 60 is rejected, deliberately, though RFC 3339 §5.6 permits a leap
  // second. Nothing downstream can represent one: git stores POSIX epoch
  // seconds, which have no leap second, and `new Date("…T23:59:60Z")` returns
  // Invalid Date — so accepting it would hand the Viewer exactly the NaN this
  // format exists to keep out. No producer in this pipeline can emit one.
  if (hour! > 23 || minute! > 59 || second! > 59) return false;

  return offsetHour <= 23 && offsetMinute <= 59;
}

const ajv = new Ajv2020({
  allErrors: true,
  // Every list in the contract is stably sorted and fully specified; an
  // unknown keyword in the schema is an authoring mistake, not a feature.
  strict: true,
});
ajv.addFormat("date-time", isRfc3339DateTime);

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
