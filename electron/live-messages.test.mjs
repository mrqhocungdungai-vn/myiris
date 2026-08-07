import { describe, it, expect, vi } from "vitest";
import {
  createLiveMessages,
  utteranceBoundaryDelayMs,
  UTTERANCE_IDLE_MS,
  UTTERANCE_MAX_SPAN_MS,
} from "./live-messages.mjs";

function makeLiveSession() {
  return { sendToolResponse: vi.fn(), sendRealtimeInput: vi.fn() };
}

function make(overrides = {}) {
  const session = makeLiveSession();
  return createLiveMessages({
    getLiveSession: () => session,
    setResumptionHandle: vi.fn(),
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    flushTranscripts: vi.fn(),
    appendUserTranscript: vi.fn(),
    appendModelTranscript: vi.fn(),
    executeClaudeTool: vi.fn(async () => ({ status: "ok" })),
    submitClaudeTask: vi.fn(async () => ({ status: "started" })),
    isListenOnlyEngaged: () => false,
    ...overrides,
  });
}

describe("live-messages: handleLiveMessage session resumption", () => {
  it("stores a fresh resumption handle", () => {
    const setResumptionHandle = vi.fn();
    const messages = make({ setResumptionHandle });
    messages.handleLiveMessage({ sessionResumptionUpdate: { resumable: true, newHandle: "handle-123" } });
    expect(setResumptionHandle).toHaveBeenCalledWith("handle-123");
  });

  it("ignores a non-resumable update", () => {
    const setResumptionHandle = vi.fn();
    const messages = make({ setResumptionHandle });
    messages.handleLiveMessage({ sessionResumptionUpdate: { resumable: false, newHandle: "handle-123" } });
    expect(setResumptionHandle).not.toHaveBeenCalled();
  });
});

describe("live-messages: handleLiveMessage goAway", () => {
  it("logs and does nothing else — no deliberate rotation to trigger any more", () => {
    const messages = make();
    expect(() => messages.handleLiveMessage({ goAway: { timeLeft: "10s" } })).not.toThrow();
  });
});

describe("live-messages: handleLiveMessage tool calls", () => {
  it("executes a tool call and sends the response back on the live session", async () => {
    const session = makeLiveSession();
    const executeClaudeTool = vi.fn(async () => ({ status: "ok" }));
    const messages = make({ getLiveSession: () => session, executeClaudeTool });
    messages.handleLiveMessage({ toolCall: { functionCalls: [{ id: "c1", name: "get_ui_context", args: {} }] } });
    await vi.waitFor(() => expect(session.sendToolResponse).toHaveBeenCalled());
    expect(executeClaudeTool).toHaveBeenCalledWith("get_ui_context", {});
  });
});

