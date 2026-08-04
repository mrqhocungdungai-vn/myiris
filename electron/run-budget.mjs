// Per-profile turn and spend ceilings for every Claude run.
//
// Before this, a voice-dispatched run executed under `bypassPermissions` with no
// turn limit and no spend limit, on a credential the user may be paying per
// token for. `maxTurns` and `maxBudgetUsd` are the SDK's own ceilings; each
// produces its own result subtype (`error_max_turns`, `error_max_budget_usd`)
// rather than a generic failure, which is what lets a ceiling be reported as the
// different thing it is.
//
// The defaults are a **runaway guard, not a quota**. A cap that fires during
// ordinary work gets switched off, which is worse than having none — so they are
// set from measurement (design.md D3), not from intuition:
//
//   shaping, one turn: grill → full 4-artifact OpenSpec proposal   28 turns  $0.97
//   worker,  one run:  implement every task in that change, TDD    29 turns  $0.78
//
// Both against a small real project, so those are a floor rather than a typical
// case; the ceilings sit at roughly 4–6× them. Note what the measurement
// overturned: shaping is *not* the cheaper work. It takes as many turns as
// implementing and spends more, because a propose turn writes and validates four
// artifacts. The two ceilings are therefore near-symmetric, the stateful one
// slightly higher on spend because its model (Opus 5) is the pricier one.
//
// The profile is a declared property of the verb (electron/verbs.mjs), not of a
// role — a verb names which one it starts with, and this module only resolves.
//
// Electron-free, no I/O; `env` is always an argument.

/** @typedef {"stateful" | "worker" | "light"} BudgetProfile */

export const DEFAULT_RUN_BUDGETS = Object.freeze({
  // A resident session applies its ceiling once per `query()` — across the
  // session's whole lifetime rather than per turn — so this is what a long
  // shaping conversation gets in total.
  stateful: Object.freeze({ maxTurns: 150, maxBudgetUsd: 6 }),
  // One-shot runs that write to the repository: implementing, closing out.
  worker: Object.freeze({ maxTurns: 150, maxBudgetUsd: 5 }),
  // Reading, reviewing, and note-keeping answer a question rather than
  // implementing a change, so they have no reason to run as long.
  light: Object.freeze({ maxTurns: 60, maxBudgetUsd: 2 }),
});

// Fraction of the spend ceiling at which a run becomes visible while it is still
// executing (design.md D4). Consumed by the PreToolUse guard, which is the only
// place with both an in-flight view and the authority to say something.
export const DEFAULT_BUDGET_WARN_FRACTION = 0.75;

export const MAX_TURNS_ENV = "IRIS_CLAUDE_MAX_TURNS";
export const MAX_BUDGET_ENV = "IRIS_CLAUDE_MAX_BUDGET_USD";
export const WARN_FRACTION_ENV = "IRIS_CLAUDE_BUDGET_WARN_FRACTION";

// Reads the same way every other IRIS_* budget in the app does (see
// run-queue.mjs's runIdleTimeoutMs): a value that is not a positive finite
// number is ignored rather than clamped, so a typo falls back to the default
// instead of silently capping every run at zero.
function positiveNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The ceilings a run on this profile starts with. The env overrides are global
 * on purpose: they exist so a user who hits a ceiling can raise it in one place
 * without having to know which verb was running.
 * @param {BudgetProfile} profile
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ maxTurns: number, maxBudgetUsd: number }}
 */
export function resolveRunBudget(profile, env = process.env) {
  const defaults = DEFAULT_RUN_BUDGETS[profile] ?? DEFAULT_RUN_BUDGETS.light;
  return {
    maxTurns: positiveNumber(env[MAX_TURNS_ENV], defaults.maxTurns),
    maxBudgetUsd: positiveNumber(env[MAX_BUDGET_ENV], defaults.maxBudgetUsd),
  };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function budgetWarnFraction(env = process.env) {
  const value = positiveNumber(env[WARN_FRACTION_ENV], DEFAULT_BUDGET_WARN_FRACTION);
  // A fraction at or above 1 would only ever fire at the same moment the ceiling
  // itself does, which is not a warning.
  return value < 1 ? value : DEFAULT_BUDGET_WARN_FRACTION;
}

// The SDK result subtypes that mean "a ceiling stopped this", mapped to what the
// user needs to know: which ceiling, the value it fired at, and the one env var
// that raises it.
const CEILINGS = {
  error_max_turns: {
    name: "turn ceiling",
    value: (budget) => `${budget.maxTurns} turns`,
    env: MAX_TURNS_ENV,
  },
  error_max_budget_usd: {
    name: "spend ceiling",
    value: (budget) => `$${budget.maxBudgetUsd.toFixed(2)}`,
    env: MAX_BUDGET_ENV,
  },
};

/**
 * True when a result subtype means the run hit a ceiling rather than broke.
 * @param {string | undefined} subtype
 */
export function isCeilingSubtype(subtype) {
  return Boolean(subtype && subtype in CEILINGS);
}

/**
 * The message a ceiling-terminated run finalizes with. Never the generic
 * `claude reported <subtype>` path — a user whose run stopped because it was
 * long needs a different response than one whose run broke, and collapsing the
 * two hides which happened.
 * @param {string} subtype
 * @param {{ maxTurns: number, maxBudgetUsd: number }} budget
 * @returns {string}
 */
export function describeCeiling(subtype, budget) {
  const ceiling = CEILINGS[subtype];
  if (!ceiling) return `claude reported ${subtype}`;
  return (
    `The run stopped at its ${ceiling.name} of ${ceiling.value(budget)}. ` +
    "It did not fail — it ran out of the allowance Iris starts every run with. " +
    `Raise it with ${ceiling.env} in .env, or split the work into smaller tasks.`
  );
}

/**
 * The in-flight warning, once a run crosses the warn fraction of its spend
 * ceiling. Returns null while the run is still comfortably inside it.
 * @param {number} spentUsd
 * @param {{ maxBudgetUsd: number }} budget
 * @param {number} fraction
 * @returns {string | null}
 */
export function budgetWarning(spentUsd, budget, fraction) {
  if (!Number.isFinite(spentUsd) || spentUsd < budget.maxBudgetUsd * fraction) return null;
  return (
    `This run has spent $${spentUsd.toFixed(2)} of its $${budget.maxBudgetUsd.toFixed(2)} ceiling ` +
    `and will stop when it reaches it (${MAX_BUDGET_ENV} raises it).`
  );
}
