import { describe, it, expect } from "vitest";
import { toggleLayer, layerAfterLeavingHud, isDrawing, isSecondBrain, layerActive, type HudLayer } from "./hud-layers";

// "At most one exclusive layer open" (design.md D5). This used to be two
// booleans and two toggles, each remembering to clear the other.
describe("the single-layer invariant", () => {
  it("opens a layer from nothing", () => {
    expect(toggleLayer(null, "drawing")).toBe("drawing");
    expect(toggleLayer(null, "secondBrain")).toBe("secondBrain");
  });

  it("closes the layer that is already open", () => {
    expect(toggleLayer("drawing", "drawing")).toBeNull();
    expect(toggleLayer("secondBrain", "secondBrain")).toBeNull();
  });

  // The rule the two booleans had to remember.
  it("opening one closes the other", () => {
    expect(toggleLayer("secondBrain", "drawing")).toBe("drawing");
    expect(toggleLayer("drawing", "secondBrain")).toBe("secondBrain");
  });

  // The property, stated directly: the representation cannot hold both.
  it("can never report both layers open", () => {
    const sequences: Array<Array<Exclude<HudLayer, null>>> = [
      ["drawing", "secondBrain"],
      ["secondBrain", "drawing"],
      ["drawing", "drawing", "secondBrain"],
      ["secondBrain", "secondBrain", "drawing", "drawing"],
    ];
    for (const steps of sequences) {
      let layer: HudLayer = null;
      for (const step of steps) layer = toggleLayer(layer, step);
      expect(isDrawing(layer) && isSecondBrain(layer)).toBe(false);
    }
  });
});

// Both layers are HUD-only: an exit path that forgets to clear leaves one
// mounted the next time the HUD is entered.
describe("leaving the HUD", () => {
  it("closes whichever layer was open", () => {
    expect(layerAfterLeavingHud()).toBeNull();
    expect(layerActive(layerAfterLeavingHud())).toBe(false);
  });
});

describe("predicates", () => {
  it("names the open layer and reports when any is open", () => {
    expect(isDrawing("drawing")).toBe(true);
    expect(isSecondBrain("drawing")).toBe(false);
    expect(layerActive("drawing")).toBe(true);
    expect(layerActive("secondBrain")).toBe(true);
    expect(layerActive(null)).toBe(false);
  });
});
