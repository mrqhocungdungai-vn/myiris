import { describe, it, expect } from "vitest";
import { handActionFor, type LabelHand, type LabelSurface } from "./gesture-label";
import { driveFor } from "./galaxy-nav";

// A hand with nothing raised. Individual tests turn on only what they mean.
function hand(over: Partial<LabelHand> = {}): LabelHand {
  return {
    present: true,
    gesture: "None",
    pointing: false,
    openPalm: false,
    fist: false,
    hands: [],
    ...over,
  } as LabelHand;
}

function tracked(over: Record<string, unknown> = {}) {
  return { id: "h1", gesture: "None", pointing: false, openPalm: false, thumbUp: false, fist: false, ...over } as never;
}

const DECK: LabelSurface = { drawingActive: false, uiMode: "deck", dwellActive: false };

describe("no hand", () => {
  it("asks for a hand before naming any binding", () => {
    expect(handActionFor(hand({ present: false }), "deck", DECK)).toEqual({
      label: "Show your hand",
      tone: "idle",
    });
  });
});

describe("reader context", () => {
  // A fist closes the reader here; it never orbits or rotates (design.md M11).
  it("binds a fist to close, not to rotate", () => {
    const action = handActionFor(hand({ fist: true }), "reader", DECK);
    expect(action).toEqual({ label: "Closed_Fist · close", tone: "fist" });
  });

  it("binds an open palm to scroll", () => {
    expect(handActionFor(hand({ openPalm: true }), "reader", DECK).label).toBe("Open_Palm · scroll");
  });

  // Two-hand poses must be tested before the one-hand poses they contain.
  it("names two palms as resize rather than as a single open palm", () => {
    const two = hand({ openPalm: true, hands: [tracked({ openPalm: true }), tracked({ id: "h2", openPalm: true })] });
    expect(handActionFor(two, "reader", DECK).label).toBe("Two palms · resize");
  });

  it("names the raw gesture when nothing is bound", () => {
    expect(handActionFor(hand({ gesture: "Victory" }), "reader", DECK)).toEqual({
      label: "Victory · idle",
      tone: "idle",
    });
  });
});

describe("galaxy context", () => {
  it("binds pointing to opening a node", () => {
    expect(handActionFor(hand({ pointing: true }), "galaxy", DECK).label).toBe("Pointing_Up · open a node");
  });

  it("binds a fist to turning the view, not to closing", () => {
    expect(handActionFor(hand({ fist: true }), "galaxy", DECK).label).toBe("Closed_Fist · turn the view");
  });

  it("names two palms as zoom", () => {
    const two = hand({ openPalm: true, hands: [tracked({ openPalm: true }), tracked({ id: "h2", openPalm: true })] });
    expect(handActionFor(two, "galaxy", DECK).label).toBe("Two palms · zoom the view");
  });

  // Fist + palm is a different zoom from two palms and must be named apart, or
  // the one thing carried in the hands rather than in hidden state goes unnamed.
  it("separates fist+palm from two palms", () => {
    const mixed = hand({ hands: [tracked({ fist: true }), tracked({ id: "h2", openPalm: true })] });
    expect(handActionFor(mixed, "galaxy", DECK).label).toBe("Fist + palm · reel to note");
  });
});

// The reason this module exists: the galaxy labels claim to mirror driveFor's
// pose partition. If they drift, the indicator names a binding that is not live.
describe("the galaxy labels mirror driveFor's partition", () => {
  // driveFor takes `locked` — whether the user has chosen a note to navigate
  // around. These cases use locked = true, where the mirror is intended to hold.
  const cases: Array<{ name: string; hand: LabelHand; drive: string | null }> = [
    { name: "pointing", hand: hand({ pointing: true }), drive: "dwell" },
    { name: "fist", hand: hand({ fist: true }), drive: "orbit" },
    {
      name: "two palms",
      hand: hand({ openPalm: true, hands: [tracked({ openPalm: true }), tracked({ id: "h2", openPalm: true })] }),
      drive: "zoom",
    },
  ];

  for (const entry of cases) {
    it(`labels a ${entry.name} hand while driveFor reports "${entry.drive}"`, () => {
      // driveFor decides the binding; handActionFor only names it. Both must
      // agree that this pose is bound to something.
      expect(driveFor(entry.hand as never, true)).toBe(entry.drive);
      const action = handActionFor(entry.hand, "galaxy", DECK);
      expect(action.label).not.toMatch(/· idle$/);
    });
  }

  it("falls back to idle exactly when driveFor binds nothing", () => {
    const unbound = hand({ gesture: "Thumb_Up" });
    expect(driveFor(unbound as never, true)).toBeNull();
    expect(handActionFor(unbound, "galaxy", DECK).label).toMatch(/· idle$/);
  });

  // KNOWN GAP, pinned deliberately rather than fixed here.
  //
  // `driveFor` binds a fist to `orbit` ONLY once a note is locked — "a fist is
  // only a camera drive once the user has chosen what it turns around"
  // (galaxy-nav.ts). The label has no `locked` input and so promises
  // "turn the view" either way. With nothing locked the indicator therefore
  // names a binding that is not live, which is the exact failure this module's
  // header warns about.
  //
  // This test records today's behavior so the extraction is provably
  // behavior-preserving. Closing the gap means giving handActionFor the lock
  // state, which is a behavior change and belongs in its own change — not in a
  // refactor. If this test ever fails, the gap was closed: update it, do not
  // delete it.
  it("promises 'turn the view' for a fist even when driveFor binds nothing", () => {
    const fist = hand({ fist: true });
    expect(driveFor(fist as never, false)).toBeNull();
    expect(handActionFor(fist, "galaxy", DECK).label).toBe("Closed_Fist · turn the view");
  });
});

describe("deck context", () => {
  it("binds a fist to rotating the orb on the deck", () => {
    expect(handActionFor(hand({ fist: true }), "deck", DECK).label).toBe("Closed_Fist · rotate orb");
  });

  // There is no orb to rotate while the drawing surface or the HUD owns the
  // screen, so the label must not promise one.
  it("reports a fist as idle when there is no orb to rotate", () => {
    for (const surface of [
      { ...DECK, drawingActive: true },
      { ...DECK, uiMode: "hud" },
    ]) {
      expect(handActionFor(hand({ fist: true }), "deck", surface)).toEqual({
        label: "Closed_Fist · idle",
        tone: "idle",
      });
    }
  });

  it("turns hover into opening while a dwell is under way", () => {
    expect(handActionFor(hand({ pointing: true }), "deck", DECK).label).toBe("Pointing_Up · hover");
    expect(handActionFor(hand({ pointing: true }), "deck", { ...DECK, dwellActive: true }).label).toBe(
      "Hold · opening",
    );
  });

  // drawing and history bind no gestures of their own, so they read as deck.
  it("treats drawing and history as the deck", () => {
    for (const context of ["drawing", "history"] as const) {
      expect(handActionFor(hand({ openPalm: true }), context, DECK).label).toBe("Open_Palm · scroll");
    }
  });
});
