import { describe, it, expect } from "vitest";
import { dwellFrame, DWELL_HOLD_MS, type DwellHold } from "./pointer-dwell";

// Targets are compared by identity, exactly as DOM elements are.
const A = { name: "a" };
const B = { name: "b" };

/** Runs a sequence of (target, now) frames, returning every outcome. */
function run(frames: Array<[unknown, number]>) {
  let hold: DwellHold<unknown> = null;
  return frames.map(([target, now]) => {
    const outcome = dwellFrame(hold, target, now);
    hold = outcome.hold;
    return outcome;
  });
}

describe("dwellFrame", () => {
  it("holds nothing when there is no target", () => {
    const [outcome] = run([[null, 0]]);
    expect(outcome).toEqual({ hold: null, active: false, fired: false, fire: false });
  });

  it("starts the clock on acquiring a target, without firing", () => {
    const [outcome] = run([[A, 1000]]);
    expect(outcome.active).toBe(true);
    expect(outcome.fire).toBe(false);
    expect(outcome.hold).toEqual({ target: A, startedAt: 1000, fired: false });
  });

  it("does not fire before the hold elapses", () => {
    const outcomes = run([
      [A, 1000],
      [A, 1000 + DWELL_HOLD_MS],
    ]);
    // Strictly greater than: exactly DWELL_HOLD_MS is not yet enough.
    expect(outcomes.every((o) => !o.fire)).toBe(true);
  });

  it("fires once the hold elapses", () => {
    const outcomes = run([
      [A, 1000],
      [A, 1000 + DWELL_HOLD_MS + 1],
    ]);
    expect(outcomes[1].fire).toBe(true);
    expect(outcomes[1].fired).toBe(true);
  });

  // The rule that stops a held hand re-triggering a control every frame.
  it("fires exactly once per acquisition, however long the hold continues", () => {
    const outcomes = run([
      [A, 0],
      [A, 1000],
      [A, 2000],
      [A, 3000],
    ]);
    expect(outcomes.filter((o) => o.fire)).toHaveLength(1);
    expect(outcomes.slice(2).every((o) => o.fired && !o.fire)).toBe(true);
  });

  it("re-arms after the target is released and re-acquired", () => {
    const outcomes = run([
      [A, 0],
      [A, 1000],
      [null, 1100],
      [A, 1200],
      [A, 2200],
    ]);
    expect(outcomes[1].fire).toBe(true);
    expect(outcomes[2]).toEqual({ hold: null, active: false, fired: false, fire: false });
    expect(outcomes[4].fire).toBe(true);
  });

  it("restarts the clock when the hand moves to a different target", () => {
    const outcomes = run([
      [A, 0],
      [B, 200],
      [B, 400],
      [B, 700],
    ]);
    // Moving to B at 200 restarts; B fires only after its own full hold.
    expect(outcomes[1].hold).toEqual({ target: B, startedAt: 200, fired: false });
    expect(outcomes[2].fire).toBe(false);
    expect(outcomes[3].fire).toBe(true);
  });

  // A hand that leaves a control mid-hold must not resume where it left off.
  it("does not accumulate hold time across a release", () => {
    const outcomes = run([
      [A, 0],
      [A, 200],
      [null, 250],
      [A, 300],
      [A, 400],
    ]);
    expect(outcomes.every((o) => !o.fire)).toBe(true);
  });

  it("reports active only while a target is held", () => {
    const outcomes = run([
      [null, 0],
      [A, 100],
      [null, 200],
    ]);
    expect(outcomes.map((o) => o.active)).toEqual([false, true, false]);
  });
});
