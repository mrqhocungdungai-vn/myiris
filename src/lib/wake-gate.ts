export type WakeGateConfig = {
  threshold: number;
  consecutive: number;
  cooldownMs: number;
  maxGapMs: number;
  /**
   * Symmetric half-window, in ms, within which speech must be confirmed for a
   * phrase detection to wake. Applies in both directions: speech this long
   * *before* the detection confirms it (the common case — speech precedes
   * recognition), and a detection is held this long *after* waiting for
   * confirmation before being discarded.
   */
  speechWindowMs: number;
};

export type WakeGate = {
  step(score: number, now: number): boolean;
  /** Records that the speech detector confirmed human speech at `now`. */
  noteSpeech(now: number): void;
  /**
   * Whether a speech signal exists at all. False (the default) means no
   * detector is running — the model is absent, still loading, or has failed —
   * and the gate decides on the phrase signal alone. This is deliberately
   * *not* inferred from the absence of `noteSpeech` calls: a running detector
   * in a silent room also never calls it, and treating those two states alike
   * is how fail-open silently becomes fail-closed.
   */
  setSpeechAvailable(available: boolean): void;
  reset(): void;
};

// Pure fire/hold/reset decision for the wake-word listener (design D1-D3), now
// over two independent signals: the phrase model's sustained score and a
// separate speech detector's confirmation (speech-confirmed-wake-word).
// Takes no dependency on onnxruntime-web, React, or any browser global, so it
// is unit-testable without loading a model, an AudioContext, or Electron.
export function createWakeGate({
  threshold,
  consecutive,
  cooldownMs,
  maxGapMs,
  speechWindowMs,
}: WakeGateConfig): WakeGate {
  let run = 0;
  let lastEvalAt: number | null = null;
  let lastFireAt = -Infinity;
  // When the phrase condition is satisfied but speech has not confirmed it,
  // the detection is held here rather than discarded, so confirmation arriving
  // on a later evaluation can still wake.
  let candidateAt: number | null = null;
  let lastSpeechAt: number | null = null;
  let speechAvailable = false;

  function reset() {
    run = 0;
    lastEvalAt = null;
    lastFireAt = -Infinity;
    candidateAt = null;
    lastSpeechAt = null;
    // speechAvailable is not cleared: it describes whether a detector exists,
    // which a teardown of the decision state says nothing about. The caller
    // owns that fact and re-asserts it when it changes.
  }

  function noteSpeech(now: number) {
    lastSpeechAt = now;
  }

  function setSpeechAvailable(available: boolean) {
    speechAvailable = available;
  }

  // Fail open: with no detector running there is nothing to disagree with, so
  // the phrase signal decides alone.
  function speechConfirms(at: number): boolean {
    if (!speechAvailable) return true;
    if (lastSpeechAt === null) return false;
    return Math.abs(lastSpeechAt - at) <= speechWindowMs;
  }

  function step(score: number, now: number): boolean {
    const gapTooLarge = lastEvalAt !== null && now - lastEvalAt > maxGapMs;
    lastEvalAt = now;

    if (score < threshold) {
      run = 0;
    } else {
      run = gapTooLarge ? 1 : run + 1;
      if (run >= consecutive) {
        run = 0;
        candidateAt = now;
      }
    }

    // Below-threshold evaluations fall through rather than returning early:
    // confirmation that arrives after the phrase run ends necessarily lands on
    // one, since the phrase is over by then. An early return here is why the
    // late-confirmation case cannot work without this restructuring.
    if (candidateAt !== null && now - candidateAt > speechWindowMs) candidateAt = null;
    if (candidateAt === null) return false;
    if (!speechConfirms(candidateAt)) return false;

    if (now - lastFireAt <= cooldownMs) {
      // The cooldown applies to the held-candidate path too, or a detection
      // held across the cooldown would fire the instant it lapses — an echo of
      // the utterance the cooldown exists to suppress. The candidate is spent
      // either way.
      candidateAt = null;
      return false;
    }

    lastFireAt = now;
    candidateAt = null;
    return true;
  }

  return { step, noteSpeech, setSpeechAvailable, reset };
}
