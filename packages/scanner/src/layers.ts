// Layer detection: an ordered rule table, first match wins (ADR-0002).
// The table is *data* — tuning it never touches analyzer logic — and is
// exported so cli can show it and so the tuning argument lives in one place.

import type { Layer } from "@gitnebula/contract";
import picomatch from "picomatch";

/** One entry of the ordered table: a glob and the layer it assigns. */
export interface LayerRule {
  readonly glob: string;
  readonly layer: Layer;
}

/**
 * The default table, in precedence order.
 *
 * Test detection comes first and unconditionally: a test file under
 * `frontend/` is `test`, not `frontend` (ADR-0002). Infra follows, because a
 * `Dockerfile` in `web/` is infrastructure regardless of where it sits.
 * Frontend precedes backend so that directory conventions (`web/`, `client/`)
 * beat the generic language extensions underneath them. A path matching
 * nothing is `other` — never a guess.
 *
 * User `layers:` globs from `.gitnebula.yml` are *prepended* to this table by
 * {@link compileLayerRules}, so they win over every rule here, test detection
 * included (ADR-0002: "user rules win").
 */
export const LAYER_RULES: readonly LayerRule[] = [
  // --- tests, first and unconditional -------------------------------------
  { glob: "**/test/**", layer: "test" },
  { glob: "**/tests/**", layer: "test" },
  { glob: "**/__tests__/**", layer: "test" },
  { glob: "**/__mocks__/**", layer: "test" },
  { glob: "**/spec/**", layer: "test" },
  { glob: "**/e2e/**", layer: "test" },
  { glob: "**/*.test.*", layer: "test" },
  { glob: "**/*.spec.*", layer: "test" },
  { glob: "**/test_*.py", layer: "test" },
  { glob: "**/*_test.py", layer: "test" },
  { glob: "**/*_test.go", layer: "test" },
  { glob: "**/conftest.py", layer: "test" },
  { glob: "**/fixtures/**", layer: "test" },
  { glob: "**/test-fixtures/**", layer: "test" },
  { glob: "**/*.fixture.*", layer: "test" },

  // --- infrastructure -----------------------------------------------------
  { glob: ".github/**", layer: "infra" },
  { glob: ".circleci/**", layer: "infra" },
  { glob: "**/infra/**", layer: "infra" },
  { glob: "**/infrastructure/**", layer: "infra" },
  { glob: "**/deploy/**", layer: "infra" },
  { glob: "**/deployment/**", layer: "infra" },
  { glob: "**/ops/**", layer: "infra" },
  { glob: "**/ansible/**", layer: "infra" },
  { glob: "**/terraform/**", layer: "infra" },
  { glob: "**/helm/**", layer: "infra" },
  { glob: "**/k8s/**", layer: "infra" },
  { glob: "**/kubernetes/**", layer: "infra" },
  { glob: "**/.devcontainer/**", layer: "infra" },
  { glob: "**/Dockerfile", layer: "infra" },
  { glob: "**/Dockerfile.*", layer: "infra" },
  { glob: "**/*.dockerfile", layer: "infra" },
  { glob: "**/docker-compose*.yml", layer: "infra" },
  { glob: "**/docker-compose*.yaml", layer: "infra" },
  { glob: "**/*.tf", layer: "infra" },
  { glob: "**/*.tfvars", layer: "infra" },
  { glob: "**/Makefile", layer: "infra" },
  { glob: "**/.gitlab-ci.yml", layer: "infra" },
  { glob: "**/Jenkinsfile", layer: "infra" },

  // --- frontend -----------------------------------------------------------
  { glob: "**/*.tsx", layer: "frontend" },
  { glob: "**/*.jsx", layer: "frontend" },
  { glob: "**/*.vue", layer: "frontend" },
  { glob: "**/*.svelte", layer: "frontend" },
  { glob: "**/*.css", layer: "frontend" },
  { glob: "**/*.scss", layer: "frontend" },
  { glob: "**/*.sass", layer: "frontend" },
  { glob: "**/*.less", layer: "frontend" },
  { glob: "**/*.styl", layer: "frontend" },
  { glob: "**/*.html", layer: "frontend" },
  { glob: "**/*.htm", layer: "frontend" },
  { glob: "**/frontend/**", layer: "frontend" },
  { glob: "**/client/**", layer: "frontend" },
  { glob: "**/web/**", layer: "frontend" },
  { glob: "**/webapp/**", layer: "frontend" },
  { glob: "**/ui/**", layer: "frontend" },
  { glob: "**/components/**", layer: "frontend" },
  { glob: "**/pages/**", layer: "frontend" },
  { glob: "**/views/**", layer: "frontend" },
  { glob: "**/public/**", layer: "frontend" },
  { glob: "**/static/**", layer: "frontend" },
  { glob: "**/assets/**", layer: "frontend" },

  // --- backend ------------------------------------------------------------
  { glob: "**/backend/**", layer: "backend" },
  { glob: "**/server/**", layer: "backend" },
  { glob: "**/api/**", layer: "backend" },
  { glob: "**/*.py", layer: "backend" },
  { glob: "**/*.pyi", layer: "backend" },
  { glob: "**/*.go", layer: "backend" },
  { glob: "**/*.rs", layer: "backend" },
  { glob: "**/*.rb", layer: "backend" },
  { glob: "**/*.java", layer: "backend" },
  { glob: "**/*.kt", layer: "backend" },
  { glob: "**/*.scala", layer: "backend" },
  { glob: "**/*.cs", layer: "backend" },
  { glob: "**/*.php", layer: "backend" },
  { glob: "**/*.ex", layer: "backend" },
  { glob: "**/*.exs", layer: "backend" },
  { glob: "**/*.c", layer: "backend" },
  { glob: "**/*.h", layer: "backend" },
  { glob: "**/*.cpp", layer: "backend" },
  { glob: "**/*.hpp", layer: "backend" },
  { glob: "**/*.sql", layer: "backend" },
  { glob: "**/*.ts", layer: "backend" },
  { glob: "**/*.mts", layer: "backend" },
  { glob: "**/*.cts", layer: "backend" },
  { glob: "**/*.js", layer: "backend" },
  { glob: "**/*.mjs", layer: "backend" },
  { glob: "**/*.cjs", layer: "backend" },
];

