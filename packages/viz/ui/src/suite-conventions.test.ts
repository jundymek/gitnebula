import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Story 6.1, AC-1 and AC-6 — the suite's conventions asserted against the
 * suite's own source text.
 *
 * This is a **vitest** file, not a Playwright spec, and that is deliberate on
 * two counts. These are claims about source text, so booting a browser to read
 * a file would be theatre; and the `ui` suite runs on demand
 * (`pnpm --filter @gitnebula/viz ui`), so a convention check living inside it
 * would only run when someone remembered to run it — precisely the enforcement
 * gap it exists to close. Here it runs in `pnpm --filter @gitnebula/viz test`,
 * on every commit, with no browser installed.
 *
 * The shape is story 5.6's no-`localeCompare` check
 * (`src/chrome/blast-radius.test.ts:143`): an acceptance criterion stated as a
 * property of the source is asserted against the source.
 *
 * It globs `ui/tests/` rather than naming files, so the specs stories 6.2, 6.3
 * and 6.4 add are covered the moment they land, without anyone remembering to
 * extend this list.
 */

const here = dirname(fileURLToPath(import.meta.url));
const suiteRoot = join(here, "..");
const testsDir = join(suiteRoot, "tests");

function specFiles(): readonly string[] {
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".pw.ts"))
    .sort();
}

function readSpec(name: string): string {
  return readFileSync(join(testsDir, name), "utf8");
}

/**
 * Strips string literals, template literals and comments, replacing each with
 * an equal number of spaces so that offsets are preserved.
 *
 * Every check below is about *code* — a `page.goto` inside a comment
 * explaining why we do not call `page.goto` must not fail the check, and the
 * word `expect` inside a failure message must not be counted as an assertion.
 * Blanking rather than deleting keeps reported positions honest.
 */
function blankLiteralsAndComments(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) {
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out[i] = " ";
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out[i] = " ";
          if (i + 1 < source.length && source[i + 1] !== "\n") out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          out[i] = " ";
          i++;
          break;
        }
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Given the index of the `(` that opens an argument list, returns whether that
 * list contains a top-level comma — i.e. whether the call was given a second
 * argument. Nested calls, objects and arrays are skipped by depth.
 */
function hasSecondArgument(code: string, openParen: number): boolean {
  let depth = 0;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return false;
    } else if (ch === "," && depth === 1) return true;
  }
  return false;
}

describe("the ui suite's own conventions (AC-1, AC-6)", () => {
  it("has specs to check at all", () => {
    // A source check that silently matched nothing would report green forever
    // — the same class of false green story 5.9 found in a pnpm filter that
    // matched no project.
    expect(
      specFiles(),
      "no *.pw.ts specs were found in ui/tests — every check in this file " +
        "would then be vacuously green",
    ).not.toHaveLength(0);
  });

  it("imports HARNESS_HANDLE_KEY rather than writing the literal (AC-6)", () => {
    // The key is exported from `src/harness-handle.ts`. Writing `"__gitnebula"`
    // out in a spec forks the constant: renaming it would leave the suite
    // green against a handle that no longer exists.
    for (const name of specFiles()) {
      const code = blankLiteralsAndComments(readSpec(name));
      const raw = readSpec(name);
      expect(
        { file: name, writesLiteral: raw.includes("__gitnebula") },
        `${name} writes the handle key out as a literal; import ` +
          "HARNESS_HANDLE_KEY from src/harness-handle.js instead",
      ).toEqual({ file: name, writesLiteral: false });
      expect(
        { file: name, imports: code.includes("HARNESS_HANDLE_KEY") },
        `${name} never references HARNESS_HANDLE_KEY — a spec that does not ` +
          "reach the harness handle is not driving the Viewer",
      ).toEqual({ file: name, imports: true });
    }
  });

  it("gives every expect a prose failure message (AC-6)", () => {
    // A bare `expect(x).toBe(y)` fails with `expected false to be true`, which
    // tells a reader nothing about what broke. Every assertion here explains
    // itself, exactly as the perf and bundle suites do.
    for (const name of specFiles()) {
      const code = blankLiteralsAndComments(readSpec(name));
      const bare: number[] = [];
      const pattern = /\bexpect\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        const openParen = code.indexOf("(", match.index);
        if (!hasSecondArgument(code, openParen)) {
          bare.push(code.slice(0, match.index).split("\n").length);
        }
      }
      expect(
        { file: name, bareExpectsOnLines: bare },
        `${name} has expect() calls with no failure message; pass prose as ` +
          "the second argument so a red run says what broke",
      ).toEqual({ file: name, bareExpectsOnLines: [] });
    }
  });

  it("navigates through openViewer, never page.goto (AC-4)", () => {
    // `page.goto` resolves on the load event, but the Viewer boots
    // asynchronously — it fetches analysis.json before it can build an engine.
    // A spec that navigates directly races the boot and fails intermittently,
    // in whichever spec won the scheduler that run. `openViewer` waits for the
    // handle, and it is shared so that the fix stays in one place.
    for (const name of specFiles()) {
      const code = blankLiteralsAndComments(readSpec(name));
      expect(
        { file: name, callsGoto: /\.goto\s*\(/.test(code) },
        `${name} calls page.goto directly; use openViewer from ` +
          "harness/page-helpers.js, which waits for the harness handle",
      ).toEqual({ file: name, callsGoto: false });
    }
  });
});

