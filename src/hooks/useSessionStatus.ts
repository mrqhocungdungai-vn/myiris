import { useEffect, useRef, useState } from "react";

// Whether the voice session is up, and what every part of it is reporting.
//
// Seven values that are only ever read together — the orb, the caption, the
// status dots and both shells each want several of them at once, and no
// consumer wants exactly one. Holding them apart is what put seven separate
// bindings into every render surface that shows session status.
//
// `audioStateRef` exists because the "thinking" detector samples the audio
// state from inside a `setInterval` and must see the current value, not the one
// captured when the interval was installed.

export type SessionStatus = {
  /** The voice session is up. The single most widely read fact in the app. */
  running: boolean;
  pid: number | null;
  gemini: string;
  claude: string;
  audio: string;
  /** Live audio state for callbacks that run outside React's render cycle. */
  audioRef: { current: string };
  /** This window has OS focus — gates the WebGL frame loops. */
  focused: boolean;
  /** The boot sequence is playing. */
  booting: boolean;
  setRunning: (running: boolean) => void;
  setPid: (pid: number | null) => void;
  setGemini: (status: string) => void;
  setClaude: (status: string) => void;
  setAudio: (state: string) => void;
  setBooting: (booting: boolean) => void;
  /** The session went down: every status returns to its offline value at once. */
  markOffline: () => void;
};

export function useSessionStatus({ hasBridge }: { hasBridge: boolean }): SessionStatus {
  const [running, setRunning] = useState(false);
  const [pid, setPid] = useState<number | null>(null);
  const [gemini, setGemini] = useState("offline");
  const [claude, setClaude] = useState("offline");
  const [audio, setAudio] = useState("idle");
  const [booting, setBooting] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());

  const audioRef = useRef(audio);
  audioRef.current = audio;

  // The seed above is read during the first render, which commonly runs while
  // the window is still hidden (it is shown on "ready-to-show"), so the focus
  // event that follows can land before these listeners exist. Nothing else
  // writes the flag and a window that never loses focus never fires another
  // event, so a missed transition would latch `false` for the whole session and
  // leave the deck's surfaces paused. Resynchronise on attach, and take main's
  // report — it owns the window — as authoritative over these DOM events.
  useEffect(() => {
    function onFocus() {
      setFocused(true);
    }
    function onBlur() {
      setFocused(false);
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    setFocused(document.hasFocus());
    const offWindowFocus = hasBridge
      ? window.iris.onWindowFocus(({ focused: next }) => setFocused(Boolean(next)))
      : null;
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      offWindowFocus?.();
    };
  }, [hasBridge]);

  return {
    running,
    pid,
    gemini,
    claude,
    audio,
    audioRef,
    focused,
    booting,
    setRunning,
    setPid,
    setGemini,
    setClaude,
    setAudio,
    setBooting,
    // One call, so a future status cannot be forgotten on the way down.
    markOffline() {
      setGemini("offline");
      setClaude("offline");
      setAudio("idle");
    },
  };
}
