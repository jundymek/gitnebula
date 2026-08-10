# Rubric Review — ARCHITECTURE-SPINE.md (gitnebula, 2026-08-10)

- **Artifact:** `docs/planning-artifacts/architecture/architecture-gitnebula-2026-08-10/ARCHITECTURE-SPINE.md`
- **Judged against:** the good-spine rubric; PRD (`docs/planning-artifacts/prds/prd-gitnebula-2026-08-10/prd.md`); ADR-0001..0006
- **Reviewer context:** the spine is the build substrate for 5 parallel terminal-agents, one pnpm package each; its ADs are the only thing keeping independently built packages compatible.
- **Verdict: needs-work.** The ADs it has are good — enforceable, ADR-consistent, PRD-consistent, and the capability map covers FR-1..FR-25 with no gaps. What fails the rubric is coverage of the *mechanical* divergence points: build/module-system/packaging, the analysis.json loading contract between cli and viz, and test-fixture-repo mechanics are all unfixed, and each one is a place where two agents will plausibly choose incompatibly during MVP stories.

---

## Findings

### F-1 [critical] — Publishing/packaging of the `gitnebula` npm artifact is completely unspecified

Conventions say "only `gitnebula` (the cli package) is published." But cli depends on scanner, deps, githist, contract (unpublished workspace packages), must ship the viz `dist/` it serves (AD-2's dashed edge), and must ship the tree-sitter `.wasm` grammar (AD-8: "load from a filesystem path" — which path, inside whose package? The seed puts the .wasm in `deps/`, but `deps` is never published). Nothing says how any of this reaches the published tarball: bundle workspace deps with tsup/esbuild? pnpm `publishConfig` rewrite? copy viz dist into cli at prepack? `npx gitnebula` (FR-1, the product's front door) is unimplementable until someone decides, and the cli agent and viz agent will each assume the other handles asset placement. The whole release dimension (npm publish flow, package semver vs `schemaVersion`, prepack pipeline) is silent — the Deferred section's "operational envelope" note covers deploy/CI but not publishing, and this cannot be deferred: it constrains how every package builds (see F-2).

**Fix:** add an AD naming the publish artifact strategy (e.g. "cli is bundled with tsup at prepack; viz dist and the .wasm are copied into `cli/assets/` by the cli build; workspace deps are inlined, never published") plus a Stack row for the bundler.

### F-2 [high] — No TS module system, no per-package build tool, no source-vs-dist consumption rule

The Stack names Vite for viz only. For the five Node packages nothing fixes: ESM vs CJS (`"type": "module"`? `NodeNext` resolution? — a published CLI on Node ≥ 20 makes this a real fork), tsc vs tsup vs unbuilt, whether workspace imports resolve to `src/` (via `exports` conditions / tsconfig paths) or to built `dist/` (forcing build ordering), and tsconfig layout (shared base? project references?). Five agents building packages in parallel *will* diverge here — this is the single most predictable incompatibility class in a pnpm workspace, and no AD or convention touches it.

**Fix:** one convention block: module system (recommend pure ESM, `moduleResolution: NodeNext`), one build tool for Node packages, a shared `tsconfig.base.json`, and the rule for how workspace packages consume each other during dev and test.

### F-3 [high] — The viz ⇄ data loading contract (dev / served / bundle) is not fixed

ADR-0004 requires "the same data-loading path serves dev mode (fixtures), local serve, and the bundle — one code path." The spine restates only "dev mode loads contract fixtures" in a seed comment. Nothing fixes the actual interface: viz fetches `./analysis.json` (relative, sibling)? `/analysis.json` (absolute)? Which fixture the Vite dev server aliases to that URL? What URL the cli server must expose? The cli agent and the viz agent must agree on this string and neither AD-1 (contract types) nor AD-2 (dependency edges) covers it — it's a runtime URL convention, not a type. A mismatch surfaces only at integration, exactly what the spine exists to prevent. Same gap: the schemaVersion-mismatch error screen (FR-6) implies viz validates major version on load — worth a sentence on where that check lives.

