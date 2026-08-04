import { describe, it, expect } from "vitest";
import { readWebglHighFidelity, deriveWebglSettings } from "./webgl-quality";

describe("readWebglHighFidelity", () => {
  it("defaults to the light path (false) when nothing is stored", () => {
    expect(readWebglHighFidelity(null)).toBe(false);
  });

  it("defaults to the light path for an unparseable value", () => {
    expect(readWebglHighFidelity("garbage")).toBe(false);
    expect(readWebglHighFidelity("true")).toBe(false);
    expect(readWebglHighFidelity("")).toBe(false);
  });

  it("reads the high-fidelity path only from the exact 'on' value", () => {
    expect(readWebglHighFidelity("on")).toBe(true);
  });

  it("reads the light path from 'off'", () => {
    expect(readWebglHighFidelity("off")).toBe(false);
  });
});

describe("deriveWebglSettings", () => {
  it("derives the light-path settings", () => {
    const settings = deriveWebglSettings(false, 2);
    expect(settings.orb.gl).toEqual({ antialias: false, powerPreference: "default" });
    expect(settings.orb.dpr).toBe(1.5);
    expect(settings.orb.unlitMaterials).toBe(true);
    expect(settings.orb.bloom).toBe(false);
    expect(settings.backdrop.mount).toBe(false);
    expect(settings.galaxy.bloom).toBe(false);
  });

  it("derives high-fidelity settings matching today's values exactly", () => {
    const settings = deriveWebglSettings(true, 2);
    expect(settings.orb.gl).toEqual({ antialias: true, powerPreference: "high-performance" });
    expect(settings.orb.dpr).toBe(2);
    expect(settings.orb.unlitMaterials).toBe(false);
    expect(settings.orb.bloom).toBe(true);
    expect(settings.backdrop.mount).toBe(true);
    expect(settings.galaxy.bloom).toBe(true);
  });

  it("never clamps the dpr above the device's own ratio on a non-Retina display", () => {
    expect(deriveWebglSettings(false, 1).orb.dpr).toBe(1);
  });

  it("clamps the dpr to 1.5 on a Retina display's light path", () => {
    expect(deriveWebglSettings(false, 2).orb.dpr).toBe(1.5);
  });

  it("leaves a high-fidelity dpr unclamped even above 1.5", () => {
    expect(deriveWebglSettings(true, 3).orb.dpr).toBe(3);
  });
});
