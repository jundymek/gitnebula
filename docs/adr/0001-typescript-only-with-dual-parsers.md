# ADR-0001: TypeScript-only toolchain; TS compiler API + tree-sitter WASM for parsing

- **Status:** accepted
- **Date:** 2026-08-10
- **Resolves:** brief §11 open question 1

## Context

The brief prefers a single-runtime TypeScript monorepo (distribution via `npx`
is a product requirement) but flags an open question: is Python import analysis
feasible in TS (tree-sitter-python), or is a separate Python analyzer needed?
Separately, the brief suggests tree-sitter for all import parsing.

Two constraints dominate:

1. **Zero-config `npx`** — nothing in the install path may require a native
   build toolchain (node-gyp) on the user's machine.
2. **Edge correctness in TS repos** — modern TS projects route imports through
   `tsconfig.json` path aliases (`@/…`), `baseUrl`, `index.ts` and re-export
   chains. A syntax-level parser sees the import string but cannot resolve it
   to a file, producing wrong or missing edges in most real repos.

## Decision

- The whole project is TypeScript, one runtime, one monorepo. No Python
  analyzer process.
- **TS/JS imports:** parsed and resolved with the TypeScript compiler API
  (`ts.resolveModuleName` against the repo's own `tsconfig.json`), a pure-JS
  dependency.
- **Python imports:** parsed with tree-sitter-python via the **WASM build**
  (web-tree-sitter) — no native bindings, no node-gyp — resolved against repo
  layout with our own module-resolution logic (absolute + relative intra-repo
  imports).

## Consequences

- The `npx` path stays free of native compilation on every platform.
- TS edges are resolution-correct (aliases, index files, re-exports), which a
  tree-sitter-based approach could not deliver without reimplementing the
  resolver.
- Python resolution is our own logic and will be simpler than CPython's real
  rules (no namespace-package edge cases in MVP); the unresolved-import
  counter (PRD FR-11) is the guardrail.
- WASM parser startup cost lands in the analysis budget (PRD SM-1); measured
  in the Epic 1 spike.
- Adding a language post-MVP = adding a tree-sitter WASM grammar + a resolver,
  no runtime change.