describe("live-messages: transcript and audio content", () => {
  it("flushes transcripts and emits listening state on interruption", () => {
    const flushTranscripts = vi.fn();
    const emitToRenderer = vi.fn();
    const emitEvent = vi.fn();
    const messages = make({ flushTranscripts, emitToRenderer, emitEvent });
    messages.handleLiveMessage({ serverContent: { interrupted: true } });
    expect(flushTranscripts).toHaveBeenCalled();
    expect(emitToRenderer).toHaveBeenCalledWith("live:interrupt", {});
    expect(emitEvent).toHaveBeenCalledWith({ type: "audio_state", state: "listening" });
  });

  it("appends user transcript", () => {
    const appendUserTranscript = vi.fn();
    const messages = make({ appendUserTranscript });
    messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "hello" } } });
    expect(appendUserTranscript).toHaveBeenCalledWith("hello");
  });

  it("emits audio data and appendModelTranscript for a model turn", () => {
    const emitToRenderer = vi.fn();
    const appendModelTranscript = vi.fn();
    const messages = make({ emitToRenderer, appendModelTranscript });
    messages.handleLiveMessage({
      serverContent: {
        outputTranscription: { text: "response" },
        modelTurn: { parts: [{ inlineData: { data: "abc", mimeType: "audio/pcm;rate=24000" } }] },
      },
    });
    expect(appendModelTranscript).toHaveBeenCalledWith("response");
    expect(emitToRenderer).toHaveBeenCalledWith("live:audio", { data: "abc", mimeType: "audio/pcm;rate=24000" });
  });

  it("emits audio_state 'speaking' for an audio chunk while listen-only is disengaged", () => {
    const emitEvent = vi.fn();
    const messages = make({ emitEvent, isListenOnlyEngaged: () => false });
    messages.handleLiveMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "abc", mimeType: "audio/pcm;rate=24000" } }] } },
    });
    expect(emitEvent).toHaveBeenCalledWith({ type: "audio_state", state: "speaking" });
  });

  // listen-mode-hears-system-audio §3: while engaged, a reply reaches NOTHING.
  // Discarding here is the guarantee that Iris is silent — the in-band request
  // to the model is only a cost reduction, and can be evicted by context-window
  // compression partway through a long meeting.
  it("discards a whole reply turn while listen-only is engaged — audio, text, and speaking state", () => {
    const emitEvent = vi.fn();
    const emitToRenderer = vi.fn();
    const appendModelTranscript = vi.fn();
    const messages = make({ emitEvent, emitToRenderer, appendModelTranscript, isListenOnlyEngaged: () => true });
    messages.handleLiveMessage({
      serverContent: {
        outputTranscription: { text: "a reply nobody asked for" },
        modelTurn: {
          parts: [{ text: "spoken text" }, { inlineData: { data: "abc", mimeType: "audio/pcm;rate=24000" } }],
        },
      },
    });
    expect(appendModelTranscript).not.toHaveBeenCalled();
    expect(emitToRenderer).not.toHaveBeenCalledWith("live:audio", expect.anything());
    expect(emitEvent).not.toHaveBeenCalledWith({ type: "audio_state", state: "speaking" });
  });

  it("keeps recording what Iris HEARS while engaged, which is the point of the mode", () => {
    const appendUserTranscript = vi.fn();
    const onInputTranscription = vi.fn();
    const onUtteranceBoundary = vi.fn();
    const messages = make({
      appendUserTranscript,
      onInputTranscription,
      onUtteranceBoundary,
      isListenOnlyEngaged: () => true,
    });
    messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "someone said this" } } });
    messages.handleLiveMessage({ serverContent: { turnComplete: true } });

    // Fed to meeting retention as a RAW fragment, deliberately not through the
    // bounded utterance ring — a busy meeting overruns that ring between two
    // flushes and loses whatever was pruned.
    expect(onInputTranscription).toHaveBeenCalledWith("someone said this");
    expect(onUtteranceBoundary).toHaveBeenCalled();
    expect(appendUserTranscript).toHaveBeenCalledWith("someone said this");
  });

  it("reads main's own flag, not a value the renderer reported — no such param exists to pass", () => {
    // isListenOnlyEngaged is a plain accessor called fresh on every chunk, so
    // there is no renderer-reported value anywhere in this module's inputs.
    const isListenOnlyEngaged = vi.fn(() => false);
    const messages = make({ isListenOnlyEngaged });
    messages.handleLiveMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "abc", mimeType: "audio/pcm;rate=24000" } }] } },
    });
    expect(isListenOnlyEngaged).toHaveBeenCalled();
  });

  it("clears with turnComplete regardless of listen-only state", () => {
    const emitEvent = vi.fn();
    const flushTranscripts = vi.fn();
    const messages = make({ emitEvent, flushTranscripts, isListenOnlyEngaged: () => true });
    messages.handleLiveMessage({ serverContent: { turnComplete: true } });
    expect(flushTranscripts).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith({ type: "audio_state", state: "listening" });
  });
});

