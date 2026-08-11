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
    ],
  },
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
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
