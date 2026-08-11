// Generates the committed TypeScript types from analysis.schema.json (AD-9:
// the schema is the source, the types are generated). Run it with
// `pnpm --filter @gitnebula/contract generate`; CI regenerates and fails on a
// diff, so hand-editing the output cannot survive.
//
// This script is build tooling, not part of the package's runtime path — it
// may use `node:` modules, which src/ may not (AC-5).
import { readFile, writeFile } from "node:fs/promises";

import { compile } from "json-schema-to-typescript";

const schemaUrl = new URL("../src/analysis.schema.json", import.meta.url);
const outputUrl = new URL("../src/generated/analysis.ts", import.meta.url);

const banner = `/**
 * This file was generated from analysis.schema.json — do not edit it by hand.
 * Change the schema and run \`pnpm --filter @gitnebula/contract generate\`.
 */`;

const schema = JSON.parse(await readFile(schemaUrl, "utf8"));

const types = await compile(schema, "AnalysisDocument", {
  bannerComment: banner,
  additionalProperties: false,
  declareExternallyReferenced: true,
  enableConstEnums: false,
  style: { singleQuote: false },
});

await writeFile(outputUrl, types, "utf8");
