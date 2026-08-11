# 1.2-contract-schema — the contract, and how to change it

`@gitnebula/contract` holds the `analysis.json` JSON Schema, the TypeScript
types generated from it, and the validator every consumer runs. It is the only
interface between modules (AD-1) and it depends on nothing.

```bash
pnpm --filter @gitnebula/contract test      # the schema's test suite
pnpm --filter @gitnebula/contract generate  # regenerate src/generated/analysis.ts
```

## What the package exports

| export                            | what it is                                                |
| --------------------------------- | --------------------------------------------------------- |
| `analysisSchema`                  | the raw draft 2020-12 schema, as JSON                     |
| `validateAnalysis(data)`          | validator; returns a discriminated `ValidationResult`      |
| `formatValidationErrors(errors)`  | renders errors as an indented block for a cli message     |
| `SUPPORTED_SCHEMA_MAJOR`          | `1` — the major the Viewer accepts (AD-12)                |
| `AnalysisDocument` and friends    | **generated** types, from the schema                      |
| `ScanResult`/`DepsResult`/`GitResult`/`Config` | **hand-written** intermediate types (AD-1)   |

`validateAnalysis` narrows on success, so a valid document is typed without a
cast:

```ts
const result = validateAnalysis(JSON.parse(raw));
if (!result.valid) {
  throw new Error(`invalid analysis.json:\n${formatValidationErrors(result.errors)}`);
}
result.data.nodes; // AnalysisDocument["nodes"]
```

Errors address the offending value by JSON Pointer, and a missing property
points at the **absent field** (`/nodes/0/loc`) rather than at its parent
object — so a cli message can print the pointer verbatim.

## Two kinds of types, one rule

- **Contract types are generated.** `src/generated/analysis.ts` is written by
  `scripts/generate-types.mjs` from the schema (AD-9). It carries a
  do-not-edit banner, is excluded from ESLint, and CI regenerates it and runs
  `git diff --exit-code` — a hand edit cannot survive a pull request.
- **Intermediate pipeline types are hand-written**, in `src/pipeline.ts`. They
  are *derived* from the generated ones (`Pick<AnalysisNode, …>`) wherever they
  carry contract fields, so a schema change propagates into them as a type
  error instead of as silent drift.

## The schema-change protocol

The schema is the project's central artifact. Changing it is never a side
effect of another story (CLAUDE.md).

1. **Decide the version impact first.**
   - *Additive and optional* — a new optional property, a widened nullable
     (e.g. `description` going from `null` to `string | null` when the
     describe layer lands): **minor** bump, `1.0` → `1.1`. Old readers keep
     working; the `const` on `schemaVersion` becomes an enum of accepted
     minors.
   - *Anything a `1.0` reader would choke on* — a removed or renamed field, a
     narrowed type, a new required property, a changed enum meaning:
     **major** bump. That breaks every consumer.
2. **A major bump needs its own story and an ADR** (AD-9), and it must move
   `SUPPORTED_SCHEMA_MAJOR` in lockstep, because the Viewer compares a loaded
   document against it and shows the FR-6 mismatch screen rather than
   rendering nonsense.
3. **Edit the schema, never the generated types.** Then run
   `pnpm --filter @gitnebula/contract generate` and commit the regenerated
   file in the same commit as the schema change.
4. **Update the fixtures** (story 1.3). They are checked against the schema,
   so a change that forgets them fails their suite, not this one.
5. **Run `pnpm test && pnpm typecheck`** at the root, not just in this
   package. The intermediate types are derived, so a contract change surfaces
   as compile errors in scanner/deps/githist/cli.

## Deliberate shape decisions

These were settled here and are binding on the analyzers:

- **`additionalProperties: false` everywhere.** A typo in a producer is a
  validation failure, not a silently dropped field.
- **`repo.stats.languages` is a share map** — language name → number in
  `0..1`, not a byte or file count. The Viewer's legend wants shares.
- **`lastChangedAt` is nullable.** A zero-history node has no commit instant,
  and analyzers may not read the clock (AD-13), so there is no fallback value.
- **`description`/`descriptionSource` are typed `null`**, required-present.
  MVP has nothing that could populate them, and reserving the field as
  null-only makes the describe layer's widening a minor, non-breaking act
  (FR-8, AD-10).
- **Co-change `count` requires only `>= 1`.** The `>= 3` threshold and the
  per-kind cap are tunable analyzer policy under the ≤ 5 MB budget (FR-7);
  baking them into the frozen schema would turn a tuning change into a
  version bump. githist enforces the policy.
- **`format: "date-time"` is registered locally**, as an RFC 3339 regex in
  `validate.ts`, instead of pulling in `ajv-formats`. It is the only format
  the contract uses.

## Environment neutrality (AC-5)

Nothing under `src/` may import a `node:` module or touch the DOM: `viz`
imports this package into the browser bundle, and `cli` imports it in Node.
The package's `tsconfig.json` sets `"types": []` with no DOM lib, so a
`node:` import fails to typecheck rather than failing at runtime in a
browser. `scripts/` is build tooling, outside the runtime path, and may use
Node freely.
