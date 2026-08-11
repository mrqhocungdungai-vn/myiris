import { useRef, useState } from "react";
import { toggleLayer, isDrawing, isGalaxy, layerActive, type HudLayer } from "../lib/hud-layers";

// Deck ⇄ HUD, and which exclusive layer is up.
//
// Two things that read as one domain because the mode owns the layer: both
// layers are HUD-only, so every path out of the HUD closes them (glass-hud-mode
// design D7). Holding the layer as a single slot enforces the other rule — at
// most one layer open — by construction rather than by two toggles each
// clearing the other.
//
// The transition phase is animation-only; nothing behavioural reads it, but the
// choreography is deliberate. Main drives the window shape and this mirrors it.
// Entering the HUD, the deck plays a 170ms collapse **while the window is still
// deck-sized**, and only then does the layout swap as main goes fullscreen (HUD
// elements enter with a matching delay). Exiting, the deck mounts invisible and
// fades in over 600ms, right as main restores the window bounds.
//
// The app always boots into deck mode (design.md D5).

export type UiMode = "deck" | "hud";

const TO_HUD_MS = 170;
const TO_DECK_MS = 600;

export type HudModeControl = {
  mode: UiMode;
  transition: "to-hud" | "to-deck" | null;
  drawingActive: boolean;
  galaxyActive: boolean;
  /** True while either exclusive layer owns the screen. */
  layerActive: boolean;
  toggleDrawing: () => void;
  toggleGalaxy: () => void;
  closeDrawing: () => void;
  closeGalaxy: () => void;
  /** Opens the galaxy regardless of what was open — a voice request, not a toggle. */
  openGalaxy: () => void;
  /** Main reported the window changed mode. Leaving the HUD closes any layer. */
  applyMode: (mode: UiMode) => void;
  /** Clears any layer without changing mode — for an explicit exit. */
  closeLayers: () => void;
};

export function useHudMode(): HudModeControl {
  const [mode, setMode] = useState<UiMode>("deck");
  const [transition, setTransition] = useState<"to-hud" | "to-deck" | null>(null);
  const [layer, setLayer] = useState<HudLayer>(null);
  const timerRef = useRef<number | null>(null);

  function applyMode(next: UiMode) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (next === "hud") {
      setTransition("to-hud");
      timerRef.current = window.setTimeout(() => {
        setMode("hud");
        setTransition(null);
      }, TO_HUD_MS);
      return;
    }
    setMode("deck");
    setTransition("to-deck");
    // Both layers are HUD-only; any exit path (button, hotkey, tray) closes
    // them so neither is left mounted the next time the HUD is entered.
    setLayer(null);
    timerRef.current = window.setTimeout(() => setTransition(null), TO_DECK_MS);
  }

  return {
    mode,
    transition,
    drawingActive: isDrawing(layer),
    galaxyActive: isGalaxy(layer),
    layerActive: layerActive(layer),
    toggleDrawing: () => setLayer((current) => toggleLayer(current, "drawing")),
    toggleGalaxy: () => setLayer((current) => toggleLayer(current, "galaxy")),
    closeDrawing: () => setLayer((current) => (isDrawing(current) ? null : current)),
    closeGalaxy: () => setLayer((current) => (isGalaxy(current) ? null : current)),
    openGalaxy: () => setLayer("galaxy"),
    applyMode,
    closeLayers: () => setLayer(null),
  };
}
