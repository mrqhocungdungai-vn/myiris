import { useEffect } from "react";
import { isHudInteractiveTarget, resolveHudInteractive } from "../lib/hud-interactivity";

// Click-through management: in HUD mode the window ignores the mouse except
// when the pointer is over a `.hud-hit` element. elementFromPoint respects
// pointer-events, so it only returns elements that opted in.
//
// An exclusive fullscreen layer — the drawing surface or the second-brain
// galaxy — holds interactivity for as long as it is open, because it covers
// the display and "is the pointer over it" has the same answer everywhere.
// The cost of that is worth stating plainly: while such a layer is up, this
// window is display-sized and above the menu bar, so nothing else on the
// machine can be clicked. That is what makes each layer's way out load-
// bearing — Esc, the visible Close button excalidraw renders for the drawing
// surface, the orb cluster's toggle, and — if the renderer itself is gone —
// the OS-level HUD hotkey, which is the ONE route that does not need the
// renderer alive. Not the tray: this window sits above the menu bar and
// swallows clicks aimed at it, so while a layer is open the tray icon is
// painted over and unreachable. Main also releases the mouse by itself if
// the renderer stops responding (`window.mjs`, the `unresponsive` handler).
//
// The decision itself lives in `src/lib/hud-interactivity.ts` and is tested
// there.
    // Restoring click-through on the way out belongs here, not only in the
    // cleanup below: leaving HUD or closing the layer must not depend on the
    // next pointermove arriving to release the whole desktop.

export function useHudClickThrough({
  hasBridge,
  hudMode,
  layerActive,
}: {
  hasBridge: boolean;
  hudMode: string;
  /** True while the drawing surface or the galaxy owns the screen. */
  layerActive: boolean;
}): void {
  useEffect(() => {
    if (!hasBridge || hudMode !== "hud") return;
    const exclusiveLayerActive = layerActive;
    if (exclusiveLayerActive) {
      window.iris.setHudInteractive(true);
      // Restoring click-through on the way out belongs here, not only in the
      // cleanup below: leaving HUD or closing the layer must not depend on the
      // next pointermove arriving to release the whole desktop.
      return () => window.iris.setHudInteractive(false);
    }
    let interactive = false;
    let raf = 0;
    window.iris.setHudInteractive(false);

    const onMove = (event: MouseEvent) => {
      if (raf) return;
      const { clientX, clientY } = event;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = resolveHudInteractive({
          exclusiveLayerActive: false,
          overInteractiveTarget: isHudInteractiveTarget(document.elementFromPoint(clientX, clientY)),
        });
        if (next !== interactive) {
          interactive = next;
          window.iris.setHudInteractive(next);
        }
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
      window.iris.setHudInteractive(false);
    };
  }, [hasBridge, hudMode, layerActive]);
}
