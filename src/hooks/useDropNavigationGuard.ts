import { useEffect } from "react";

// A security boundary, not a UX nicety (renderer-content-security,
// harden-security-boundaries D9).
//
// Chromium's default for an unhandled drop is to **navigate the window to the
// dropped file or URL** — and this is the window carrying `preload.cjs`.
// Cancelling `dragover`/`drop` at the document level means a drop never starts
// a navigation in the first place, independent of main's own `will-navigate`
// guard. Two independent mechanisms, deliberately: this one prevents the
// navigation, main's refuses it.

export function useDropNavigationGuard(): void {
  useEffect(() => {
    function preventDefaultDrop(event: DragEvent) {
      event.preventDefault();
    }
    document.addEventListener("dragover", preventDefaultDrop);
    document.addEventListener("drop", preventDefaultDrop);
    return () => {
      document.removeEventListener("dragover", preventDefaultDrop);
      document.removeEventListener("drop", preventDefaultDrop);
    };
  }, []);
}
