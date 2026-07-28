export type WakeCaptionInput = {
  sidecarRunning: boolean;
  wakeWordEnabled: boolean;
  wakeFailed: boolean;
};

export type Caption = { text: string; dim: boolean };

// The asleep-state caption decision, pulled out pure so "no false wake
// instruction while failed" and "a successful arm shows no error" are
// machine-checked (wake-sleep-voice) — vitest.config.mjs runs src/**/*.test.ts
// under environment: "node" with no jsdom, so this could not be asserted from
// inside App.tsx's useMemo (design D3). Returns null while awake, since the
// asleep-only wake instruction has nothing to say then; the caller falls
// through to its own awake-state captions.
export function wakeCaption({ sidecarRunning, wakeWordEnabled, wakeFailed }: WakeCaptionInput): Caption | null {
  if (sidecarRunning) return null;
  if (wakeWordEnabled && wakeFailed) {
    return { text: "Wake word failed to start — press W to wake Iris", dim: true };
  }
  return {
    text: wakeWordEnabled ? "Say “Hey Iris” or press W to wake" : "Press W to wake Iris",
    dim: true,
  };
}
