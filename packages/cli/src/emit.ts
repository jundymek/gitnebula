// The emit stage: turn the validated document into the bytes on disk.
//
// Serialization is separated from writing because FR-7's determinism claim is
// a claim about the bytes: the byte-compare test compares two `serialize`
// results, not two files.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AnalysisDocument } from "@gitnebula/contract";

import { StageError } from "./errors.js";

/** The stage name this module aborts under (AD-7). */
export const EMIT_STAGE = "emit";

/** Default output file, resolved against the directory gitnebula was invoked in. */
export const DEFAULT_OUTPUT_FILENAME = "analysis.json";

/**
 * Renders the document. Two-space indent and a trailing newline: the file is a
 * diffable artifact a user may commit next to a published bundle (ADR-0004),
 * and property order comes from `assemble`, which builds it deterministically.
 */
export function serialize(analysis: AnalysisDocument): string {
  return `${JSON.stringify(analysis, null, 2)}\n`;
}

/**
 * Writes the document, creating the parent directory if needed.
 *
 * @throws {StageError} stage `emit` when the file cannot be written.
 */
export function emit(path: string, analysis: AnalysisDocument): void {
  const contents = serialize(analysis);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  } catch (error) {
    throw new StageError(
      EMIT_STAGE,
      `cannot write ${path}`,
      "check the directory exists and is writable, or pass --out with a different path",
      { underlying: error },
    );
  }
}
