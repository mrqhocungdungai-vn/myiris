import { describe, it, expect, vi } from "vitest";
import {
  createRendererBridge,
  RECENT_UTTERANCE_LIMIT,
  RECENT_UTTERANCE_MAX_AGE_MS,
} from "./renderer-bridge.mjs";

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

// D8/F15: Iris held a verbatim transcript of what the user said and used it only
// to draw text on screen — the buffer was cleared by the display flush. It is
// now retained, bounded, and readable. Nothing consumes it in this change.
describe("the retained-utterance ring", () => {
  /** @param {{ now?: () => number }} [options] */
  function make({ now = () => 1_000_000 } = {}) {
    const clock = now;
    const sent = [];
    const bridge = createRendererBridge({
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (_c, p) => sent.push(p) } }),
      now: clock,
    });
    return { bridge, sent };
  }

  it("keeps an utterance past the display flush that used to discard it", () => {
    const { bridge } = make();
    bridge.appendUserTranscript("book me a ");
    bridge.appendUserTranscript("flight");
    bridge.flushTranscripts();

    expect(bridge.getRecentUtterances()).toEqual([{ text: "book me a flight", at: 1_000_000 }]);
  });

  it("records one entry per utterance, not per fragment", () => {
    const { bridge } = make();
    bridge.appendUserTranscript("first");
    bridge.flushTranscripts();
    bridge.appendUserTranscript("sec");
    bridge.appendUserTranscript("ond");
    bridge.flushTranscripts();

    expect(bridge.getRecentUtterances().map((u) => u.text)).toEqual(["first", "second"]);
  });

  it("retains nothing for a flush with no user speech", () => {
    const { bridge } = make();
    bridge.appendModelTranscript("Iris talking");
    bridge.appendUserTranscript("   ");
    bridge.flushTranscripts();

    expect(bridge.getRecentUtterances()).toEqual([]);
  });

  it("drops the oldest past the count cap", () => {
    const { bridge } = make();
    for (let i = 0; i < RECENT_UTTERANCE_LIMIT + 10; i += 1) {
      bridge.appendUserTranscript(`utterance ${i}`);
      bridge.flushTranscripts();
    }

    const kept = bridge.getRecentUtterances();
    expect(kept).toHaveLength(RECENT_UTTERANCE_LIMIT);
    expect(kept[0].text).toBe("utterance 10");
    expect(kept.at(-1).text).toBe(`utterance ${RECENT_UTTERANCE_LIMIT + 9}`);
  });

  it("drops anything older than the age cap, even while idle", () => {
    /** @type {number} */
    let clock = 1_000_000;
    const { bridge } = make({ now: () => clock });
    bridge.appendUserTranscript("old news");
    bridge.flushTranscripts();

    clock += RECENT_UTTERANCE_MAX_AGE_MS - 1;
    expect(bridge.getRecentUtterances()).toHaveLength(1);

    // Nothing is spoken in between — the age bound must still apply on read.
    clock += 2;
    expect(bridge.getRecentUtterances()).toEqual([]);
  });

  it("hands out copies, so a caller cannot mutate the ring", () => {
    const { bridge } = make();
    bridge.appendUserTranscript("mine");
    bridge.flushTranscripts();

    bridge.getRecentUtterances()[0].text = "tampered";
    expect(bridge.getRecentUtterances()[0].text).toBe("mine");
  });
});