describe("live-messages: sendAudioChunk/sendCommand", () => {
  it("sendAudioChunk does nothing without a live session", () => {
    const messages = make({ getLiveSession: () => null });
    expect(() => messages.sendAudioChunk(new ArrayBuffer(8))).not.toThrow();
  });

  it("sendAudioChunk forwards base64-encoded PCM audio", () => {
    const session = makeLiveSession();
    const messages = make({ getLiveSession: () => session });
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    messages.sendAudioChunk(buffer);
    expect(session.sendRealtimeInput).toHaveBeenCalledWith({
      audio: { data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
  });

  it("sendCommand throws for a text command with no live session", () => {
    const messages = make({ getLiveSession: () => null });
    expect(() => messages.sendCommand({ type: "text", text: "hi" })).toThrow("Gemini Live is not running");
  });

  it("sendCommand forwards a text command to the live session", () => {
    const session = makeLiveSession();
    const messages = make({ getLiveSession: () => session });
    messages.sendCommand({ type: "text", text: "hi" });
    expect(session.sendRealtimeInput).toHaveBeenCalledWith({ text: "hi" });
  });

  // The developer escape hatch routes through the deprecated task tool, which
  // dispatches as `execute`. There is no role to pass any more.
  it("sendCommand submits a Claude task through the deprecated alias", () => {
    const submitClaudeTask = vi.fn(() => ({ status: "started" }));
    const messages = make({ submitClaudeTask });
    messages.sendCommand({ type: "submit_claude_task", task: "do it", agent: "dev" });
    expect(submitClaudeTask).toHaveBeenCalledWith({ task: "do it" });
  });

  it("reports a refused command rather than dropping it silently", () => {
    const emitEvent = vi.fn();
    const submitClaudeTask = vi.fn(() => ({ status: "error", error: "Task is required." }));
    make({ submitClaudeTask, emitEvent }).sendCommand({ type: "submit_claude_task", task: "x" });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "claude_task_update", status: "error", error: "Task is required." }),
    );
  });
});

// listen-mode-hears-system-audio: an utterance boundary must not depend on the
// model taking a turn. Measured on a real engagement, a continuously-narrated
// video produced one or two turn boundaries in SEVERAL MINUTES — so both the
// displayed transcript and the meeting record arrived in rare huge lumps, and
// the 30-second retention flush usually had nothing to write.
describe("live-messages: utterance boundaries while the mode is engaged", () => {
  it("waits for a transcription gap normally", () => {
    expect(utteranceBoundaryDelayMs({ elapsedMs: 0 })).toBe(UTTERANCE_IDLE_MS);
    expect(utteranceBoundaryDelayMs({ elapsedMs: 3000 })).toBe(UTTERANCE_IDLE_MS);
  });

  it("caps the wait so continuous audio still closes on a bounded cadence", () => {
    // The failure this fixes: narration that never pauses never goes idle, so
    // an idle-only rule would keep one utterance open for the whole meeting.
    expect(utteranceBoundaryDelayMs({ elapsedMs: UTTERANCE_MAX_SPAN_MS - 500 })).toBe(500);
    expect(utteranceBoundaryDelayMs({ elapsedMs: UTTERANCE_MAX_SPAN_MS })).toBe(0);
    expect(utteranceBoundaryDelayMs({ elapsedMs: UTTERANCE_MAX_SPAN_MS + 9999 })).toBe(0);
  });

  it("closes an utterance on a transcription gap, with no turn from the model at all", () => {
    vi.useFakeTimers();
    try {
      const flushTranscripts = vi.fn();
      const onUtteranceBoundary = vi.fn();
      const messages = make({ flushTranscripts, onUtteranceBoundary, isListenOnlyEngaged: () => true });

      messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "a sentence" } } });
      expect(flushTranscripts).not.toHaveBeenCalled();

      vi.advanceTimersByTime(UTTERANCE_IDLE_MS);
      expect(flushTranscripts).toHaveBeenCalledTimes(1);
      expect(onUtteranceBoundary).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still closes under narration that never leaves a gap", () => {
    vi.useFakeTimers();
    try {
      const flushTranscripts = vi.fn();
      const messages = make({ flushTranscripts, isListenOnlyEngaged: () => true });

      // A fragment every 500ms forever — the idle timer is re-armed each time
      // and on its own would never fire.
      for (let elapsed = 0; elapsed < UTTERANCE_MAX_SPAN_MS + 1000; elapsed += 500) {
        messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "more words " } } });
        vi.advanceTimersByTime(500);
      }
      expect(flushTranscripts).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a real turn boundary win, without closing the same utterance twice", () => {
    vi.useFakeTimers();
    try {
      const flushTranscripts = vi.fn();
      const onUtteranceBoundary = vi.fn();
      const messages = make({ flushTranscripts, onUtteranceBoundary, isListenOnlyEngaged: () => true });

      messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "a sentence" } } });
      messages.handleLiveMessage({ serverContent: { turnComplete: true } });
      expect(onUtteranceBoundary).toHaveBeenCalledTimes(1);

      // The pending idle timer was cancelled by that turn, so letting it run
      // adds nothing.
      vi.advanceTimersByTime(UTTERANCE_MAX_SPAN_MS * 2);
      expect(onUtteranceBoundary).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("arms nothing at all outside the mode, so ordinary conversation is untouched", () => {
    vi.useFakeTimers();
    try {
      const flushTranscripts = vi.fn();
      const messages = make({ flushTranscripts, isListenOnlyEngaged: () => false });

      messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "talking to Iris" } } });
      vi.advanceTimersByTime(UTTERANCE_MAX_SPAN_MS * 2);

      // Still turn-gated exactly as before this change.
      expect(flushTranscripts).not.toHaveBeenCalled();
      messages.handleLiveMessage({ serverContent: { turnComplete: true } });
      expect(flushTranscripts).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// listen-mode-hears-system-audio. The mode's most important guard, and the one