/** Resolves one repository-relative POSIX path to its layer. */
export type LayerResolver = (relativePath: string) => Layer;

/**
 * Compiles a resolver from the user's override map and the default table.
 *
 * `overrides` is `Config.layers` — glob to layer, straight from
 * `.gitnebula.yml` by way of cli. Its entries are prepended in insertion
 * order, so a user rule beats every default rule (ADR-0002).
 */
export function compileLayerRules(
  overrides: Readonly<Record<string, Layer>> = {},
  table: readonly LayerRule[] = LAYER_RULES,
): LayerResolver {
  const rules: LayerRule[] = [
    ...Object.entries(overrides).map(([glob, layer]) => ({ glob, layer })),
    ...table,
  ];
  const compiled = rules.map((rule) => ({
    isMatch: picomatch(rule.glob, { dot: true }),
    layer: rule.layer,
  }));

  return (relativePath: string) => {
    for (const rule of compiled) {
      if (rule.isMatch(relativePath)) return rule.layer;
    }
    return "other";
  };
}

/**
 * A module's layer is the dominant layer of its files by LOC (ADR-0002).
 *
 * Ties break on the fixed layer order below rather than on iteration order —
 * two runs over the same repository must agree (AD-4). A module whose files
 * are all empty has no LOC to be dominant with, so it falls to `other`.
 */
const LAYER_TIE_BREAK: readonly Layer[] = [
  "backend",
  "frontend",
  "infra",
  "test",
  "other",
];

export function dominantLayer(
  locByLayer: Readonly<Partial<Record<Layer, number>>>,
): Layer {
  let best: Layer = "other";
  let bestLoc = 0;
  for (const layer of LAYER_TIE_BREAK) {
    const loc = locByLayer[layer] ?? 0;
    if (loc > bestLoc) {
      best = layer;
      bestLoc = loc;
    }
  }
  return best;
}
