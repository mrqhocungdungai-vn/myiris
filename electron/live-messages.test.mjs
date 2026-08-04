import { describe, it, expect, vi } from "vitest";
import { createLiveMessages } from "./live-messages.mjs";

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

  it("emits audio_state 'replying' for an audio chunk while listen-only is engaged", () => {
    const emitEvent = vi.fn();
    const messages = make({ emitEvent, isListenOnlyEngaged: () => true });
    messages.handleLiveMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "abc", mimeType: "audio/pcm;rate=24000" } }] } },
    });
    expect(emitEvent).toHaveBeenCalledWith({ type: "audio_state", state: "replying" });
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
