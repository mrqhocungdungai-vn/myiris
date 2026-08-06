import { describe, it, expect } from "vitest";
import { createWakeGate } from "./wake-gate";

const CONFIG = { threshold: 0.15, consecutive: 2, cooldownMs: 2500, maxGapMs: 500 };

describe("createWakeGate", () => {
  it("does not fire on a lone above-threshold evaluation", () => {
    const gate = createWakeGate(CONFIG);
    expect(gate.step(0.2, 0)).toBe(false);
  });

  it("fires exactly once, on the evaluation that completes a run of N consecutive above-threshold scores", () => {
    const gate = createWakeGate(CONFIG);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(true);
  });

  it("resets the run to zero on a below-threshold evaluation", () => {
    const gate = createWakeGate(CONFIG);
    expect(gate.step(0.2, 0)).toBe(false); // run = 1
    expect(gate.step(0.05, 200)).toBe(false); // below threshold, run -> 0
    expect(gate.step(0.2, 400)).toBe(false); // run = 1 again, not 3
    expect(gate.step(0.2, 600)).toBe(true); // run = 2 -> fires
  });

  it("does not confirm a run across a gap far larger than the evaluation interval", () => {
    const gate = createWakeGate(CONFIG);
    expect(gate.step(0.2, 0)).toBe(false); // run = 1
    expect(gate.step(0.2, 5000)).toBe(false); // gap >> maxGapMs, run restarts at 1, not 2
  });

  it("does not re-fire on above-threshold evaluations inside the post-fire cooldown", () => {
    const gate = createWakeGate(CONFIG);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(true); // fires at t=200
    expect(gate.step(0.2, 400)).toBe(false); // within cooldown
    expect(gate.step(0.2, 600)).toBe(false); // within cooldown
    expect(gate.step(0.2, 2500)).toBe(false); // still within cooldown (2500ms since fire)
    expect(gate.step(0.2, 2800)).toBe(true); // cooldown elapsed, above threshold again
  });

  it("reset() clears both the run and the cooldown state", () => {
    const gate = createWakeGate(CONFIG);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(true); // fires, enters cooldown

    gate.reset();

    // Without reset, this would still be inside the old cooldown window.
    expect(gate.step(0.2, 250)).toBe(false); // run = 1 post-reset
    expect(gate.step(0.2, 450)).toBe(true); // run = 2 -> fires again, cooldown was cleared
  });
});
