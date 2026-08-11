// @gitnebula/viz — the browser viewer: GraphEngine + chrome (AD-5).
// Story 2.5 builds the engine; this stub only proves the AD-2 edge.
// viz depends on the contract and its fixtures — never on the analyzers.

import { packageName as contractPackageName } from "@gitnebula/contract";

export const packageName = "@gitnebula/viz";
export const contractEdge = contractPackageName;
