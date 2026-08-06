export type WakeGateConfig = {
  threshold: number;
  consecutive: number;
  cooldownMs: number;
  maxGapMs: number;
};

export type WakeGate = {
  step(score: number, now: number): boolean;
  reset(): void;
};

// Pure fire/hold/reset decision for the wake-word listener (design D1-D3).
// Takes no dependency on onnxruntime-web, React, or any browser global, so it
// is unit-testable without loading a model, an AudioContext, or Electron.
export function createWakeGate({ threshold, consecutive, cooldownMs, maxGapMs }: WakeGateConfig): WakeGate {
  let run = 0;
  let lastEvalAt: number | null = null;
  let lastFireAt = -Infinity;

  function reset() {
    run = 0;
    lastEvalAt = null;
    lastFireAt = -Infinity;
  }

  function step(score: number, now: number): boolean {
    const gapTooLarge = lastEvalAt !== null && now - lastEvalAt > maxGapMs;
    lastEvalAt = now;

    if (score < threshold) {
      run = 0;
      return false;
    }

    run = gapTooLarge ? 1 : run + 1;
    if (run < consecutive) return false;
    if (now - lastFireAt <= cooldownMs) return false;

    lastFireAt = now;
    run = 0;
    return true;
  }

  return { step, reset };
}
