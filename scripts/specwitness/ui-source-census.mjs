#!/usr/bin/env node
// A SpecWitness observation: how the UI suite's own sources are written
// (criterion E6-09).
//
// Prints ONE JSON object to stdout.
//
// E6-09 makes two mechanical claims, and both are countable rather than
// judgeable, which is why this observation is worth writing at all:
//
//   1. sources import `HARNESS_HANDLE_KEY` instead of spelling `__gitnebula`;
//   2. every assertion supplies a prose failure message.
//
// The first was written as "a literal `__gitnebula` anywhere in the suite is a
// violation". MEASURED 2026-09-09 AND WRONG: it reported 2 against a suite that
// satisfies the criterion. Both hits are in `src/suite-conventions.test.ts` --
// one inside a comment explaining the rule, one inside the very assertion that
// ENFORCES it (`raw.includes("__gitnebula")`). The criterion is about "UI suite
// sources", i.e. the specs; a checker naming the thing it forbids is not a
// violation of it, and a comment is not code at all. So the count now skips
// comments, skips the convention checker itself, and says so here rather than
// in a commit message nobody reads next to the number. The second is approximate and
// says so -- `expect(...)` calls are counted against those carrying a message
// argument, and a helper that wraps `expect` would not be seen. The number to
// assert on is `expectsWithoutMessage`, whose useful expected value is 0; a
// suite that wraps every assertion in a helper would report 0 for a different
// reason, and that is a reading a human does once rather than a hole a machine
// falls into every run.
//
// Absent directory reports zeroes with `present: false`, for the reason
// `ui-config-shape.mjs` gives: this epic creates it.
//
// FOUR DEFECTS, ONE SHAPE, FOUND IN ONE SITTING (2026-09-09/10). Every fix below
// is the same correction: a regex scan was reading text that is NOT code as if
// it were. It counted the key inside a comment; it counted the key inside the
// test that forbids the key; it read only the first line of a call whose message
// prettier had wrapped; and it counted the word `expect(` inside an assertion's
// own failure message. The reported numbers were 2 and 150 against a suite whose
// true numbers are 0 and 0 -- i.e. this observation failed a criterion the code
// satisfied, twice over, and would have kept doing so.
//
// The lesson is not "write better regexes". It is that every project writing its
// own probes rewrites this class of bug, which is what ADR-009 (a declarative
// `file` surface, with this logic implemented and tested once in the product)
// exists to end. Until story 7.8 lands, this file is the cautionary example.
//
// Usage: node scripts/specwitness/ui-source-census.mjs

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const UI = "packages/viz/ui";
const present = existsSync(UI);
const files = walk(UI).filter((f) => /\.ts$/.test(f));

let literalHandleKey = 0;
let importsHandleKeyConst = 0;
let expectCalls = 0;
let expectsWithoutMessage = 0;
let gotoDirect = 0;
let openViewerUses = 0;

// The suite's own convention checker is excluded from the literal count: it
// necessarily names the key it forbids. Every other source is counted.
const CONVENTION_CHECKER = join(UI, "src", "suite-conventions.test.ts");

// Line and block comments carry no code. Crude on purpose -- it must not need a
// parser to be trustworthy, and over-blanking can only ever LOWER a count that
// is asserted against 0, which would show up as a criterion that stopped
// failing rather than one that quietly started passing.
const withoutComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// Replace the CONTENTS of string and template literals with spaces, keeping the
// quotes and the length. Prose inside a message argument is then invisible to a
// pattern scan while `, "` still reads as "a string argument starts here".
const blankStrings = (src) => {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
        out += c;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
};

