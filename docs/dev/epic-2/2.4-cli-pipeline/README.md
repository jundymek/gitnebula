# 2.4 — CLI pipeline: config, orchestration, emit

`@gitnebula/cli` now runs the whole analysis: one command in a repository
directory produces a schema-valid `analysis.json`, with the stages visible in
the terminal.

```sh
gitnebula                 # analyze the current directory, write ./analysis.json
gitnebula ../other-repo   # analyze somewhere else
gitnebula --out build/analysis.json
```

## The pipeline

```
repo → config → scan → (deps ∥ githist) → assemble + validate → enrich → emit
```

`repo` and `config` come before the architecture's `scan` because both are
preconditions for it: the analyzers need an absolute repository root, and they
need a resolved `Config`. Everything from `scan` onward is the pipeline the
spine fixes (AD-1).

Each stage prints `▸ <stage>` when it starts and `✔ <stage> (0.42s)` when it
ends, on **stderr** — stdout is left alone so a caller can redirect one without
the other. A stage that cannot continue prints `✖ <stage> (…)` and the run
aborts with AD-7's shape, `«stage»: «cause» — «remedy»`, and a non-zero exit.

`deps` and `githist` are independent and run together. While two stages overlap
the reporter stops rewriting a single line and prints plain ones instead, so the
two do not fight over the cursor.

## Where the numbers come from

| field                                       | source                                        |
| ------------------------------------------- | --------------------------------------------- |
| `repo.name` / `remoteUrl` / `defaultBranch`  | this package, from `git` (see below)           |
| `repo.analyzedAt`                            | this package — the run start, injected once    |
| `repo.analysisWindowDays`                    | resolved config                                |
| `repo.stats.files` / `loc` / `languages`     | scanner                                        |
| `repo.stats.commits`                         | githist — the repo-wide in-window count, merges included |
| node structure (`id`…`loc`)                  | scanner                                        |
| node history (`churn`, `commits`, `authors`, `lastChangedAt`) | githist                      |
| `edges`                                      | deps                                           |
| `cochanges`                                  | githist                                        |
| `description` / `descriptionSource`          | always `null` in MVP (AD-10)                   |

`repo.stats.commits` counts every commit in the window, merges included, and is
taken from githist verbatim. On a repository that merges branches it can
therefore exceed what the per-node `commits` numbers suggest: a merge commit
changes no file, so it attributes to no node. That is the contract's meaning of
the field, not a disagreement between two counters.

The contract needs three repository facts no analyzer produces. `cli` reads
them itself with `git rev-parse`, `git remote get-url origin` and
`git symbolic-ref`, because it is the only composer (AD-2) and it is the module
exempt from AD-4's clock ban. Giving `githist` a second job would have meant
widening a contract type as a side effect of this story.

That read is also the pipeline's preflight: pointing gitnebula at a directory
that is not a git repository fails in the `repo` stage, before any analyzer
starts.

## Configuration (AD-3, FR-4)

Precedence is **defaults < `.gitnebula.yml` < CLI flags**, resolved once, in
this package. Analyzers receive a plain `Config` value and never read a file,
an environment variable or the clock.

```yaml
# .gitnebula.yml — every key is optional
excludes:
  - "vendor/**"
windowDays: 90
hotspotThreshold: 0.5
layers:
  "src/api/**": backend
llm: # parsed, carried, ignored in MVP — prints one notice
  backend: ollama
```

- `excludes` are **added** to scanner's `DEFAULT_EXCLUDES` rather than
  replacing them, in the order defaults → file → flags, de-duplicated. The
  default list is scanner's data; cli only resolves it (ADR-0002).
- `layers` is carried through untouched. scanner prepends the entries to its
  rule table, where user globs win over everything including test detection —
  cli does not implement the rule engine.
- An invalid file fails fast with the file, the **line** and the key:
  `config: /repo/.gitnebula.yml:3: unknown key "windowdays" — remove it …`.
