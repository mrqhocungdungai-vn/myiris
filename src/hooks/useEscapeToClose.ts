import { useEffect } from "react";

// Escape as an escape hatch for a fullscreen layer.
//
// Both the galaxy and the drawing surface bind it, and they differ in two ways
// that are deliberate rather than incidental — so both are **named options**
// here rather than being flattened into one behaviour:
//
//   * `capture` — the drawing surface listens on the capture phase because
//     excalidraw handles keys on its own container and can stop an event before
//     it ever bubbles to `window`. A listener that only sees what excalidraw
//     lets past is an escape hatch that works until the day it matters. Capture
//     runs on the way down, so the decision is ours first.
//   * `standDown` — excalidraw's dialogs and command palette take Escape to
//     close *themselves*, so while one is open Escape belongs to it. A second
//     Escape, with no dialog left, closes the surface.
//
// The galaxy needs neither, and passing nothing is how it says so.

export function useEscapeToClose(
  active: boolean,
  onClose: () => void,
  options: {
    /** Listen on the capture phase, ahead of anything that might swallow the key. */
    capture?: boolean;
    /** Return true to leave this Escape to whoever else owns it. */
    standDown?: () => boolean;
  } = {},
): void {
  const { capture = false, standDown } = options;

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (standDown?.()) return;
      onClose();
    }
    window.addEventListener("keydown", onKey, { capture });
    return () => window.removeEventListener("keydown", onKey, { capture });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, capture]);
}
