/**
 * The chrome's stable test hooks (story 6.5).
 *
 * ## Why these exist, and why there are only six
 *
 * Epic 5 made accessibility a first-class acceptance criterion, so every
 * interactive **control** in the chrome already carries a stable handle — an
 * `id` (`#start-here`, `#p-isolate`, `#scope-bar`, `#layer-backend`…), a
 * `role` + `aria-label`, or a `data-*` (`.sh-entry[data-id]`,
 * `#view-switch button[data-view]`). Those need nothing from this file and
 * deliberately do not get a `data-testid`: a second handle on an element that
 * already has one is drift waiting to happen.
 *
 * The gap was the **readouts** — the elements that carry a *number* rather
 * than an action. They were reachable only through styling classes, and the
 * stylesheet is not a contract: `.p-row` carries five rules in `styles.css`,
 * `.p-badge` two, `.sh-metric` one. A restyle broke tests that were never
 * about styling. That is pre-existing debt, not a cost of epic 6.
 *
 * ## The rule for adding one
 *
 * A region earns a `data-testid` only when **both** hold:
 *
 * 1. its only current hook is a CSS class, and
 * 2. its value is unreachable from the `GraphEngine` interface, so a test has
 *    no choice but to read the DOM.
 *
 * The second half is the one that keeps this list short. `GraphEngine`
 * exposes no edges accessor, no degree, no `repo` metadata and no
 * `cochanges`, and `getBlastRadius()` returns the currently *marked* set
 * rather than a node's partner list — so start-here's `metricLabel`, the
 * blast-radius partner rows and every label carrying `analysisWindowDays`
 * exist only in the DOM. Conversely `getLayerFilter()`, `getScope()`,
 * `getConnectedOnly()`, `getSelected()` and `getMode()` are engine-backed: a
 * region whose value comes from one of those is asserted through the engine
 * and needs no hook here.
 *
 * Applying the rule to the chrome yields exactly the six below. Adding a
 * seventh means showing it passes both halves.
 */

/** A metric row in the selection panel (`panel.ts`). */
export const PANEL_ROW_TESTID = "panel-row";

/** A co-change partner row in the panel's blast-radius section (story 5.6). */
export const PANEL_BLAST_ROW_TESTID = "panel-blast-row";

/** The per-entry metric in the start-here panel (story 5.2). */
export const START_HERE_METRIC_TESTID = "start-here-metric";

/** A layer key in the legend (`legend.ts`). */
export const LEGEND_ROW_TESTID = "legend-row";

/** The scope bar's "N hidden" line (story 5.4). */
export const SCOPE_BAR_HIDDEN_TESTID = "scope-bar-hidden";

/** The scope bar's "back to scope" button (story 5.4). */
export const SCOPE_BAR_BACK_TESTID = "scope-bar-back";
