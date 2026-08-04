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

  it("an empty resumption handle still opts in to receiving one", () => {
    const config = buildLiveConfig({ ...BASE_INPUTS, resumeHandle: null });
    expect(config.sessionResumption).toEqual({});
  });
});
