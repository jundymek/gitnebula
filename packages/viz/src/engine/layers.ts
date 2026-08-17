/**
 * The contract's five layers as an ordered, iterable list (story 5.3).
 *
 * `LAYER_COLOR` in `constants.ts` is a `Record<Layer, string>` — a lookup, not
 * a sequence, and object key order is not a thing to build a UI on. The filter
 * control needs a *stable order* to draw five toggles in, and the engine needs
 * a default set that provably covers every layer the contract can carry.
 *
 * This is a new module rather than an addition to `constants.ts` because that
 * file belongs to story 5.2 this wave; a new file costs one import and no
 * coordination.
 */

import type { Layer } from "@gitnebula/contract";

/**
 * The five layers, in the legend's order with `other` last.
 *
 * Typed as a tuple of `Layer` so that adding a layer to the contract without
 * adding it here is a **compile error** in `LAYER_LABEL` below, rather than a
 * layer that silently has no toggle and can never be switched back on.
 */
export const ALL_LAYERS = [
  "backend",
  "frontend",
  "infra",
  "test",
  "other",
] as const satisfies readonly Layer[];

/**
 * Labels for the filter control. Lower case, matching `MODE_LABEL`'s wording
 * in the mode toggle this control is styled after (UX-DR6).
 */
export const LAYER_LABEL: Readonly<Record<Layer, string>> = {
  backend: "backend",
  frontend: "frontend",
  infra: "infra",
  test: "test",
  other: "other",
};

/** True when `value` is one of the contract's layers. */
export function isLayer(value: string): value is Layer {
  return (ALL_LAYERS as readonly string[]).includes(value);
}
