import { describe, it, expect } from "vitest";
import { createWakeGate } from "./wake-gate";

const CONFIG = { threshold: 0.15, consecutive: 2, cooldownMs: 2500, maxGapMs: 500, speechWindowMs: 1500 };

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

// The second signal (speech-confirmed-wake-word). Every case below decides from
// scores, confirmation events and timestamps alone — no model, no AudioContext,
// which is what the wake-sleep-voice testability requirement demands.
describe("createWakeGate speech confirmation", () => {
  it("does not wake on a sustained phrase score with no speech confirmed", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    expect(gate.step(0.2, 0)).toBe(false); // run = 1
    expect(gate.step(0.2, 200)).toBe(false); // phrase condition met, but no voice
    expect(gate.step(0.2, 400)).toBe(false); // still nothing to confirm it
  });

  it("wakes on the evaluation that completes the run when speech was confirmed during the phrase", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    gate.noteSpeech(100);
    expect(gate.step(0.2, 0)).toBe(false);
    // Fires on the completing evaluation, not a later one: confirmation that
    // predates the detection costs no extra evaluation, so no added delay.
    expect(gate.step(0.2, 200)).toBe(true);
  });

  it("wakes when confirmation arrives after the phrase run, on a below-threshold evaluation", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(false); // held: phrase heard, no voice yet

    gate.noteSpeech(300);

    // The phrase is over by now, so this evaluation scores below threshold —
    // the held candidate has to survive that to fire at all.
    expect(gate.step(0.05, 400)).toBe(true);
  });

  it("wakes when speech was confirmed shortly before the phrase detection", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    gate.noteSpeech(0); // speech precedes recognition — the common case
    expect(gate.step(0.2, 800)).toBe(false);
    expect(gate.step(0.2, 1000)).toBe(true); // 1000ms earlier, inside the window
  });

  it("discards a held candidate once the window elapses, rather than waking late", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(false); // candidate held at t=200
    expect(gate.step(0.05, 1800)).toBe(false); // 1600ms later — window elapsed, discarded

    gate.noteSpeech(1850);

    expect(gate.step(0.05, 2000)).toBe(false); // confirmation too late to revive it
  });

  it("wakes on the phrase signal alone when no speech detector is available", () => {
    const gate = createWakeGate(CONFIG);
    // Never told a detector exists: the model is absent, still loading, or failed.
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(true);
  });

  it("falls back to the phrase signal alone when a running detector is withdrawn", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(false); // blocked while the detector was live

    gate.setSpeechAvailable(false); // inference threw — degrade to phrase-only

    expect(gate.step(0.2, 3000)).toBe(false); // run restarts after the gap
    expect(gate.step(0.2, 3200)).toBe(true);
  });

  it("applies the cooldown to a candidate confirmed late, not just to same-evaluation fires", () => {
    const gate = createWakeGate(CONFIG);
    gate.setSpeechAvailable(true);
    gate.noteSpeech(0);
    expect(gate.step(0.2, 0)).toBe(false);
    expect(gate.step(0.2, 200)).toBe(true); // fires at t=200, enters cooldown

    expect(gate.step(0.2, 1900)).toBe(false); // run = 1 (gap restarts it)
    expect(gate.step(0.2, 2100)).toBe(false); // candidate held: last speech was 2100ms ago

    gate.noteSpeech(2200);

    // Confirmed now, but still inside the cooldown from t=200 — the late-fire
    // path must be subject to it too.
    expect(gate.step(0.05, 2300)).toBe(false);
    // And it is spent, not merely deferred until the cooldown lapses.
    expect(gate.step(0.05, 2800)).toBe(false);
  });

  it("reset() clears the held candidate and the last-speech timestamp", () => {
    const held = createWakeGate(CONFIG);
    held.setSpeechAvailable(true);
    expect(held.step(0.2, 0)).toBe(false);
    expect(held.step(0.2, 200)).toBe(false); // candidate held

    held.reset();
    held.noteSpeech(250);

    expect(held.step(0.05, 300)).toBe(false); // nothing left to confirm

    const speech = createWakeGate(CONFIG);
    speech.setSpeechAvailable(true);
    speech.noteSpeech(0);

    speech.reset();

    // The confirmation is gone, but reset() does not pretend the detector is —
    // so this holds instead of falling open to phrase-only.
    expect(speech.step(0.2, 100)).toBe(false);
    expect(speech.step(0.2, 300)).toBe(false);
  });
});
