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

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";

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
// Recursive since 2026-09-10. It was a single-level readdirSync over three fixed
// directories, and every per-story report this epic produced lives at
// docs/dev/epic-6/<story>/README.md -- two levels below the `docs/dev` it looked
// in, so E6-23 and E6-28 reported "no such report" against reports that exist.
//
// Fixing the walk does NOT by itself make those two criteria pass, and that is
// deliberate: the search terms below are still hand-picked phrases, and the
// documents that satisfy the criteria use different words. Widening the regexes
// to match the documents now known to exist would be fitting the instrument to
// a result already seen -- the one thing a verifier must never do. The walk was
// wrong on its own terms and is fixed on its own terms; whether those two
// criteria are met is left to the owner to adjudicate.
const findReport = (re) => {
  const walk = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const p = `${dir}/${name}`;
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith(".md")) out.push(p);
    }
    return out;
  };
  for (const dir of ["docs", "packages/viz/ui"]) {
    for (const f of walk(dir)) {
      if (has(read(f), re)) return f;
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
