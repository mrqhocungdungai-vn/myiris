import { describe, it, expect, vi } from "vitest";
import { createRendererBridge } from "./renderer-bridge.mjs";

function makeWindow({ destroyed = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  };
}

describe("renderer-bridge", () => {
  it("drops emits safely when no window exists", () => {
    const bridge = createRendererBridge({ getMainWindow: () => null });
    expect(() => bridge.emitToRenderer("some:channel", { a: 1 })).not.toThrow();
    expect(() => bridge.emitEvent({ type: "log", message: "hi" })).not.toThrow();
  });

  it("drops emits safely when the window is destroyed", () => {
    const win = makeWindow({ destroyed: true });
    const bridge = createRendererBridge({ getMainWindow: () => win });
    bridge.emitToRenderer("some:channel", { a: 1 });
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("emitToRenderer sends the channel and payload verbatim", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win });
    bridge.emitToRenderer("some:channel", { a: 1 });
    expect(win.webContents.send).toHaveBeenCalledWith("some:channel", { a: 1 });
  });

  it("emitEvent wraps the event as a sidecar:event with a timestamp", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win });
    bridge.emitEvent({ type: "log", message: "hi" });
    const [channel, payload] = win.webContents.send.mock.calls[0];
    expect(channel).toBe("sidecar:event");
    expect(payload.type).toBe("log");
    expect(typeof payload.timestamp).toBe("number");
  });

  it("flushTranscripts emits accumulated user/model text and clears the buffers", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win });
    bridge.appendUserTranscript("hello ");
    bridge.appendUserTranscript("world");
    bridge.appendModelTranscript("hi there");
    bridge.flushTranscripts();

    const events = win.webContents.send.mock.calls.map(([, payload]) => payload);
    expect(events.find((e) => e.speaker === "you").text).toBe("hello world");
    expect(events.find((e) => e.speaker === "gemini").text).toBe("hi there");

    win.webContents.send.mockClear();
    bridge.flushTranscripts();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("flushTranscripts emits nothing for whitespace-only buffers", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win });
    bridge.appendUserTranscript("   ");
    bridge.flushTranscripts();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("getUiContext/setUiContext round-trip the latest snapshot", () => {
    const bridge = createRendererBridge({ getMainWindow: () => null });
    expect(bridge.getUiContext().uiMode).toBe("deck");
    bridge.setUiContext({ uiMode: "hud", tasks: [] });
    expect(bridge.getUiContext()).toEqual({ uiMode: "hud", tasks: [] });
  });
});
