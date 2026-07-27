import { describe, it, expect } from "vitest";
import { resolveGestureContext } from "./gestureContext";

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
    expect(resolveGestureContext({ ...NONE, secondBrainActive: true })).toBe("galaxy");
    expect(resolveGestureContext({ ...NONE, secondBrainActive: true, drawingActive: true, historyOpen: true })).toBe(
      "galaxy",
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