// listen-mode-hears-system-audio: while the mode is engaged the input is one
// summed stream — microphone AND whatever the machine plays — so a flushed line
// may be the user, someone else in the room, a remote participant, or a video.
// Calling all of that "you" states something false about the user's own words.
describe("renderer-bridge: who a flushed line is attributed to", () => {
  it("attributes to the user by default, exactly as before", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win });
    bridge.appendUserTranscript("something I said");
    bridge.flushTranscripts();
    expect(win.webContents.send).toHaveBeenCalledWith(
      "sidecar:event",
      expect.objectContaining({ type: "transcript", speaker: "you", text: "something I said" }),
    );
    expect(bridge.getRecentUtterances().map((entry) => entry.text)).toEqual(["something I said"]);
  });

  it("keeps overheard speech out of the conversation panel entirely", () => {
    // Not as the user's words, and not as anything else. The panel is a
    // conversation between the user and Iris, and it holds 40 lines — twenty
    // minutes of narration would evict the whole real conversation to show a
    // transcript that already exists, in full, in the mode's own record. The
    // panel gets ONE entry for the engagement instead (announceMeetingRecord).
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => true });
    bridge.appendUserTranscript("something a video said");
    bridge.flushTranscripts();

    const transcripts = win.webContents.send.mock.calls.filter(([, payload]) => payload?.type === "transcript");
    expect(transcripts).toEqual([]);
  });

  it("decides provenance when the text ARRIVES, not when it is flushed", () => {
    // The regression this guards: an utterance closes 1.5s after its last
    // fragment, so the tail of every engagement flushes AFTER the user has
    // disengaged. Reading the live flag there published a video's words as the
    // user's own.
    const win = makeWindow();
    let overheard = true;
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => overheard });

    bridge.appendUserTranscript("the last thing the video said");
    overheard = false; // the user disengaged before the idle timer fired
    bridge.flushTranscripts();

    expect(win.webContents.send.mock.calls.filter(([, p]) => p?.type === "transcript")).toEqual([]);
    expect(bridge.getRecentUtterances()).toEqual([]);
  });

  it("treats an utterance straddling the disengage as overheard", () => {
    // Withholding one line of the user's own speech costs nothing; publishing
    // a video's words as theirs is the bug. Once overheard, stays overheard.
    const win = makeWindow();
    let overheard = true;
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => overheard });

    bridge.appendUserTranscript("video words ");
    overheard = false;
    bridge.appendUserTranscript("and then mine");
    bridge.flushTranscripts();

    expect(win.webContents.send.mock.calls.filter(([, p]) => p?.type === "transcript")).toEqual([]);
  });

  it("emits a live readout while overheard, so silence is a visible fact", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => true });
    bridge.appendUserTranscript("the deploy ");
    bridge.appendUserTranscript("goes out Friday");

    const live = win.webContents.send.mock.calls
      .filter(([, payload]) => payload?.type === "heard_live")
      .map(([, payload]) => payload.text);
    // Replaces itself per fragment — a running readout, never history.
    expect(live).toEqual(["the deploy", "the deploy goes out Friday"]);
  });

  it("emits no live readout for the user's own speech", () => {
    const win = makeWindow();
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => false });
    bridge.appendUserTranscript("something I said");
    expect(win.webContents.send.mock.calls.filter(([, p]) => p?.type === "heard_live")).toEqual([]);
  });

  it("keeps overheard speech OUT of the ring that feeds a run's prompt", () => {
    // Every consumer renders this ring as "what the user said recently"
    // straight into a run prompt. Keeping a video's words there would carry
    // the same false attribution one layer deeper, past where the user could
    // notice it — and the ring outlives the mode by up to 10 minutes.
    const win = makeWindow();
    let overheard = true;
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => overheard });

    bridge.appendUserTranscript("install the concept diagram skill");
    bridge.flushTranscripts();
    expect(bridge.getRecentUtterances()).toEqual([]);

    overheard = false;
    bridge.appendUserTranscript("now build the thing");
    bridge.flushTranscripts();
    expect(bridge.getRecentUtterances().map((entry) => entry.text)).toEqual(["now build the thing"]);
  });

  it("still clears its buffers on an overheard flush", () => {
    // The bug this guards: skipping the flush with an early return left the
    // buffer uncleared, so the next real utterance carried the whole meeting
    // with it.
    const win = makeWindow();
    let overheard = true;
    const bridge = createRendererBridge({ getMainWindow: () => win, isOverheard: () => overheard });
    bridge.appendUserTranscript("a meeting nobody addressed to Iris");
    bridge.flushTranscripts();

    overheard = false;
    bridge.appendUserTranscript("now build the thing");
    bridge.flushTranscripts();

    const texts = win.webContents.send.mock.calls
      .filter(([, payload]) => payload?.type === "transcript")
      .map(([, payload]) => payload.text);
    expect(texts).toEqual(["now build the thing"]);
  });
});
