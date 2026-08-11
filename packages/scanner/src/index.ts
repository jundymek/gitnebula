// @gitnebula/scanner — file tree, LOC, language and layer detection.
//
// One analyzer entry (AD-3), plus the exclude and layer-rule *data* cli
// resolves configuration against. The scanner never reads config, the
// environment, the clock or the network itself.

/**
 * Scaffold seam from story 1.1. The cli stub still imports it to prove its
 * AD-2 edge resolves; story 2.4 replaces that import with the real `analyze`
 * call, and this export leaves with it. Not part of the analyzer surface.
 */
export const packageName = "@gitnebula/scanner";

export { analyze } from "./analyze.js";
export type { ScanInput, ScanProgress } from "./analyze.js";

export { compileExcludes, DEFAULT_EXCLUDES } from "./excludes.js";
export type { ExcludeMatcher } from "./excludes.js";

export { compileLayerRules, dominantLayer, LAYER_RULES } from "./layers.js";
export type { LayerResolver, LayerRule } from "./layers.js";

export {
  computeLanguageShares,
  detectLanguage,
  LANGUAGE_BY_EXTENSION,
  UNKNOWN_LANGUAGE,
} from "./languages.js";

export { DESCENT_THRESHOLD, MAX_MODULE_DEPTH } from "./modules.js";
