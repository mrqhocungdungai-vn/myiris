// Gemini Live session config, extracted out of main.mjs so it can be tested
// without booting Electron (docs/TESTING.md's injected-dependencies
// convention). See openspec/changes/add-listening-mode/design.md Decision 1.
//
// mode: "converse" reproduces today's configuration byte-for-byte — no
// `realtimeInputConfig` key at all — so the existing conversation path
// cannot drift. mode: "listen" is the only thing this change adds: it
// disables server-side automatic activity detection, makes the user's turn
// include the whole realtime stream (pauses included), and empties the tool
// set so a forced boundary turn can't start real background work (design.md
// Decision 6 — `handleLiveMessage` dispatches a tool call before it looks at
// serverContent, so suppressing audio/text alone would still let a boundary
// start a real Claude run).
export function buildLiveConfig({ mode = "converse", resumeHandle, tools = [], systemInstruction = "", voice = "Zephyr" } = {}) {
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
    tools: mode === "listen" ? [] : tools,
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
  };

  if (mode === "listen") {
    config.realtimeInputConfig = {
      automaticActivityDetection: { disabled: true },
      turnCoverage: "TURN_INCLUDES_ALL_INPUT",
      activityHandling: "NO_INTERRUPTION",
    };
  }

  return config;
}
