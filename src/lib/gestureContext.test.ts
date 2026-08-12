import { describe, it, expect } from "vitest";
import { resolveGestureContext, orbGestureEngaged } from "./gestureContext";

const NONE = { readerOpen: false, secondBrainActive: false, drawingActive: false, historyOpen: false };

describe("resolveGestureContext", () => {
  it("resolves to deck when nothing is active", () => {
    expect(resolveGestureContext(NONE)).toBe("deck");
  });

  it("resolves to reader above every other context (D7 precedence)", () => {
    expect(resolveGestureContext({ ...NONE, readerOpen: true })).toBe("reader");
    expect(resolveGestureContext({ ...NONE, readerOpen: true, secondBrainActive: true })).toBe("reader");
    expect(resolveGestureContext({ ...NONE, readerOpen: true, drawingActive: true, historyOpen: true })).toBe(
      "reader",
    );
  });

  it("resolves to galaxy when active and no reader is open", () => {
    expect(resolveGestureContext({ ...NONE, secondBrainActive: true })).toBe("secondBrain");
    expect(resolveGestureContext({ ...NONE, secondBrainActive: true, drawingActive: true, historyOpen: true })).toBe(
      "secondBrain",
    );
  });

  it("resolves to drawing when active, reader closed, and galaxy inactive", () => {
    expect(resolveGestureContext({ ...NONE, drawingActive: true })).toBe("drawing");
    expect(resolveGestureContext({ ...NONE, drawingActive: true, historyOpen: true })).toBe("drawing");
  });

  it("resolves to history only once reader/galaxy/drawing are all inactive", () => {
    expect(resolveGestureContext({ ...NONE, historyOpen: true })).toBe("history");
  });
});

const ENGAGED = {
  handControl: true,
  handPresent: true,
  uiMode: "deck" as const,
  readerOpen: false,
  drawingActive: false,
  secondBrainActive: false,
};

describe("orbGestureEngaged", () => {
  it("is engaged on the deck with a hand present and every layer closed", () => {
    expect(orbGestureEngaged(ENGAGED)).toBe(true);
  });

  it("is disengaged when hand control is off", () => {
    expect(orbGestureEngaged({ ...ENGAGED, handControl: false })).toBe(false);
  });

  it("is disengaged when no hand is present", () => {
    expect(orbGestureEngaged({ ...ENGAGED, handPresent: false })).toBe(false);
  });

  it("is disengaged in HUD mode", () => {
    expect(orbGestureEngaged({ ...ENGAGED, uiMode: "hud" })).toBe(false);
  });

  it("is disengaged when the reader is open", () => {
    expect(orbGestureEngaged({ ...ENGAGED, readerOpen: true })).toBe(false);
  });

  it("is disengaged when the drawing panel is active", () => {
    expect(orbGestureEngaged({ ...ENGAGED, drawingActive: true })).toBe(false);
  });

  it("is disengaged when the second-brain galaxy is active", () => {
    expect(orbGestureEngaged({ ...ENGAGED, secondBrainActive: true })).toBe(false);
  });

  it("is disengaged in the HUD even when every other condition would otherwise engage it", () => {
    // This is the case that leaked today: uiMode was never part of the
    // orb loop's engaged predicate, so a fist over the HUD still rotated
    // the orb underneath it.
    expect(
      orbGestureEngaged({
        handControl: true,
        handPresent: true,
        uiMode: "hud",
        readerOpen: false,
        drawingActive: false,
        secondBrainActive: false,
      }),
    ).toBe(false);
  });
});
