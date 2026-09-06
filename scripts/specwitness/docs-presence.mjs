#!/usr/bin/env node
// A SpecWitness observation: which documents this epic promised to write exist,
// and whether each covers the topics its criterion names
// (criteria E6-06, E6-17, E6-23, E6-28, E6-32).
//
// Prints ONE JSON object to stdout.
//
// THE LIMIT OF THIS OBSERVATION, STATED UP FRONT.
//
// A criterion like E6-17 ("the README records that boot() previously had no
// test execution, ... explains why real-coordinate picking is not
// representable by the jsdom fake canvas") is a claim about whether a piece of
// writing EXPLAINS something. No script can decide that. What a script can
// decide is whether the document exists and whether it mentions each subject
// at all -- and a document that never mentions `boot()` certainly does not
// explain it.
//
// So every field here is a NECESSARY condition, never a sufficient one. A
// criterion whose topics are all `true` still needs a reader; a criterion with
// a `false` is settled without one. That asymmetry is the whole value: it
// removes the cheap failures from a reviewer's plate and leaves the judgement.
//
// Named `*Mentions*` rather than `*Documents*` for that reason. A field called
// `documentsBootGap` would be a lie about what was measured.
//
// Usage: node scripts/specwitness/docs-presence.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const has = (src, re) => (src === null ? false : re.test(src));

// E6-06, E6-17 -- the UI suite README.
const uiReadme = read("packages/viz/ui/README.md");

// E6-32 -- a house-format ADR for the fifth legend hue.
const adrDir = "docs/adr";
const adrs = existsSync(adrDir)
  ? readdirSync(adrDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
  : [];
let legendAdr = null;
for (const f of adrs) {
  const src = read(`${adrDir}/${f}`);
  if (has(src, /legend/i) && has(src, /(colour|color|hue)/i)) {
    legendAdr = {
      file: f,
      hasContext: has(src, /##\s*Context/i),
      hasDecision: has(src, /##\s*Decision/i),
      hasConsequences: has(src, /##\s*Consequences/i),
    };
    break;
  }
}

// E6-23, E6-28 -- the two reports this epic produces. Location is not fixed by
// the contract, so both the docs tree and the suite directory are searched.
const findReport = (re) => {
  for (const dir of ["docs", "docs/dev", "packages/viz/ui"]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const src = read(`${dir}/${f}`);
      if (has(src, re)) return `${dir}/${f}`;
    }
  }
  return null;
};

const validatorReport = findReport(/validator[- ]gap|required-versus-checked/i);
const layoutReport = findReport(/layout report|viewport heights tested/i);
const vSrc = read(validatorReport ?? "");
const lSrc = read(layoutReport ?? "");

process.stdout.write(
  JSON.stringify({
    // E6-06 / E6-17
    uiReadmePresent: uiReadme !== null,
    uiReadmeMentionsOnDemandSeparation: has(
      uiReadme,
      /on[- ]demand|separate|not part of `?pnpm test`?/i,
    ),
    uiReadmeMentionsBootGap: has(uiReadme, /boot\(\)/),
    uiReadmeMentionsCaptureRestore: has(uiReadme, /captur\w+|restor\w+/i),
    uiReadmeMentionsJsdomCanvas: has(uiReadme, /jsdom/i),
    uiReadmeMentionsHandleReacquire: has(
      uiReadme,
      /reacquir|re-acquir|after (a )?swap/i,
    ),
    // E6-32
    adrCount: adrs.length,
    legendAdrFile: legendAdr?.file ?? null,
    legendAdrHasContext: legendAdr?.hasContext ?? false,
    legendAdrHasDecision: legendAdr?.hasDecision ?? false,
    legendAdrHasConsequences: legendAdr?.hasConsequences ?? false,
    // E6-23
    validatorReportPath: validatorReport,
    validatorReportMentionsNoValidatorChange: has(
      vSrc,
      /without changing|unchanged/i,
    ),
    validatorReportMentionsFutureAlignment: has(vSrc, /future|widen/i),
    // E6-28
    layoutReportPath: layoutReport,
    layoutReportMentionsContentLength: has(lSrc, /content length/i),
    layoutReportMentionsViewportHeights: has(lSrc, /viewport height/i),
    layoutReportMentionsUnreachable: has(lSrc, /unreachable/i),
  }) + "\n",
);
