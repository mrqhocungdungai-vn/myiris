import { describe, it, expect } from "vitest";
import { loopbackAudioSwitch, LOOPBACK_AUDIO_FEATURE } from "./chromium-switches.mjs";

// listen-mode-hears-system-audio 1.4/D1. The feature is default-on in today's
// Chromium, so this switch looks redundant — it is not. Blocking the feature
// produces a stream of bit-exact zeroes rather than an error, so a future
// Chromium that flipped the default would break system audio invisibly. Naming
// it keeps the dependency written down.
describe("chromium-switches: loopbackAudioSwitch", () => {
  it("appends the Catap loopback feature when system audio is enabled", () => {
    expect(loopbackAudioSwitch({ systemAudioEnabled: true })).toEqual({
      name: "enable-features",
      value: LOOPBACK_AUDIO_FEATURE,
    });
  });

  it("appends nothing under the escape hatch, leaving Chromium exactly as it was", () => {
    expect(loopbackAudioSwitch({ systemAudioEnabled: false })).toBeNull();
  });
});
