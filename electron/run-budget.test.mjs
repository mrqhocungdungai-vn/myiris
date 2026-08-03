import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUDGET_WARN_FRACTION,
  DEFAULT_RUN_BUDGETS,
  budgetWarning,
  budgetWarnFraction,
  describeCeiling,
  isCeilingSubtype,
  resolveRunBudget,
} from "./run-budget.mjs";

describe("resolveRunBudget", () => {
  it("gives each role its measured default", () => {
    expect(resolveRunBudget("po", {})).toEqual(DEFAULT_RUN_BUDGETS.po);
    expect(resolveRunBudget("dev", {})).toEqual(DEFAULT_RUN_BUDGETS.dev);
    expect(resolveRunBudget("plain", {})).toEqual(DEFAULT_RUN_BUDGETS.plain);
  });

  // The ceiling is a runaway guard, not a quota: the measured runs (design.md
  // D3) were 28 and 29 turns, ~$0.97 and ~$0.78. A default anywhere near those
  // would fire during ordinary work, and a cap that fires in ordinary use gets
  // switched off — which is worse than having none.
  it("leaves generous headroom over the measured runs", () => {
    for (const role of /** @type {const} */ (["po", "dev"])) {
      expect(resolveRunBudget(role, {}).maxTurns).toBeGreaterThan(29 * 4);
      expect(resolveRunBudget(role, {}).maxBudgetUsd).toBeGreaterThan(0.97 * 4);
    }
  });

  it("lets the env raise or lower either ceiling for every role at once", () => {
    const env = { IRIS_CLAUDE_MAX_TURNS: "12", IRIS_CLAUDE_MAX_BUDGET_USD: "0.5" };
    expect(resolveRunBudget("dev", env)).toEqual({ maxTurns: 12, maxBudgetUsd: 0.5 });
    expect(resolveRunBudget("po", env)).toEqual({ maxTurns: 12, maxBudgetUsd: 0.5 });
  });

  // A typo must not cap every run at zero turns.
  it("ignores a value that is not a positive number", () => {
    for (const bad of ["", "0", "-3", "abc", undefined]) {
      expect(resolveRunBudget("dev", { IRIS_CLAUDE_MAX_TURNS: bad })).toEqual(DEFAULT_RUN_BUDGETS.dev);
    }
  });

  it("falls back to the plain-Claude budget for an unknown role", () => {
    expect(resolveRunBudget(/** @type {any} */ ("study"), {})).toEqual(DEFAULT_RUN_BUDGETS.plain);
  });
});

describe("budgetWarnFraction", () => {
  it("defaults, and accepts an override below 1", () => {
    expect(budgetWarnFraction({})).toBe(DEFAULT_BUDGET_WARN_FRACTION);
    expect(budgetWarnFraction({ IRIS_CLAUDE_BUDGET_WARN_FRACTION: "0.5" })).toBe(0.5);
  });

  // A fraction of 1 or more would only fire when the ceiling itself does, which
  // is not a warning.
  it("refuses a fraction that could never warn in advance", () => {
    expect(budgetWarnFraction({ IRIS_CLAUDE_BUDGET_WARN_FRACTION: "1" })).toBe(DEFAULT_BUDGET_WARN_FRACTION);
    expect(budgetWarnFraction({ IRIS_CLAUDE_BUDGET_WARN_FRACTION: "4" })).toBe(DEFAULT_BUDGET_WARN_FRACTION);
  });
});

describe("describeCeiling", () => {
  const budget = { maxTurns: 150, maxBudgetUsd: 5 };

  it("names the ceiling, its value, and how to raise it", () => {
    const turns = describeCeiling("error_max_turns", budget);
    expect(turns).toContain("turn ceiling of 150 turns");
    expect(turns).toContain("IRIS_CLAUDE_MAX_TURNS");

    const spend = describeCeiling("error_max_budget_usd", budget);
    expect(spend).toContain("spend ceiling of $5.00");
    expect(spend).toContain("IRIS_CLAUDE_MAX_BUDGET_USD");
  });

  it("says plainly that the run did not fail", () => {
    expect(describeCeiling("error_max_turns", budget)).toContain("did not fail");
  });

  it("leaves a subtype that is not a ceiling on the generic path", () => {
    expect(describeCeiling("error_during_execution", budget)).toBe("claude reported error_during_execution");
    expect(isCeilingSubtype("error_during_execution")).toBe(false);
    expect(isCeilingSubtype(undefined)).toBe(false);
    expect(isCeilingSubtype("error_max_budget_usd")).toBe(true);
  });
});

describe("budgetWarning", () => {
  const budget = { maxBudgetUsd: 4 };

  it("stays quiet while the run is comfortably inside its ceiling", () => {
    expect(budgetWarning(1.2, budget, 0.75)).toBeNull();
    expect(budgetWarning(Number.NaN, budget, 0.75)).toBeNull();
  });

  it("warns once the run crosses the fraction, before it terminates", () => {
    const warning = budgetWarning(3.5, budget, 0.75);
    expect(warning).toContain("$3.50");
    expect(warning).toContain("$4.00");
    expect(warning).toContain("IRIS_CLAUDE_MAX_BUDGET_USD");
  });
});
