import { describe, it, expect } from "vitest";
import { wakeCaption } from "./wake-caption";

const WAKE_HOTKEY = "Alt+Shift+W";

describe("wakeCaption", () => {
  it("returns null while awake, regardless of wake-word state", () => {
    expect(
      wakeCaption({ sidecarRunning: true, wakeWordEnabled: true, wakeFailed: true, wakeHotkey: WAKE_HOTKEY }),
    ).toBeNull();
    expect(
      wakeCaption({ sidecarRunning: true, wakeWordEnabled: false, wakeFailed: false, wakeHotkey: WAKE_HOTKEY }),
    ).toBeNull();
  });

  it("instructs the user to speak or press the wake chord when wake word is enabled and healthy", () => {
    expect(
      wakeCaption({ sidecarRunning: false, wakeWordEnabled: true, wakeFailed: false, wakeHotkey: WAKE_HOTKEY }),
    ).toEqual({
      text: "Say “Hey Iris” or press ⌥⇧W to wake",
      dim: true,
    });
  });

  it("offers only keyboard wake when wake word is disabled", () => {
    expect(
      wakeCaption({ sidecarRunning: false, wakeWordEnabled: false, wakeFailed: false, wakeHotkey: WAKE_HOTKEY }),
    ).toEqual({
      text: "Press ⌥⇧W to wake Iris",
      dim: true,
    });
  });

  it("never tells the user speaking will wake it while the listener has failed", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: true,
      wakeFailed: true,
      wakeHotkey: WAKE_HOTKEY,
    });
    expect(result?.text).not.toContain("Say");
    expect(result?.text).toContain("press ⌥⇧W");
  });

  it("shows no failure text once wake word is disabled, even if a stale failure flag lingers", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: false,
      wakeFailed: true,
      wakeHotkey: WAKE_HOTKEY,
    });
    expect(result).toEqual({ text: "Press ⌥⇧W to wake Iris", dim: true });
  });

  it("names the configured chord, not the default", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: false,
      wakeFailed: false,
      wakeHotkey: "Control+Alt+K",
    });
    expect(result?.text).toBe("Press ⌃⌥K to wake Iris");
  });

  it("names no key at all rather than a wrong one when the chord is unusable", () => {
    const spoken = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: true,
      wakeFailed: false,
      wakeHotkey: "",
    });
    expect(spoken).toEqual({ text: "Say “Hey Iris” to wake", dim: true });
    const silent = wakeCaption({ sidecarRunning: false, wakeWordEnabled: false, wakeFailed: false, wakeHotkey: "" });
    expect(silent?.text).not.toContain("press");
    expect(silent).toEqual({ text: "Iris is asleep", dim: true });
  });
});
