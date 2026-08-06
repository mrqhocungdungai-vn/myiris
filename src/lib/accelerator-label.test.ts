import { describe, it, expect } from "vitest";
import { acceleratorParts, acceleratorLabel } from "./accelerator-label";

describe("acceleratorParts", () => {
  it("renders the wake and sleep defaults as macOS glyphs", () => {
    expect(acceleratorParts("Alt+Shift+W")).toEqual(["⌥", "⇧", "W"]);
    expect(acceleratorParts("Alt+Shift+S")).toEqual(["⌥", "⇧", "S"]);
  });

  it("covers the modifier spellings Electron accepts", () => {
    expect(acceleratorParts("CommandOrControl+Shift+H")).toEqual(["⌘", "⇧", "H"]);
    expect(acceleratorParts("Control+Option+L")).toEqual(["⌃", "⌥", "L"]);
    expect(acceleratorParts("cmd+k")).toEqual(["⌘", "K"]);
  });

  it("names non-letter keys rather than showing their raw spelling", () => {
    expect(acceleratorParts("Alt+Space")).toEqual(["⌥", "Space"]);
    expect(acceleratorParts("Control+Escape")).toEqual(["⌃", "⎋"]);
  });

  it("passes an unrecognised key through instead of dropping it", () => {
    expect(acceleratorParts("Alt+F13")).toEqual(["⌥", "F13"]);
  });

  it("returns nothing for a value it cannot use, so callers can fall back", () => {
    expect(acceleratorParts("")).toEqual([]);
    expect(acceleratorParts("+++")).toEqual([]);
  });
});

describe("acceleratorLabel", () => {
  it("joins single-character glyphs tightly", () => {
    expect(acceleratorLabel("Alt+Shift+W")).toBe("⌥⇧W");
  });

  it("keeps a word-length key readable", () => {
    expect(acceleratorLabel("Alt+Space")).toBe("⌥ Space");
  });

  it("is empty when there is nothing to show", () => {
    expect(acceleratorLabel("")).toBe("");
  });
});
