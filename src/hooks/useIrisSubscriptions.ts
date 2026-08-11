import { useEffect } from "react";

// Everything the renderer subscribes to from the main process, and the queries
// it runs once at boot to seed that state.
//
// Gathered because they share one shape and one lifetime: each is gated on the
// bridge existing, each returns an unsubscribe, and together they are the
// renderer's whole inbound surface. Keeping them in `App.tsx` meant the
// composition root also held every channel name.
//
// The boot queries and the `sidecar_event` subscription stay in one effect
// deliberately: the queries seed the state the stream then updates, and
// splitting them would open a window where an event arrives before its seed.

export type IrisSubscriptions = {
  hasBridge: boolean;
  /** Dispatched through a ref so the newest closure always runs — see App. */
  sidecarHandlerRef: { current: (event: SidecarEvent) => void };
  session: { setRunning: (v: boolean) => void; setPid: (v: number | null) => void; running: boolean };
  applySessions: (snapshot: SessionsSnapshot) => void;
  applyReviewMode: (mode: ReviewMode) => void;
  setPipelineAvailable: (v: boolean) => void;
  setSecondBrainAvailable: (v: boolean) => void;
  onAudioChunk: (chunk: unknown) => void;
  onAudioInterrupt: () => void;
  onSleep: () => void;
  onWake: () => void;
  applyHudMode: (mode: UiMode) => void;
  openNoteFromGalaxy: (id: string, title: string) => void;
  openGalaxy: () => void;
};

export function useIrisSubscriptions(deps: IrisSubscriptions): void {
  const {
    hasBridge,
    sidecarHandlerRef,
    session,
    applySessions,
    applyReviewMode,
    setPipelineAvailable,
    setSecondBrainAvailable,
    onAudioChunk,
    onAudioInterrupt,
    onSleep,
    onWake,
    applyHudMode,
    openNoteFromGalaxy,
    openGalaxy,
  } = deps;

  // Seed from main, then follow its stream. One effect: the queries seed the
  // state the stream updates, and splitting them would open a window where an
  // event arrives before its seed.
  useEffect(() => {
    if (!hasBridge) return;
    window.iris.getSidecarStatus().then((status) => {
      session.setRunning(status.running);
      session.setPid(status.pid);
    });
    window.iris.getSessions().then(applySessions).catch(() => {});
    window.iris
      .getPipelineStatus()
      .then((status) => setPipelineAvailable(Boolean(status.available)))
      .catch(() => {});
    window.iris
      .getSecondBrainAvailability()
      .then((status) => setSecondBrainAvailable(Boolean(status.available)))
      .catch(() => {});
    window.iris
      .getPromptStatus()
      .then((status) => applyReviewMode(status.reviewMode ?? "verb"))
      .catch(() => {});
    return window.iris.onSidecarEvent((event) => sidecarHandlerRef.current(event));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) return;
    const offAudio = window.iris.onAudioChunk(onAudioChunk);
    const offInterrupt = window.iris.onAudioInterrupt(onAudioInterrupt);
    return () => {
      offAudio();
      offInterrupt();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  // Voice-commanded sleep (design.md D6): Gemini's go_to_sleep tool tells main
  // to emit iris:sleep after a short goodbye delay; sleeping here is identical
  // to the keyboard "S" path.
  //
  // Tray and global-hotkey wake requests both arrive as iris:wake and run this
  // same renderer flow, so mic capture stays renderer-owned wherever the wake
  // came from. Main owns the window shape; its `hud:mode` broadcasts are
  // mirrored rather than decided here.
  useEffect(() => {
    if (!hasBridge) return;
    const offSleep = window.iris.onSleepRequest(() => {
      if (session.running) onSleep();
    });
    const offMode = window.iris.onHudMode(({ mode }) => applyHudMode(mode));
    const offWake = window.iris.onWakeRequest(() => {
      if (!session.running) onWake();
    });
    return () => {
      offSleep();
      offMode();
      offWake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge, session.running]);

  // "Open my X note" (voice-finds-a-note D5). Main has already decided there is
  // exactly one openable match — a ghost, an ambiguous name and a miss are all
  // refused before this is emitted, so nothing here re-litigates the choice.
  useEffect(() => {
    return window.iris.onSecondBrainOpenNote(({ id, title }) => {
      // openGalaxy closes the drawing layer by construction — the slot holds
      // the single active-layer invariant, so this call site does not.
      openGalaxy();
      void openNoteFromGalaxy(id, title);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