for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (f !== CONVENTION_CHECKER) {
    literalHandleKey += [
      ...withoutComments(src).matchAll(/["'`]__gitnebula["'`]/g),
    ].length;
  }
  if (/HARNESS_HANDLE_KEY/.test(src)) importsHandleKeyConst++;
  // E6-07 supporting evidence: navigation goes through the shared helper.
  gotoDirect += [...src.matchAll(/\bpage\.goto\(/g)].length;
  openViewerUses += [...src.matchAll(/\bopenViewer\(/g)].length;

  // Comments are stripped before the scan for the same reason the literal count
  // strips them: `// A bare expect(x).toBe(y) fails with ...` is prose about an
  // assertion, not one. Three of the suite's own convention checks were counted
  // as message-less on 2026-09-09 for exactly that, all three inside the file
  // that documents the rule.
  // String literals go too, not just comments. The last hit standing after
  // three rounds of fixing this scanner was the word `expect(` inside an
  // assertion's own failure MESSAGE -- "…has expect() calls with no failure
  // message" -- i.e. the scanner counting a sentence about assertions as an
  // assertion. Blanking literal bodies (keeping the quotes, so the message
  // check below still sees `, "`) is what stops a regex scanner from reading
  // prose as code. See the note at the top of this file: this is the fourth
  // instance of one shape in one script, and ADR-009 is the answer to it.
  const code = blankStrings(withoutComments(src));
  for (const m of code.matchAll(/\bexpect\(/g)) {
    expectCalls++;
    // A message is the second argument: `expect(value, "why")`.
    //
    // MEASURED 2026-09-09 AND WRONG BEFORE THIS: the scan read only the FIRST
    // LINE of the call and reported 150 of 159 assertions as message-less
    // against a suite where nearly all of them carry one. Prettier breaks a
    // call whose message is a long string across lines, which is what every
    // multi-line `expect(\n  value,\n  "why ..."\n)` in ui/tests looks like, so
    // the message sat on line 3 of a window one line tall.
    //
    // Scanning to the matching parenthesis instead. Crude, and deliberately so:
    // it counts parens outside quotes, which is enough for assertion arguments
    // and needs no parser. An unbalanced tail (a truncated file) stops at the
    // window and is counted as message-less, which fails toward reporting a
    // problem rather than away from it.
    const window = code.slice(m.index + m[0].length, m.index + 2000);
    let depth = 1;
    let quote = null;
    let end = window.length;
    for (let i = 0; i < window.length; i++) {
      const c = window[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    const args = window.slice(0, end);
    // A top-level comma followed by a string literal is the message argument.
    //
    // Regex literals are skipped, not just quotes. `/\b(?:const|let)\b/.test(x)`
    // as an argument would otherwise open two parens that never close at this
    // depth, and the comma after it stops looking top-level -- which is what hid
    // the messages on two of this suite's own assertions. A `/` is only a regex
    // where a value may start, so the previous non-space character decides.
    let d = 0;
    let q = null;
    let hasMessage = false;
    let prev = "";
    for (let i = 0; i < args.length; i++) {
      const c = args[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (
        c === "/" &&
        args[i + 1] !== "/" &&
        args[i + 1] !== "*" &&
        (prev === "" || "([{,=:!&|?+;".includes(prev))
      ) {
        i++;
        while (i < args.length && args[i] !== "/") {
          if (args[i] === "\\") i++;
          else if (args[i] === "[") {
            while (i < args.length && args[i] !== "]") {
              if (args[i] === "\\") i++;
              i++;
            }
          }
          i++;
        }
      } else if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") d--;
      else if (c === "," && d === 0) {
        if (/^\s*["'`]/.test(args.slice(i + 1))) hasMessage = true;
      }
      if (!/\s/.test(c)) prev = c;
    }
    if (!hasMessage) expectsWithoutMessage++;
  }
}

process.stdout.write(
  JSON.stringify({
    present,
    specFileCount: files.filter((f) => f.endsWith(".pw.ts")).length,
    sourceFileCount: files.length,
    literalHandleKeyCount: literalHandleKey,
    filesImportingHandleKeyConst: importsHandleKeyConst,
    expectCalls,
    expectsWithoutMessage,
    pageGotoDirectCount: gotoDirect,
    openViewerUseCount: openViewerUses,
  }) + "\n",
);