// that was missing: silence was enforced on replies but tool calls dispatched
// regardless. The mode widens what Iris hears to "whatever this machine plays",
// so a video saying "just ask your agent to install X" was enough to start a
// billed Claude run — with Iris deliberately silent and the user not watching.
describe("live-messages: tool calls are refused while the mode is engaged", () => {
  const toolCall = {
    functionCalls: [{ id: "call-1", name: "execute", args: { brief: "install the concept diagram skill" } }],
  };

  it("does not execute anything a video asked for", () => {
    const executeClaudeTool = vi.fn();
    const messages = make({ executeClaudeTool, isListenOnlyEngaged: () => true });
    messages.handleLiveMessage({ toolCall });
    expect(executeClaudeTool).not.toHaveBeenCalled();
  });

  it("answers the refusal back so the session is not left waiting on it", () => {
    const sendToolResponse = vi.fn();
    const messages = make({
      getLiveSession: () => ({ sendToolResponse }),
      isListenOnlyEngaged: () => true,
    });
    messages.handleLiveMessage({ toolCall });

    const response = sendToolResponse.mock.calls[0][0].functionResponses[0];
    expect(response.id).toBe("call-1");
    expect(response.response.status).toBe("error");
    expect(response.response.error).toMatch(/listen-only mode is engaged/i);
  });

  it("reports the refusal on its OWN event, not as a log line", () => {
    // A `log` event would reach nobody: App.tsx keeps only the setter for its
    // log list and never renders it, so a refusal reported that way is
    // indistinguishable from Iris quietly doing the work anyway.
    const emitEvent = vi.fn();
    const messages = make({ emitEvent, isListenOnlyEngaged: () => true });
    messages.handleLiveMessage({ toolCall });
    expect(emitEvent).toHaveBeenCalledWith({ type: "listen_only_refused", tool: "execute" });
  });

  it("refuses every tool, not an allowlist of the dangerous-looking ones", () => {
    // While engaged the user is not addressing Iris at all, so there is nothing
    // she could legitimately have been asked to do — and an allowlist is a
    // judgement call that only has to be wrong once.
    const executeClaudeTool = vi.fn();
    const messages = make({ executeClaudeTool, isListenOnlyEngaged: () => true });
    for (const name of ["get_ui_context", "capture_note", "control_ui", "go_to_sleep"]) {
      messages.handleLiveMessage({ toolCall: { functionCalls: [{ id: name, name }] } });
    }
    expect(executeClaudeTool).not.toHaveBeenCalled();
  });

  it("dispatches normally the moment the mode is not engaged", async () => {
    const executeClaudeTool = vi.fn(async () => ({ status: "ok" }));
    const messages = make({ executeClaudeTool, isListenOnlyEngaged: () => false });
    messages.handleLiveMessage({ toolCall });
    await vi.waitFor(() => expect(executeClaudeTool).toHaveBeenCalledWith("execute", toolCall.functionCalls[0].args));
  });
});
