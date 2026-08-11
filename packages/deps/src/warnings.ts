// AD-7: every drop is counted and none is silent. Four distinct codes, so the
// cli summary can tell "we ignored your dependencies" from "we could not
// resolve your imports" — they mean very different things to a reader.
import type { AnalyzerWarning } from "@gitnebula/contract";

export type WarningCode =
  /** Resolved into node_modules: a dependency of the repo, not a node in it. */
  | "external-import"
  /** Resolved to a real file the scanner did not list (AD-13). */
  | "outside-universe-import"
  /** Nothing on disk answers the specifier. FR-11 measures this one. */
  | "unresolved-import"
  /** The file did not parse; it contributes no edges at all (AC-4). */
  | "unparsable-file";

/** Emission order, fixed so the warning list is deterministic (AD-4). */
const CODE_ORDER: readonly WarningCode[] = [
  "external-import",
  "outside-universe-import",
  "unparsable-file",
  "unresolved-import",
];

export interface WarningCounter {
  /** `detail` of the first occurrence is kept as the summary's example. */
  record(code: WarningCode, detail: string): void;
  count(code: WarningCode): number;
  toArray(): AnalyzerWarning[];
}

export function createWarningCounter(): WarningCounter {
  const counts = new Map<WarningCode, number>();
  const details = new Map<WarningCode, string>();

  return {
    record(code, detail) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
      if (!details.has(code)) details.set(code, detail);
    },
    count(code) {
      return counts.get(code) ?? 0;
    },
    toArray() {
      return CODE_ORDER.filter((code) => (counts.get(code) ?? 0) > 0).map(
        (code) => ({
          code,
          count: counts.get(code) ?? 0,
          detail: details.get(code),
        }),
      );
    },
  };
}
