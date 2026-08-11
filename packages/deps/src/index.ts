// @gitnebula/deps — import parsing (TS/JS via compiler API, Python via
// web-tree-sitter) producing dependency edges. Story 2.2 implements the
// analyzer; this stub only proves the AD-2 edge.

import { packageName as contractPackageName } from "@gitnebula/contract";

export const packageName = "@gitnebula/deps";
export const contractEdge = contractPackageName;
