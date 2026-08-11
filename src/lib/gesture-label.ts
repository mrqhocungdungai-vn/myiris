import type { HandState } from "../hooks/useHandControl";
import type { GestureContext } from "./gestureContext";

// What the hand indicator says the hand is about to do — the decision table on
// its own, with no React and no DOM in it.
//
// This is a **mirror**, and that is the whole difficulty: the labels must name
// the binding that is actually live, which is decided elsewhere. The galaxy
// branch mirrors `driveFor`'s pose partition in `galaxy-nav.ts`, and the reader
// branch mirrors `ReaderCore`'s bindings. A label that drifts from its binding
// is worse than no label — it tells the user a gesture will do something it
// will not. Extracted here so that mirroring can be pinned by a test instead of
// being asserted in a comment (design.md D10/D6, M11).
//
// Order matters within each context: the two-hand poses are tested before the
// one-hand poses they are built from, or "two palms" would report as
// "open palm".

export type HandActionTone = "idle" | "open" | "fist" | "move";

export type HandAction = {
  label: string;
  tone: HandActionTone;
};

/** The pose facts the label depends on. A narrow view of `HandState`. */
export type LabelHand = Pick<HandState, "present" | "hands" | "fist" | "openPalm" | "pointing" | "gesture">;

/** The surrounding UI facts the label depends on. */
export type LabelSurface = {
  /** True while the drawing surface is up — the orb is not rotatable then. */
  drawingActive: boolean;
  /** `"hud"` also suppresses orb rotation. */
  uiMode: string;
  /** True while a target is being dwelled on, so "hover" becomes "opening". */
  dwellActive: boolean;
};

function openPalmCount(hand: LabelHand): number {
  return hand.hands.filter((item) => item.openPalm).length;
}

/** The fallback: name the raw gesture and say it is bound to nothing here. */
function idleFor(hand: LabelHand): HandAction {
  return { label: `${hand.gesture} · idle`, tone: "idle" };
}

/**
 * Both readers (task and vault note) share `ReaderCore`'s bindings — a fist
 * closes here and never orbits or rotates (design.md M11).
 */
function readerAction(hand: LabelHand): HandAction {
  if (openPalmCount(hand) >= 2) return { label: "Two palms · resize", tone: "open" };
  if (hand.fist) return { label: "Closed_Fist · close", tone: "fist" };
  if (hand.openPalm) return { label: "Open_Palm · scroll", tone: "open" };
  return idleFor(hand);
}

/**
 * Mirrors `driveFor`'s pose partition in `galaxy-nav.ts` so the indicator names
 * the binding actually live, not an orb/deck label the galaxy has taken over.
 *
 * Reads the open-palm **count** rather than `pinchDistance`: `semanticEquals`
 * excludes `pinchDistance` from republishing, so that field never forces a
 * recompute and the label would otherwise show whatever it was when some other
 * field last changed. `openPalm` is compared per hand, so it does.
 */
function galaxyAction(hand: LabelHand): HandAction {
  if (openPalmCount(hand) >= 2) return { label: "Two palms · zoom the view", tone: "open" };
  // Fist + palm reels in on the locked note (design.md D26) — a different zoom
  // from two palms, and the indicator has to separate them or the one thing
  // carried in the hands rather than in hidden state goes unnamed.
  if (hand.hands.some((item) => item.fist) && hand.hands.some((item) => item.openPalm)) {
    return { label: "Fist + palm · reel to note", tone: "open" };
  }
  if (hand.pointing) return { label: "Pointing_Up · open a node", tone: "move" };
  if (hand.fist) return { label: "Closed_Fist · turn the view", tone: "fist" };
  if (hand.openPalm) return { label: "Open_Palm · aim", tone: "open" };
  return idleFor(hand);
}

/** The deck, and drawing/history — which bind no gestures of their own here. */
function deckAction(hand: LabelHand, surface: LabelSurface): HandAction {
  if (openPalmCount(hand) >= 2) return { label: "Two palms · resize", tone: "open" };
  if (hand.fist) {
    // Nothing to rotate while the drawing surface or the HUD owns the screen.
    return surface.drawingActive || surface.uiMode === "hud"
      ? { label: "Closed_Fist · idle", tone: "idle" }
      : { label: "Closed_Fist · rotate orb", tone: "fist" };
  }
  if (hand.openPalm) return { label: "Open_Palm · scroll", tone: "open" };
  if (!hand.pointing) return idleFor(hand);
  if (surface.dwellActive) return { label: "Hold · opening", tone: "move" };
  return { label: "Pointing_Up · hover", tone: "move" };
}

/** The one entry point: what the hand indicator should say right now. */
export function handActionFor(
  hand: LabelHand,
  gestureContext: GestureContext,
  surface: LabelSurface,
): HandAction {
  if (!hand.present) return { label: "Show your hand", tone: "idle" };
  if (gestureContext === "reader") return readerAction(hand);
  if (gestureContext === "galaxy") return galaxyAction(hand);
  return deckAction(hand, surface);
}