describe("the ui suite's Playwright config (AC-1, AC-2)", () => {
  const config = readFileSync(join(suiteRoot, "playwright.config.ts"), "utf8");

  it("matches the house style the two existing suites set (AC-1)", () => {
    const required: ReadonlyArray<readonly [string, string]> = [
      ['testDir: "./tests"', "specs live in ./tests"],
      ['testMatch: "**/*.pw.ts"', "only .pw.ts files are Playwright specs"],
      ["workers: 1", "one worker — one dev server, one boot at a time"],
      ["fullyParallel: false", "specs do not interleave their navigations"],
      ["retries: 0", "a run is evidence, not a flake to retry away"],
      ["viewport: { width: 1440, height: 900 }", "a fixed viewport"],
      ["deviceScaleFactor: 1", "a pinned DPR"],
    ];
    for (const [needle, why] of required) {
      expect(
        { setting: needle, present: config.includes(needle) },
        `ui/playwright.config.ts no longer declares \`${needle}\` (${why}); ` +
          "the three suites are meant to agree on this",
      ).toEqual({ setting: needle, present: true });
    }
  });

  it("keeps the server isolation that the lsof incident bought (AC-2)", () => {
    // Story 3.5's review found a green 8-passed run that `lsof` traced to
    // another worktree's dev server entirely. `reuseExistingServer: false` and
    // `--strictPort` are what stop that recurring, and they are the two
    // settings most likely to be "tidied up" by someone who reads them as
    // noise. Asserted here so tidying them fails a test rather than a release.
    expect(
      config.includes("reuseExistingServer: false"),
      "ui/playwright.config.ts no longer sets reuseExistingServer: false — " +
        "the suite can now attach to another worktree's server and report a " +
        "pass over code that is not under test",
    ).toBe(true);
    // Matched inside the `command:` template literal rather than anywhere in
    // the file. The first version of this check was `config.includes(...)`,
    // and deleting `--strictPort` from the command left it green — the
    // *comment* below the setting mentions the flag too, and that was enough
    // to satisfy it. A check that a comment can satisfy is not a check.
    const command = /command:\s*`([^`]*)`/.exec(config)?.[1] ?? "";
    expect(
      command,
      "ui/playwright.config.ts has no webServer.command template literal to " +
        "read, so the flags below cannot be verified at all",
    ).not.toHaveLength(0);
    expect(
      command.includes("--strictPort"),
      `the dev-server command (\`${command}\`) no longer passes ` +
        "--strictPort — a port collision would silently move the server " +
        "instead of failing, which is how a run measures the wrong checkout",
    ).toBe(true);
    expect(
      config.includes("lsof"),
      "the comment naming the lsof incident is gone from " +
        "ui/playwright.config.ts; without it the two settings above read as " +
        "noise and get removed",
    ).toBe(true);
  });

  it("takes port 4320 and UI_PORT, continuing the series (AC-2)", () => {
    // PERF_PORT 4318, BUNDLE_PORT 4319, UI_PORT 4320. The override is what
    // lets several agent worktrees run their suites at once.
    expect(
      config.includes("process.env.UI_PORT ?? 4320"),
      "the ui suite no longer defaults to port 4320 with a UI_PORT override; " +
        "the series PERF_PORT 4318 / BUNDLE_PORT 4319 / UI_PORT 4320 is how " +
        "concurrent worktrees stay out of each other's way",
    ).toBe(true);
  });

  it("pins the fixture rather than inheriting the dev default (AC-7)", () => {
    // Without this the dev server serves `synthetic-100x2000` — the perf
    // yardstick — and wave B's assertions would run against the wrong
    // document while looking entirely normal.
    expect(
      config.includes('GITNEBULA_FIXTURE: "root-files"'),
      "ui/playwright.config.ts no longer pins GITNEBULA_FIXTURE=root-files; " +
        "the suite would inherit the 2,000-file perf fixture instead",
    ).toBe(true);
  });
});
