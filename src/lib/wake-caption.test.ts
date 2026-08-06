import { describe, it, expect } from "vitest";
import { wakeCaption } from "./wake-caption";

const WAKE_HOTKEY = "Alt+Shift+W";

describe("wakeCaption", () => {
  it("returns null while awake, regardless of wake-word state", () => {
    expect(
      wakeCaption({ sidecarRunning: true, wakeWordEnabled: true, wakeFailed: true, speechBlocked: false, wakeHotkey: WAKE_HOTKEY }),
    ).toBeNull();
    expect(
      wakeCaption({ sidecarRunning: true, wakeWordEnabled: false, wakeFailed: false, speechBlocked: false, wakeHotkey: WAKE_HOTKEY }),
    ).toBeNull();
  });

  it("instructs the user to speak or press the wake chord when wake word is enabled and healthy", () => {
    expect(
      wakeCaption({ sidecarRunning: false, wakeWordEnabled: true, wakeFailed: false, speechBlocked: false, wakeHotkey: WAKE_HOTKEY }),
    ).toEqual({
      text: "Say “Hey Iris” or press ⌥⇧W to wake",
      dim: true,
    });
  });

  it("offers only keyboard wake when wake word is disabled", () => {
    expect(
      wakeCaption({ sidecarRunning: false, wakeWordEnabled: false, wakeFailed: false, speechBlocked: false, wakeHotkey: WAKE_HOTKEY }),
    ).toEqual({
      text: "Press ⌥⇧W to wake Iris",
      dim: true,
    });
  });

  it("never tells the user speaking will wake it while the listener has failed", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: true,
      wakeFailed: true, speechBlocked: false,
      wakeHotkey: WAKE_HOTKEY,
    });
    expect(result?.text).not.toContain("Say");
    expect(result?.text).toContain("press ⌥⇧W");
  });

  it("shows no failure text once wake word is disabled, even if a stale failure flag lingers", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: false,
      wakeFailed: true, speechBlocked: false,
      wakeHotkey: WAKE_HOTKEY,
    });
    expect(result).toEqual({ text: "Press ⌥⇧W to wake Iris", dim: true });
  });

  it("names the configured chord, not the default", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: false,
      wakeFailed: false, speechBlocked: false,
      wakeHotkey: "Control+Alt+K",
    });
    expect(result?.text).toBe("Press ⌃⌥K to wake Iris");
  });

  it("stops inviting speech once confirmation has withheld every wake", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: true,
      wakeFailed: false,
      speechBlocked: true,
      wakeHotkey: WAKE_HOTKEY,
    });
    // The listener is armed and hearing the phrase, so "failed to start" would
    // be wrong — but so would repeating an instruction that is not working.
    expect(result).toEqual({ text: "Heard “Hey Iris” but no voice — press ⌥⇧W to wake", dim: true });
  });

  it("reports a listener that never started ahead of one that is merely being blocked", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: true,
      wakeFailed: true,
      speechBlocked: true,
      wakeHotkey: WAKE_HOTKEY,
    });
    expect(result?.text).toContain("failed to start");
  });

  it("shows no blocked text once wake word is disabled", () => {
    const result = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: false,
      wakeFailed: false,
      speechBlocked: true,
      wakeHotkey: WAKE_HOTKEY,
    });
    expect(result).toEqual({ text: "Press ⌥⇧W to wake Iris", dim: true });
  });

  it("names no key at all rather than a wrong one when the chord is unusable", () => {
    const spoken = wakeCaption({
      sidecarRunning: false,
      wakeWordEnabled: true,
      wakeFailed: false, speechBlocked: false,
      wakeHotkey: "",
    });
    expect(spoken).toEqual({ text: "Say “Hey Iris” to wake", dim: true });
    const silent = wakeCaption({ sidecarRunning: false, wakeWordEnabled: false, wakeFailed: false, speechBlocked: false, wakeHotkey: "" });
    expect(silent?.text).not.toContain("press");
    expect(silent).toEqual({ text: "Iris is asleep", dim: true });
  });
});
