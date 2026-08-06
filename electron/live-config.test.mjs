import { describe, it, expect } from "vitest";
import { buildLiveConfig } from "./live-config.mjs";

const BASE_INPUTS = {
  resumeHandle: "handle-123",
  tools: [{ functionDeclarations: [{ name: "get_ui_context" }] }],
  systemInstruction: "You are Iris.",
  voice: "Zephyr",
};

describe("buildLiveConfig", () => {
  it("carries no realtimeInputConfig key at all", () => {
    const config = buildLiveConfig(BASE_INPUTS);
    expect(config).not.toHaveProperty("realtimeInputConfig");
    expect(config.tools).toEqual(BASE_INPUTS.tools);
  });

  it("keeps responseModalities as AUDIO", () => {
    const config = buildLiveConfig(BASE_INPUTS);
    expect(config.responseModalities).toEqual(["AUDIO"]);
  });

  it("carries the resumption handle and voice through unchanged", () => {
    const config = buildLiveConfig(BASE_INPUTS);
    expect(config.sessionResumption).toEqual({ handle: "handle-123" });
    expect(/** @type {any} */ (config.speechConfig).voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Zephyr");
  });

  // listen-mode-hears-system-audio 2.1: the meeting mode explicitly does NOT
  // add a second profile here. A per-mode config reached by reconnecting was
  // built, used, and retired in this app (archive/2026-08-04-replace-listening-
  // mode-with-listen-only) because the seam a deliberate transition puts in the
  // conversation costs more than the interjections it prevents. This pins the
  // whole key set so re-adding one is a failing test rather than a quiet
  // regression.
  it("has exactly one profile, with the key set unchanged by the meeting mode", () => {
    expect(Object.keys(buildLiveConfig(BASE_INPUTS)).sort()).toEqual([
      "contextWindowCompression",
      "inputAudioTranscription",
      "mediaResolution",
      "outputAudioTranscription",
      "responseModalities",
      "sessionResumption",
      "speechConfig",
      "systemInstruction",
      "tools",
    ]);
  });

  it("an empty resumption handle still opts in to receiving one", () => {
    const config = buildLiveConfig({ ...BASE_INPUTS, resumeHandle: null });
    expect(config.sessionResumption).toEqual({});
  });
});
