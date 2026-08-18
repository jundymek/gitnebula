import eslintJs from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "test-fixtures/.generated/**",
      "_bmad/**",
      "reference/**",
      // Untracked promo-video workspace (see .gitignore) — not project source.
      // Listed here too, or the lint is red in a working copy that has it and
      // green on a fresh clone, which teaches everyone to ignore a red lint.
      "marketing/**",
      // Generated from analysis.schema.json (AD-9) — the generator owns its
      // formatting, and CI fails on any drift from a fresh regeneration.
      "packages/contract/src/generated/**",
    ],
  },
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    // Package build tooling: runs in Node, outside any package's runtime path.
    files: ["packages/*/scripts/**/*.mjs"],
    languageOptions: {
      globals: { URL: "readonly", console: "readonly", process: "readonly" },
    },
  },
  {
    // Repository tooling: Node scripts that also carry `page.evaluate`
    // callbacks, which are serialized and run inside the browser — hence the
    // DOM globals next to the Node ones. Nothing here ships.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        document: "readonly",
      },
    },
  },
  {
    // AD-4: the analysis pipeline is deterministic — the same repo at the
    // same commit must produce byte-identical analysis.json. Timestamps come
    // from git data, randomness from a contract-provided seed. viz and cli
    // are exempt from this specific ban.
    files: [
      "packages/scanner/**/*.ts",
      "packages/deps/**/*.ts",
      "packages/githist/**/*.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message:
            "AD-4: analyzers must be deterministic — take timestamps from git data (windowAnchor), not the clock.",
        },
        {
          object: "Math",
          property: "random",
          message:
            "AD-4: analyzers must be deterministic — randomness must flow from a contract-provided seed.",
        },
      ],
    },
  },
);
