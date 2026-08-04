// Gemini Live session config, extracted out of main.mjs so it can be tested
// without booting Electron (docs/TESTING.md's injected-dependencies
// convention).
//
// This reproduces today's single configuration byte-for-byte — no
// `realtimeInputConfig` key at all. The change that once added a second
// "listen" profile here (add-listening-mode) has been retired
// (replace-listening-mode-with-listen-only): listen-only mode reaches
// silence by discarding audio at the output instead, so this module never
// needed a second profile in the first place.
/**
 * @param {{ resumeHandle?: string, tools?: unknown[], systemInstruction?: string, voice?: string }} options
 */
export function buildLiveConfig({ resumeHandle, tools = [], systemInstruction = "", voice = "Zephyr" } = {}) {
  /** @type {Record<string, unknown>} */
  const config = {
    responseModalities: ["AUDIO"],
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voice,
        },
      },
    },
    // Empty object still opts in to receiving resumption handles.
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    contextWindowCompression: {
      triggerTokens: 104857,
      slidingWindow: { targetTokens: 52428 },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools,
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
  };

  return config;
}
