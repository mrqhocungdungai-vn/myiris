import { describe, it, expect } from "vitest";
import {
  MIN_SYSTEM_AUDIO_MACOS,
  SELF_TEST_DISCLOSURE,
  compareVersions,
  describeSelfTestVerdict,
  resolveSelfTestVerdict,
  supportsSystemAudioCapture,
} from "./system-audio-self-test";

describe("compareVersions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("14.10", "14.9")).toBe(1);
    expect(compareVersions("9.0", "10.0")).toBe(-1);
    expect(compareVersions("15.7.8", "15.7.8")).toBe(0);
  });

  it("treats a missing segment as zero", () => {
    expect(compareVersions("14", "14.0")).toBe(0);
    expect(compareVersions("14.2", "14")).toBe(1);
  });
});

describe("supportsSystemAudioCapture", () => {
  it("refuses the versions where the capture is absent rather than broken", () => {
    expect(supportsSystemAudioCapture("12.0")).toBe(false);
    expect(supportsSystemAudioCapture("13.6.4")).toBe(false);
    expect(supportsSystemAudioCapture("14.1")).toBe(false);
  });

  it("accepts the floor and everything above it", () => {
    expect(supportsSystemAudioCapture(MIN_SYSTEM_AUDIO_MACOS)).toBe(true);
    expect(supportsSystemAudioCapture("15.7.8")).toBe(true);
    expect(supportsSystemAudioCapture("26.0")).toBe(true);
  });

  // Refusing to test on a version we failed to read would report an OS problem
  // we have no evidence of; the capture attempt answers for itself.
  it("treats an unknown version as capable", () => {
    expect(supportsSystemAudioCapture(null)).toBe(true);
    expect(supportsSystemAudioCapture(undefined)).toBe(true);
    expect(supportsSystemAudioCapture("")).toBe(true);
  });
});

describe("resolveSelfTestVerdict: the four outcomes", () => {
  it("reports heard when the capture opened and audio arrived", () => {
    expect(resolveSelfTestVerdict({ osVersion: "15.7.8", acquired: true, heard: true })).toBe("heard");
  });

  // The observed failure: acquisition succeeds, the track reports live, and
  // every sample is exactly zero. Indistinguishable from working until a
  // meeting has been recorded to nothing.
  it("reports silence distinctly from a capture that could not be obtained", () => {
    expect(resolveSelfTestVerdict({ osVersion: "15.7.8", acquired: true, heard: false })).toBe("silent");
    expect(resolveSelfTestVerdict({ osVersion: "15.7.8", acquired: false })).toBe("not-obtainable");
  });

  it("reports an OS too old as its own verdict, decided before the capture is attempted", () => {
    expect(resolveSelfTestVerdict({ osVersion: "13.5", acquired: false })).toBe("os-too-old");
    // Even if a capture somehow succeeded and heard nothing, the version is
    // the answer — silence there would send the user after a setting that
    // cannot help.
    expect(resolveSelfTestVerdict({ osVersion: "13.5", acquired: true, heard: false })).toBe("os-too-old");
  });
});

describe("describeSelfTestVerdict", () => {
  it("calls only 'heard' a success", () => {
    expect(describeSelfTestVerdict("heard").ok).toBe(true);
    for (const verdict of ["silent", "not-obtainable", "os-too-old"] as const) {
      expect(describeSelfTestVerdict(verdict).ok).toBe(false);
    }
  });

  it("says silence is expected when nothing is playing, so a quiet machine is not called broken", () => {
    expect(describeSelfTestVerdict("silent").detail).toMatch(/expected if nothing was playing/i);
  });

  // The governing permission is unreadable but not absent, so both failing
  // verdicts have somewhere to send the user.
  it("offers the settings route on both failing verdicts", () => {
    expect(describeSelfTestVerdict("silent").offersSettingsRoute).toBe(true);
    expect(describeSelfTestVerdict("not-obtainable").offersSettingsRoute).toBe(true);
  });

  it("offers no settings route where no setting can help", () => {
    expect(describeSelfTestVerdict("os-too-old").offersSettingsRoute).toBe(false);
    expect(describeSelfTestVerdict("os-too-old").detail).toContain(MIN_SYSTEM_AUDIO_MACOS);
    expect(describeSelfTestVerdict("heard").offersSettingsRoute).toBe(false);
  });

  it("gives every verdict a distinct headline", () => {
    const headlines = (["heard", "silent", "not-obtainable", "os-too-old"] as const).map(
      (verdict) => describeSelfTestVerdict(verdict).headline,
    );
    expect(new Set(headlines).size).toBe(4);
  });
});

describe("SELF_TEST_DISCLOSURE", () => {
  it("says the test itself opens a capture and may raise the OS prompt", () => {
    expect(SELF_TEST_DISCLOSURE).toMatch(/opens a capture/i);
    expect(SELF_TEST_DISCLOSURE).toMatch(/prompt/i);
  });

  // Not a second description of what is captured — the mode's own.
  it("reuses the mode's one description of what is captured", () => {
    expect(SELF_TEST_DISCLOSURE).toContain("hears the room AND the audio your machine plays");
  });
});
