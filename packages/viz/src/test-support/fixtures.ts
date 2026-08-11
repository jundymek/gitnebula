/**
 * Test-only: loads story 1.3's committed contract fixtures.
 *
 * Imported by `*.test.ts` and nothing else — it uses `node:fs`, which the
 * shipped browser path never may (AD-11). `viz` builds against the contract
 * and its fixtures, never against an analyzer (AD-2), and these documents are
 * that contract made concrete.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnalysisDocument } from "@gitnebula/contract";

const here = dirname(fileURLToPath(import.meta.url));

export const CONTRACT_FIXTURES_DIR = join(
  here,
  "..",
  "..",
  "..",
  "contract",
  "fixtures",
);

export function loadContractFixture(name: string): AnalysisDocument {
  const raw = readFileSync(join(CONTRACT_FIXTURES_DIR, `${name}.json`), "utf8");
  return JSON.parse(raw) as AnalysisDocument;
}

/** The 100-module / 2,000-file document FR-12's settle budget is measured on. */
export function loadSyntheticFixture(): AnalysisDocument {
  return loadContractFixture("synthetic-100x2000");
}
