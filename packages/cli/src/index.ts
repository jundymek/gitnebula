// @gitnebula/cli — pipeline orchestration, config, server, build. Published
// as `gitnebula` (AD-11). Story 2.4 implements the pipeline; this stub only
// proves the AD-2 edges and gives the tsup build edge something to bundle.

import { packageName as contractPackageName } from "@gitnebula/contract";
import { packageName as depsPackageName } from "@gitnebula/deps";
import { packageName as githistPackageName } from "@gitnebula/githist";
import { packageName as scannerPackageName } from "@gitnebula/scanner";

export const packageName = "@gitnebula/cli";

export const pipelineEdges = [
  contractPackageName,
  scannerPackageName,
  depsPackageName,
  githistPackageName,
];

export function main(): void {
  console.log(
    `gitnebula scaffold placeholder — pipeline packages wired: ${pipelineEdges.join(", ")}`,
  );
}
