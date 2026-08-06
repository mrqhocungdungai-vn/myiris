import { describe, it, expect } from "vitest";
import { surfaceAdvancesFrames, type OrbSurface } from "./orb-frameloop";

const SURFACES: OrbSurface[] = ["deck-orb", "hud-orb", "backdrop"];

describe("surfaceAdvancesFrames", () => {
  it("stops every surface while asleep, focused or not", () => {
    for (const surface of SURFACES) {
      expect(surfaceAdvancesFrames(surface, { awake: false, windowFocused: true })).toBe(false);
      expect(surfaceAdvancesFrames(surface, { awake: false, windowFocused: false })).toBe(false);
    }
  });

  it("keeps the HUD orb advancing while awake and unfocused", () => {
    // The row orb-expressions argues for at length: the overlay is watched
    // precisely while another app has focus, so blur must not pause it.
    expect(surfaceAdvancesFrames("hud-orb", { awake: true, windowFocused: false })).toBe(true);
  });

  it("pauses the deck orb and the backdrop on blur", () => {
    expect(surfaceAdvancesFrames("deck-orb", { awake: true, windowFocused: false })).toBe(false);
    expect(surfaceAdvancesFrames("backdrop", { awake: true, windowFocused: false })).toBe(false);
  });

  it("advances every surface while awake and focused", () => {
    for (const surface of SURFACES) {
      expect(surfaceAdvancesFrames(surface, { awake: true, windowFocused: true })).toBe(true);
    }
  });

  it("matches the full truth table", () => {
    const table: Array<[OrbSurface, boolean, boolean, boolean]> = [
      // surface, awake, windowFocused, advances
      ["deck-orb", false, false, false],
      ["deck-orb", false, true, false],
      ["deck-orb", true, false, false],
      ["deck-orb", true, true, true],
      ["hud-orb", false, false, false],
      ["hud-orb", false, true, false],
      ["hud-orb", true, false, true],
      ["hud-orb", true, true, true],
      ["backdrop", false, false, false],
      ["backdrop", false, true, false],
      ["backdrop", true, false, false],
      ["backdrop", true, true, true],
    ];

    for (const [surface, awake, windowFocused, advances] of table) {
      expect(surfaceAdvancesFrames(surface, { awake, windowFocused })).toBe(advances);
    }
  });
});
