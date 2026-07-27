import { describe, it, expect } from "vitest";
import { SYSTEM_DEFAULT_MIC, micConstraints } from "./mic-device";

describe("micConstraints", () => {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };

  it("returns the base constraints unchanged for the System Default sentinel", () => {
    expect(micConstraints(base, SYSTEM_DEFAULT_MIC)).toEqual(base);
  });

  it("returns the base constraints unchanged for an empty/undefined device id", () => {
    expect(micConstraints(base, "")).toEqual(base);
    expect(micConstraints(base, undefined as unknown as string)).toEqual(base);
  });

  it("merges deviceId: { exact } onto base for a specific device id", () => {
    expect(micConstraints(base, "device-123")).toEqual({
      ...base,
      deviceId: { exact: "device-123" },
    });
  });

  it("does not mutate the base object", () => {
    const copy = { ...base };
    micConstraints(base, "device-123");
    expect(base).toEqual(copy);
  });

  it("keeps autoGainControl: false from the base (the wake-word case)", () => {
    const wakeBase: MediaTrackConstraints = { ...base, autoGainControl: false };
    expect(micConstraints(wakeBase, SYSTEM_DEFAULT_MIC)).toEqual(wakeBase);
    expect(micConstraints(wakeBase, "device-123")).toEqual({
      ...wakeBase,
      deviceId: { exact: "device-123" },
    });
  });
});
