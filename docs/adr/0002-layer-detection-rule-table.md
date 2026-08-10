# ADR-0002: Layer detection via ordered rule table with config override

- **Status:** accepted
- **Date:** 2026-08-10
- **Resolves:** brief §11 open question 2

## Context

Every node carries a `layer` (`backend | frontend | infra | test | other`) that
drives node colour in Structure mode. The brief requires a heuristic based on
paths and file types, and asks how defaults and overrides should work. The
heuristic must produce visually sensible results on the demo repos (fastapi,
excalidraw, streamlit) without configuration.

## Decision

- Layer assignment is an **ordered rule table**: first matching rule wins.
  Rules match on path segments (e.g. `tests/`, `__tests__`, `infra/`, `.github/`,
  `docker*`) and extensions (e.g. `.tsx/.css/.html` → frontend, `.tf/.yml` in
  infra contexts, `.py` default backend). The exact default table is an
  architecture deliverable, tuned against the demo repos.
- Test detection precedes everything (a test file in `frontend/` is `test`).
- A file that matches nothing is `other` — never a guess.
- **Override:** `.gitnebula.yml` accepts a `layers:` map of glob → layer,
  prepended to the default table (user rules win). No other mechanism.
- A module's layer = the dominant layer of its files by LOC.

## Consequences

- Deterministic and explainable: for any file, the matching rule can be named
  — supports a future `--explain` and keeps snapshot tests stable.
- The default table is data, not code: tuning it never changes analyzer logic.
- The dominant-layer rule means mixed modules (e.g. streamlit's) show one
  colour; per-file truth remains visible at file zoom. Accepted trade-off.
- Wrong classifications in exotic repos are a one-line user fix, not a bug
  report.
