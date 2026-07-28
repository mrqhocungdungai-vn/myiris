import { describe, it, expect, vi } from "vitest";
import { createLiveMessages } from "./live-messages.mjs";

// Mirrors the real ListenMode object's named transitions (main.mjs, task 4.5)
// so tests exercise the same accessor shape live-messages.mjs actually calls.
function makeListenMode(overrides = {}) {
  return {
    engaged: false,
    transitioning: false,
    boundaryInFlight: false,
    segmentRecord: "",
    ...overrides,
    isEngaged() { return this.engaged; },
    isTransitioning() { return this.transitioning; },
    isBoundaryInFlight() { return this.boundaryInFlight; },
    appendToSegment(text) {
      this.segmentRecord += text;
    },
  };
}

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
    listenMode: makeListenMode(),
    notifyFreshResumptionHandle: vi.fn(),
    notifyTurnComplete: vi.fn(),
    runListenRotation: vi.fn(async () => {}),
    ...overrides,
  });
}

describe("live-messages: handleLiveMessage session resumption", () => {
  it("stores a fresh resumption handle and notifies", () => {
    const setResumptionHandle = vi.fn();
    const notifyFreshResumptionHandle = vi.fn();
    const messages = make({ setResumptionHandle, notifyFreshResumptionHandle });
    messages.handleLiveMessage({ sessionResumptionUpdate: { resumable: true, newHandle: "handle-123" } });
    expect(setResumptionHandle).toHaveBeenCalledWith("handle-123");
    expect(notifyFreshResumptionHandle).toHaveBeenCalledWith("handle-123");
  });

  it("ignores a non-resumable update", () => {
    const setResumptionHandle = vi.fn();
    const messages = make({ setResumptionHandle });
    messages.handleLiveMessage({ sessionResumptionUpdate: { resumable: false, newHandle: "handle-123" } });
    expect(setResumptionHandle).not.toHaveBeenCalled();
  });
});

describe("live-messages: handleLiveMessage goAway", () => {
  it("rotates immediately when listening mode is engaged and idle", () => {
    const runListenRotation = vi.fn(async () => {});
    const messages = make({ listenMode: makeListenMode({ engaged: true }), runListenRotation });
    messages.handleLiveMessage({ goAway: { timeLeft: "10s" } });
    expect(runListenRotation).toHaveBeenCalled();
  });

  it("does not rotate when not in listening mode", () => {
    const runListenRotation = vi.fn(async () => {});
    const messages = make({ runListenRotation });
    messages.handleLiveMessage({ goAway: { timeLeft: "10s" } });
    expect(runListenRotation).not.toHaveBeenCalled();
  });

  it("does not rotate mid-transition", () => {
    const runListenRotation = vi.fn(async () => {});
    const messages = make({ listenMode: makeListenMode({ engaged: true, transitioning: true }), runListenRotation });
    messages.handleLiveMessage({ goAway: { timeLeft: "10s" } });
    expect(runListenRotation).not.toHaveBeenCalled();
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

  it("suppresses tool calls while a boundary turn is in flight", () => {
    const executeClaudeTool = vi.fn(async () => ({ status: "ok" }));
    const messages = make({ listenMode: makeListenMode({ boundaryInFlight: true }), executeClaudeTool });
    messages.handleLiveMessage({ toolCall: { functionCalls: [{ id: "c1", name: "get_ui_context", args: {} }] } });
    expect(executeClaudeTool).not.toHaveBeenCalled();
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

  it("appends user transcript and accumulates the segment record while engaged", () => {
    const appendUserTranscript = vi.fn();
    const listenMode = makeListenMode({ engaged: true });
    const messages = make({ appendUserTranscript, listenMode });
    messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "hello" } } });
    expect(appendUserTranscript).toHaveBeenCalledWith("hello");
    expect(listenMode.segmentRecord).toBe("hello");
  });

  it("does not accumulate the segment record when not engaged", () => {
    const listenMode = makeListenMode({ engaged: false });
    const messages = make({ listenMode });
    messages.handleLiveMessage({ serverContent: { inputTranscription: { text: "hello" } } });
    expect(listenMode.segmentRecord).toBe("");
  });

  it("suppresses model output while a boundary turn is in flight", () => {
    const appendModelTranscript = vi.fn();
    const emitToRenderer = vi.fn();
    const messages = make({ listenMode: makeListenMode({ boundaryInFlight: true }), appendModelTranscript, emitToRenderer });
    messages.handleLiveMessage({
      serverContent: {
        outputTranscription: { text: "response" },
        modelTurn: { parts: [{ inlineData: { data: "abc", mimeType: "audio/pcm" } }] },
      },
    });
    expect(appendModelTranscript).not.toHaveBeenCalled();
    expect(emitToRenderer).not.toHaveBeenCalledWith("live:audio", expect.anything());
  });

  it("emits audio data for a non-suppressed model turn", () => {
    const emitToRenderer = vi.fn();
    const messages = make({ emitToRenderer });
    messages.handleLiveMessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: "abc", mimeType: "audio/pcm;rate=24000" } }] },
      },
    });
    expect(emitToRenderer).toHaveBeenCalledWith("live:audio", { data: "abc", mimeType: "audio/pcm;rate=24000" });
  });

  it("notifies turn completion and flushes transcripts", () => {
    const notifyTurnComplete = vi.fn();
    const flushTranscripts = vi.fn();
    const messages = make({ notifyTurnComplete, flushTranscripts });
    messages.handleLiveMessage({ serverContent: { turnComplete: true } });
    expect(notifyTurnComplete).toHaveBeenCalled();
    expect(flushTranscripts).toHaveBeenCalled();
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

  it("sendCommand submits a Claude task", () => {
    const submitClaudeTask = vi.fn(async () => ({ status: "started" }));
    const messages = make({ submitClaudeTask });
    messages.sendCommand({ type: "submit_claude_task", task: "do it", agent: "dev" });
    expect(submitClaudeTask).toHaveBeenCalledWith({ task: "do it", agent: "dev" });
  });
});
