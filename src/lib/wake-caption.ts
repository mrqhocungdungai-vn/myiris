import { acceleratorLabel } from "./accelerator-label";

export type WakeCaptionInput = {
  sidecarRunning: boolean;
  wakeWordEnabled: boolean;
  wakeFailed: boolean;
  /** The wake accelerator actually registered, e.g. "Alt+Shift+W". */
  wakeHotkey: string;
};

export type Caption = { text: string; dim: boolean };

// The asleep-state caption decision, pulled out pure so "no false wake
// instruction while failed" and "a successful arm shows no error" are
// machine-checked (wake-sleep-voice) — vitest.config.mjs runs src/**/*.test.ts
// under environment: "node" with no jsdom, so this could not be asserted from
// inside App.tsx's useMemo (design D3). Returns null while awake, since the
// asleep-only wake instruction has nothing to say then; the caller falls
// through to its own awake-state captions.
//
// The chord comes from configuration rather than a literal: it is a global
// shortcut the user can rebind, and naming a key that does not wake Iris is
// the defect wake-sleep-voice's displayed-keys scenario is about. With no
// usable value the caption drops the keyboard clause instead of inventing one.
export function wakeCaption({ sidecarRunning, wakeWordEnabled, wakeFailed, wakeHotkey }: WakeCaptionInput): Caption | null {
  if (sidecarRunning) return null;
  const chord = acceleratorLabel(wakeHotkey);
  if (wakeWordEnabled && wakeFailed) {
    return {
      text: chord ? `Wake word failed to start — press ${chord} to wake Iris` : "Wake word failed to start",
      dim: true,
    };
  }
  if (!chord) {
    return { text: wakeWordEnabled ? "Say “Hey Iris” to wake" : "Iris is asleep", dim: true };
  }
  return {
    text: wakeWordEnabled ? `Say “Hey Iris” or press ${chord} to wake` : `Press ${chord} to wake Iris`,
    dim: true,
  };
}