- The post-MVP `llm` key produces exactly one ignored-in-MVP notice (AD-10). A
  repository with no `llm` config gets no warning and no degradation of
  anything (FR-8).

Defaults: window 90 days (ADR-0003), hot spot threshold 0.5, excludes from
scanner.

## Determinism (FR-7, AD-4, AD-13)

The run reads the clock **once**. That instant becomes `repo.analyzedAt` and,
unless pinned, the `windowAnchor` every analyzer measures its window back from.
Nothing else in the pipeline reads a clock.

`--window-anchor <iso>` pins the anchor. It is **test-only**, and its `--help`
text says so: it exists so a fixture snapshot stays stable as days pass. It
never changes `analyzedAt`, which is always the real run start — which is
exactly what makes the byte-compare test meaningful: two runs of the fixture
repo with the anchor pinned differ in `analyzedAt` and in nothing else.

The assemble stage re-applies the stable sorts (nodes by `id`; edges by
`source` then `target`; cochanges by `count` descending then ids; language keys
alphabetically) with plain code-unit comparison rather than `localeCompare`, so
the output does not depend on the machine's locale. Analyzers sort their own
results too — after a merge the ordering is this stage's promise.

## The describe boundary (AD-10, FR-8)

`enrich(analysis) → analysis` sits between validation and emit. In MVP it is
the identity function, and that is the whole of the describe layer inside the
pipeline. It is async because a future enricher will be, and total because a
failing enricher must return the analysis it was given rather than degrade the
run.

## URL mode

`gitnebula <github-url>` is recognised and refused with a clear message
pointing at story 3.2, which adds the shallow clone and the local server. It is
not implemented here.

## Files

| file                                             | NEW/UPDATE | why                                                            |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------- |
| `packages/cli/src/errors.ts`                      | NEW        | `StageError`, AD-7's abort shape                                |
| `packages/cli/src/config.ts`                      | NEW        | defaults < yml < flags, key+line errors, llm notice             |
| `packages/cli/src/repo.ts`                        | NEW        | git metadata and the not-a-repository preflight                 |
| `packages/cli/src/progress.ts`                    | NEW        | stage timing, `onProgress` rendering                            |
| `packages/cli/src/analyzers.ts`                   | NEW        | the seam to scanner/deps/githist                                |
| `packages/cli/src/assemble.ts`                    | NEW        | merge + stable sort + `validateAnalysis`                        |
| `packages/cli/src/enrich.ts`                      | NEW        | the AD-10 identity hook                                         |
| `packages/cli/src/emit.ts`                        | NEW        | deterministic serialization and write                           |
| `packages/cli/src/pipeline.ts`                    | NEW        | stage orchestration                                             |
| `packages/cli/src/cli.ts`                         | NEW        | commander surface, flag validation, exit codes                  |
| `packages/cli/src/index.ts`                       | UPDATE     | real package surface, replacing the 1.1 scaffold exports        |
| `packages/cli/src/gitnebula.ts`                   | UPDATE     | binary entry now runs the CLI                                   |
| `packages/cli/src/test-support.ts`                | NEW        | fixture paths and temp-dir helpers shared by the test files     |
| `packages/cli/src/__fixtures__/`                  | NEW        | the committed end-to-end expectation (AC-5)                     |
| `packages/cli/package.json`                       | UPDATE     | commander + yaml; `pretest` builds the fixture repo             |

## Testing

```sh
pnpm --filter @gitnebula/cli test
```

The package's own `pretest` builds the fixture repository (AD-14), so the story
command is self-sufficient — it does not depend on the root `pretest` having
run first.

The end-to-end suite (AC-5) compares a full run over the fixture repo against
`src/__fixtures__/fixture-repo.analysis.json`, byte for byte, with `analyzedAt`
replaced by a constant. Regenerate it deliberately, and read the diff:

```sh
UPDATE_ANALYSIS_SNAPSHOT=1 pnpm --filter @gitnebula/cli test
```
