import { describe, it, expect } from "vitest";
import { buildLiveConfig } from "./live-config.mjs";

const BASE_INPUTS = {
  resumeHandle: "handle-123",
  tools: [{ functionDeclarations: [{ name: "get_ui_context" }] }],
  systemInstruction: "You are Iris.",
  voice: "Zephyr",
};

describe("buildLiveConfig", () => {
  it("converse mode carries no realtimeInputConfig key at all", () => {
    const config = buildLiveConfig({ mode: "converse", ...BASE_INPUTS });
    expect(config).not.toHaveProperty("realtimeInputConfig");
    expect(config.tools).toEqual(BASE_INPUTS.tools);
  });

  it("listen mode disables automatic activity detection and covers the whole turn", () => {
    const config = buildLiveConfig({ mode: "listen", ...BASE_INPUTS });
    expect(config.realtimeInputConfig).toEqual({
      automaticActivityDetection: { disabled: true },
      turnCoverage: "TURN_INCLUDES_ALL_INPUT",
      activityHandling: "NO_INTERRUPTION",
    });
  });

  it("listen mode empties the tool set so a boundary turn cannot start background work", () => {
    const config = buildLiveConfig({ mode: "listen", ...BASE_INPUTS });
    expect(config.tools).toEqual([]);
  });

  it("the two modes differ only by realtimeInputConfig and tools, for the same inputs", () => {
    const converse = buildLiveConfig({ mode: "converse", ...BASE_INPUTS });
    const listen = buildLiveConfig({ mode: "listen", ...BASE_INPUTS });

    const { realtimeInputConfig: _rtc, tools: _toolsListen, ...listenRest } = listen;
    const { tools: _toolsConverse, ...converseRest } = converse;

    expect(listenRest).toEqual(converseRest);
    expect(converse).not.toHaveProperty("realtimeInputConfig");
    expect(listen.tools).toEqual([]);
    expect(converse.tools).toEqual(BASE_INPUTS.tools);
  });

  it("carries the resumption handle and voice through unchanged", () => {
    const config = buildLiveConfig({ mode: "converse", ...BASE_INPUTS });
    expect(config.sessionResumption).toEqual({ handle: "handle-123" });
    expect(/** @type {any} */ (config.speechConfig).voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Zephyr");
  });

  it("an empty resumption handle still opts in to receiving one", () => {
    const config = buildLiveConfig({ mode: "converse", ...BASE_INPUTS, resumeHandle: null });
    expect(config.sessionResumption).toEqual({});
  });
});
