// Story 4.6, AC-3: the instructional documents may not name a build artefact
// that does not exist.
//
// This class of defect is invisible to a per-story review. Story 4.1 moved the
// binary from `dist/gitnebula.js` to `dist/bin/gitnebula.js` for a reason its
// `tsup.config.ts` spells out; story 4.3 wrote the README against the path that
// existed while it was being written. Both PRs were correct. The *merge*
// produced a README whose one runnable command answered `ENOENT`, and only a
// check running on the merged tree ever sees that.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { buildWorkspace, workspaceRoot } from "./test-support.js";

/**
 * Documents that tell a reader to run something. Deliberately narrow.
 *
 * `docs/implementation-artifacts/` and `docs/dev/` are record-keeping trees
 * where a dead path is usually the subject rather than an instruction — 4.6's
 * own spec names `packages/cli/dist/gitnebula.js` precisely because that file
 * does not exist, and so do the Epic 4 retrospective and 4.1's story record. A
 * check that cannot tell those apart fails forever and gets deleted by whoever
 * next hits it, which is worse than no check. So: two root files, plus the top
 * level of `docs/`, and nothing recursive.
 */
function instructionalDocuments(): string[] {
  const roots = ["README.md", "CONTRIBUTING.md"];
  const docs = readdirSync(join(workspaceRoot, "docs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join("docs", entry.name));
  return [...roots, ...docs].sort();
}

/** Any `packages/<pkg>/dist…` path, file or directory. */
const DIST_REFERENCE = /packages\/[A-Za-z0-9._-]+\/dist(?:\/[A-Za-z0-9._-]+)*/g;

/**
 * The escape hatch, for the day a genuine instruction has to name a path that
 * is not there — quoting the error a reader will hit, say. It is inline and
 * per-occurrence on purpose:
 *
 *     <!-- stale-path-ok: packages/cli/dist/old.js — quoted in the error below -->
 *     …the line the marker guards…
 *
 * A marker covers its own line and the line after it, and nothing else. Making
 * it cover a whole document would switch the check off for every future line
 * of that document — including a runnable command that drifts in later — which
 * is how these checks die.
 */
const EXEMPTION = /<!--\s*stale-path-ok:\s*(\S+)/g;

interface Reference {
  document: string;
  line: number;
  path: string;
}

function referencesIn(document: string): Reference[] {
  const lines = readFileSync(join(workspaceRoot, document), "utf8").split("\n");

  /** `"<line index>\0<path>"` for every occurrence a marker covers. */
  const exempt = new Set(
    lines.flatMap((line, index) =>
      [...line.matchAll(EXEMPTION)].flatMap((match) => [
        `${index}\0${match[1] as string}`,
        `${index + 1}\0${match[1] as string}`,
      ]),
    ),
  );

  return lines.flatMap((line, index) =>
    [...line.matchAll(DIST_REFERENCE)]
      .map((match) => match[0])
      .filter((path) => !exempt.has(`${index}\0${path}`))
      .map((path) => ({ document, line: index + 1, path })),
  );
}

describe("documented build paths (AC-3)", () => {
  beforeAll(() => {
    // The paths are checked against a fresh build, never against whatever
    // `dist/` happens to be lying around: `tsup` cleans its output, so a
    // `dist/` predating 4.1's rename would still hold the dead path and this
    // check would pass on exactly the defect it exists to catch.
    buildWorkspace();
  }, 300_000);

  it("every path an instructional document names exists after `pnpm build`", () => {
    const references = instructionalDocuments().flatMap(referencesIn);

    // A check that matches nothing is a check that proves nothing.
    expect(references.length).toBeGreaterThan(0);

    const missing = references
      .filter(({ path }) => !existsSync(join(workspaceRoot, path)))
      .map(({ document, line, path }) => `${document}:${line} → ${path}`);

    expect(missing).toEqual([]);
  });
});
