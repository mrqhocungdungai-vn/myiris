import { useEffect, useState } from "react";
import { useWakeWord } from "./useWakeWord";

// The local "Hey Iris" wake word — whether it is on, whether it failed, and the
// listener itself.
//
// The first domain lifted out of `App.tsx` under `decompose-app-orchestrator`.
// Two pieces of state that are read together and written from nowhere else,
// plus the listener they gate and the one rule that couples them.
//
// `wakeFailed` is held here rather than routed to the log, whose state is
// discarded at declaration and rendered by no component (design D3,
// wake-sleep-voice) — a fatal init failure has to reach a caption, and only
// state does that.

export type WakeControl = {
  /** Whether the user has the wake word switched on. */
  enabled: boolean;
  /** A **fatal** init failure — the listener is not running. Not the recoverable mic-fallback case. */
  failed: boolean;
  /** Applied from the effective config when it arrives or changes. */
  setEnabled: (next: boolean) => void;
};

export function useWakeControl({
  hasBridge,
  awake,
  config,
  micDeviceId,
  onWake,
  onLog,
  onMicFallback,
}: {
  hasBridge: boolean;
  /** The listener runs only while Iris is asleep. */
  awake: boolean;
  config: IrisConfig | null;
  micDeviceId: string;
  onWake: () => void;
  onLog: (message: string) => void;
  /** The selected microphone was unavailable; the listener fell back and armed. */
  onMicFallback: (deviceId: string) => void;
}): WakeControl {
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);

  // Local "Hey Iris" wake word: only listens while asleep and enabled; a
  // detection wakes Iris exactly like pressing W (design.md D5).
  useWakeWord(
    hasBridge && enabled && !awake,
    {
      threshold: config?.wakeThreshold ?? 0.15,
      consecutive: config?.wakeConsecutive ?? 2,
      debug: config?.wakeDebug ?? false,
    },
    onWake,
    (message, fallbackDeviceId) => {
      onLog(`Wake word: ${message}`);
      if (fallbackDeviceId) onMicFallback(fallbackDeviceId);
    },
    micDeviceId,
    () => setFailed(false),
    (message) => {
      onLog(`Wake word: ${message}`);
      setFailed(true);
    },
  );

  // Toggling wake word off tears down the listener with no callback (it returns
  // early on `enabled: false`), so a stale failure banner must be cleared here
  // rather than left next to a caption reading "press ⌥⇧W to wake Iris"
  // (design D3, wake-sleep-voice).
  useEffect(() => {
    if (!enabled) setFailed(false);
  }, [enabled]);

  return { enabled, failed, setEnabled };
}