**Fix:** an AD or convention row: "viz fetches `analysis.json` as a same-directory sibling (`./analysis.json`) in every mode; dev serves a chosen contract fixture at that URL; the cli server and `build` place the file accordingly" (this is also what ADR-0004's sibling-file decision implies).

### F-4 [high] — Test-fixture repo mechanics unaddressed (git repo inside a git repo)

`test-fixtures/` promises "purpose-built fixture repo(s) with crafted git history" and githist's unit tests (FR-10) depend on it — but a nested `.git` directory cannot simply be committed (git refuses / treats it as a gitlink), and CI checkouts won't reproduce it. The known solutions (commit the dir with `.git` renamed to `_git` and restore in test setup; a tarball unpacked at test time; a deterministic build script with fixed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` so history hashes are stable) have different determinism and DX properties, and githist + scanner + cli integration tests all touch it. This is a cross-story mechanism, not a story detail — two agents inventing two mechanisms means incompatible test infra and flaky CI.

**Fix:** one convention row fixing the mechanism (recommend a checked-in build script with pinned author/committer dates, run once in CI before tests, output gitignored).

### F-5 [medium] — Exclusion-glob semantics and the "node universe" rule are unowned

FR-4: "exclusion globs remove matching files from every stage." AD-3 puts config resolution in cli, but not glob *application*: does scanner alone apply excludes and downstream stages trust `ScanResult` as the closed node universe (so githist ignores git-log paths not in it, deps ignores resolutions landing outside it)? Or does each stage re-match globs — with which library and semantics (picomatch vs minimatch differ on dotfiles and `**`)? If githist counts commits touching excluded paths toward module churn while scanner drops those files, the numbers silently disagree. Also: no glob library appears in the Stack at all, yet scanner needs one.

**Fix:** state "ScanResult's node set is the universe; deps and githist drop any path not in it (counted per AD-7); globs are matched only in scanner, with `<library>`" and add the library to the Stack.

### F-6 [medium] — Stack: one landmine and several gaps

Verified current: Vite 8.x ✓ (stable, Rolldown-based), vitest 4.x ✓, web-tree-sitter 0.26.x ✓, pnpm 10 ✓, d3-force 3 ✓, ajv 8 ✓. But:

- **Landmine:** web-tree-sitter 0.26.x has a known WASM **ABI incompatibility** with grammar `.wasm` files built by older tree-sitter-cli (tree-sitter/tree-sitter#5171 — e.g. the popular `tree-sitter-wasms` prebuilt package fails to load). The `tree-sitter-python` npm package does not ship a prebuilt `.wasm`; someone must build it with a matching tree-sitter-cli. "Exact WASM load mechanics" is deferred, but *how the .wasm is produced and version-locked to web-tree-sitter* is a toolchain decision, not load mechanics — the Stack should pin tree-sitter-cli and state the grammar is built in-repo (or name a compatible prebuilt source).
- **Gaps:** no HTTP server choice for FR-5 (Node `node:http`? a micro-framework? — single package, so low, but say "node:http, no framework" to prevent an express import), no browser-open utility (`open`?), no PNG/canvas note for the ≥ 2× export (`canvas.toBlob` with an offscreen re-render — viz-internal, low), no bundler for F-1/F-2, no glob lib for F-5. `commander`/`yaml` "current" is loose — acceptable given "pin at first story" but that note is attached only to vitest.

### F-7 [medium] — PRD constants delegated to "architecture" are neither fixed nor explicitly re-deferred

The PRD's Assumptions Index sends several numbers to architecture: the "Settled" definition constants (pixel bound + consecutive-frame count — FR-12's 2–3 s test cannot be written without them), the full default-exclude list (FR-4), and descent thresholds (FR-9). The spine defers the latter two to stories (defensible — data, single package, and the Deferred section says so), but "Settled" constants appear nowhere — not fixed, not deferred. Since FR-12's acceptance test and the perf-spike story both need the same numbers, put them in the spine (e.g. "max displacement < 0.5 px for 30 consecutive frames, tunable in one viz constant") or add them to Deferred with an owner story.

### F-8 [low] — Minor enforceability and ambiguity nits

- **AD-2**: `package.json` edges stop undeclared imports under pnpm's strict linking ✓, but not *deep* imports along allowed edges (`@gitnebula/contract/src/internal`). One sentence — "every package declares an `exports` map; deep imports are impossible" — closes it and also serves F-2.
- **AD-4**: bans `Date.now`/`Math.random` but names no enforcement (lint rule? review?). The rule is checkable, so this is minor; a `no-restricted-globals` ESLint note would make it self-enforcing. (Relatedly: no lint/format tooling appears anywhere — five agents, five styles; low because prettier defaults mostly converge.)
- **AD-9**: "derived from or CI-checked against" is a two-way fork, but it lands inside the single contract package/story, so it cannot cause cross-agent divergence — leave to the story, or pick one (recommend: schema is source, types generated).
- **Module-edge aggregation ownership**: ADR-0005 says analyzers aggregate module-level edges/co-changes (deps, githist respectively); the spine's pipeline has an "assemble" stage in cli that an agent could read as the aggregation point. The contract's `DepsResult`/`GitResult` types will disambiguate, but a parenthetical in AD-1 ("aggregation to module level happens inside deps/githist, per ADR-0005; cli's assemble only merges and validates") is cheap insurance.

## Rubric checks that PASS

- **Capability map:** FR-1..FR-25 fully covered, no orphan FRs, governance assignments sensible.
- **ADR consistency:** AD-4 = ADR-0005 §5 verbatim; AD-8 matches ADR-0001's WASM decision; AD-5/AD-6 consistent with ADR-0006 (including local-settle constraint left to viz stories, acceptably); AD-10 matches FR-8; seeded layout (AD-6) legitimately resolves PRD §8 Q6, which the PRD delegated to architecture. No contradictions found.
- **Deferred hygiene:** with the exceptions in F-1/F-4 (which are missing, not wrongly deferred), every deferred item is confined to a single package's stories and cannot cause cross-agent divergence now.
- **Error/warning shape, determinism sorts, node-id convention, cross-env rule, dependency diagram:** all concrete and enforceable.

## Verdict

**needs-work.** No AD is wrong; the spine is missing ADs. F-1..F-4 are exactly the class of divergence the rubric asks about — mechanical seams between packages that types don't capture — and all four are cheap to fix (one packaging AD, one build-conventions block, one data-URL convention, one fixture-mechanism row). With those added, this is ready.
