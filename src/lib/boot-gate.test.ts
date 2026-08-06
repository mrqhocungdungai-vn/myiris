import { describe, it, expect } from "vitest";
import { stepBootGate, type BootGateState, type SessionSignals } from "./boot-gate";

// Drives a sequence the way the renderer does: carry the state forward across
// observations, collecting what the UI would have shown and reported.
function run(signals: SessionSignals[], from: BootGateState = { running: false, introVisible: false }) {
  let state = from;
  const visible: boolean[] = [];
  let bootDoneCount = 0;

  for (const next of signals) {
    const step = stepBootGate(state, next);
    if (step.reportBootDone) bootDoneCount += 1;
    visible.push(step.introVisible);
    state = { running: next.running, introVisible: step.introVisible };
  }

  return { visible, bootDoneCount, state };
}

describe("stepBootGate", () => {
  it("plays the intro on a real start and clears it on connect", () => {
    const { visible, bootDoneCount } = run([
      { running: true, connected: false }, // sidecar_status: running
      { running: true, connected: false }, // gemini_status: connecting
      { running: true, connected: true }, // gemini_status: connected
    ]);

    expect(visible).toEqual([true, true, false]);
    expect(bootDoneCount).toBe(1);
  });

  it("does not replay the intro while a running session reconnects", () => {
    const connected: BootGateState = { running: true, introVisible: false };
    const { visible, bootDoneCount } = run(
      [
        { running: true, connected: false }, // scheduleReconnect: connecting, no sidecar_status
        { running: true, connected: false }, // backoff attempt
        { running: true, connected: true }, // back up
      ],
      connected,
    );

    expect(visible).toEqual([false, false, false]);
    expect(bootDoneCount).toBe(0);
  });

  it("does not flash the intro during teardown, in the real emit order", () => {
    const connected: BootGateState = { running: true, introVisible: false };
    const { visible, bootDoneCount } = run(
      [
        { running: true, connected: false }, // stopLive(): gemini_status offline first
        { running: false, connected: false }, // then sidecar_status running=false
      ],
      connected,
    );

    expect(visible).toEqual([false, false]);
    expect(bootDoneCount).toBe(0);
  });

  it("does not report boot-done when a stop cuts the intro short", () => {
    const { visible, bootDoneCount } = run([
      { running: true, connected: false }, // start, intro playing
      { running: true, connected: false }, // stop(): offline while the intro is up
      { running: false, connected: false }, // sidecar_status running=false
    ]);

    expect(visible).toEqual([true, true, false]);
    expect(bootDoneCount).toBe(0);
  });

  it("skips the intro when a start comes up already connected", () => {
    const { visible, bootDoneCount } = run([
      { running: true, connected: true }, // instant resume
      { running: true, connected: true },
    ]);

    expect(visible).toEqual([false, false]);
    expect(bootDoneCount).toBe(0);
  });

  it("reports boot-done exactly once across a cold start, including the reconnect that follows", () => {
    const { bootDoneCount } = run([
      { running: true, connected: false }, // start
      { running: true, connected: true }, // connected -> intro done
      { running: true, connected: true }, // steady state
      { running: true, connected: false }, // reconnect
      { running: true, connected: true }, // reconnected
    ]);

    expect(bootDoneCount).toBe(1);
  });

  it("plays the intro again on a genuine restart", () => {
    const { visible, bootDoneCount } = run([
      { running: true, connected: false },
      { running: true, connected: true },
      { running: false, connected: false }, // stopped
      { running: true, connected: false }, // started again
      { running: true, connected: true },
    ]);

    expect(visible).toEqual([true, false, false, true, false]);
    expect(bootDoneCount).toBe(2);
  });
});
