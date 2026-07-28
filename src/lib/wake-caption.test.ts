import { describe, it, expect } from "vitest";
import { wakeCaption } from "./wake-caption";

describe("wakeCaption", () => {
  it("returns null while awake, regardless of wake-word state", () => {
    expect(wakeCaption({ sidecarRunning: true, wakeWordEnabled: true, wakeFailed: true })).toBeNull();
    expect(wakeCaption({ sidecarRunning: true, wakeWordEnabled: false, wakeFailed: false })).toBeNull();
  });

  it("instructs the user to speak or press W when wake word is enabled and healthy", () => {
    expect(wakeCaption({ sidecarRunning: false, wakeWordEnabled: true, wakeFailed: false })).toEqual({
      text: "Say “Hey Iris” or press W to wake",
      dim: true,
    });
  });

  it("offers only keyboard wake when wake word is disabled", () => {
    expect(wakeCaption({ sidecarRunning: false, wakeWordEnabled: false, wakeFailed: false })).toEqual({
      text: "Press W to wake Iris",
      dim: true,
    });
  });

  it("never tells the user speaking will wake it while the listener has failed", () => {
    const result = wakeCaption({ sidecarRunning: false, wakeWordEnabled: true, wakeFailed: true });
    expect(result?.text).not.toContain("Say");
    expect(result?.text).toContain("press W");
  });

  it("shows no failure text once wake word is disabled, even if a stale failure flag lingers", () => {
    const result = wakeCaption({ sidecarRunning: false, wakeWordEnabled: false, wakeFailed: true });
    expect(result).toEqual({ text: "Press W to wake Iris", dim: true });
  });
});
