import { useEffect, useRef } from "react";

// Starting and stopping the voice session, and the sound cues that mark each
// transition.
//
// `start` and `stop` are a pair with a **deliberate order**. Starting brings the
// sidecar up before opening the microphone, so audio never streams at a process
// that is not listening yet; stopping closes the microphone first, so the last
// thing to go is the thing that captures.
//
// `start` also reconciles the microphone: `audio.start()` returns the device it
// actually opened, which may not be the one asked for (the selected device can
// be gone). Reporting that back keeps the selector honest — a "return value,
// not a callback" decision, so the reconciliation happens once, here, rather
// than through a listener every consumer would have to remember to wire.

export function useSessionLifecycle({
  hasBridge,
  running,
  micDeviceId,
  audio,
  session,
  onLog,
  onMicFallback,
  onSessionStopped,
  onWake,
  onSleep,
}: {
  hasBridge: boolean;
  running: boolean;
  micDeviceId: string;
  audio: { start: () => Promise<string | null>; stop: () => Promise<void> };
  session: {
    setRunning: (v: boolean) => void;
    setPid: (v: number | null) => void;
    markOffline: () => void;
  };
  onLog: (level: string, message: string) => void;
  /** The device actually opened differed from the one selected. */
  onMicFallback: (deviceId: string) => void;
  /** Hand control is turned off for the session — deliberately not persisted. */
  onSessionStopped: () => void;
  onWake: () => void;
  onSleep: () => void;
}) {
  const prevRunningRef = useRef(false);

  // Sound cues fire on the transition, not on the state, so a re-render while
  // awake never re-plays the wake chime.
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = running;
    if (!wasRunning && running) onWake();
    else if (wasRunning && !running) onSleep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  async function start() {
    if (!hasBridge) {
      onLog("error", "Electron bridge unavailable. Launch with `npm run dev`.");
      return;
    }
    const status = await window.iris.startSidecar({ mode: "none" });
    session.setRunning(status.running);
    session.setPid(status.pid);
    const activeDevice = await audio.start();
    if (activeDevice && activeDevice !== micDeviceId) onMicFallback(activeDevice);
  }

  async function stop() {
    if (!hasBridge) return;
    await audio.stop();
    await window.iris.stopSidecar();
    session.markOffline();
    // No manual listen-only reset: main resets the mode on every transition to
    // not-running and pushes the change, which the listen-only subscription
    // already applies.
    onSessionStopped();
  }

  return { start, stop };
}
