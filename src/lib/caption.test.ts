import { describe, it, expect } from "vitest";
import { resolveCaption, resolveAudioDot, resolveReactorState, type CaptionInputs } from "./caption";

const AWAKE: CaptionInputs = {
  sidecarRunning: true,
  wakeWordEnabled: false,
  wakeFailed: false,
  wakeHotkey: "",
  listenOnlyEngaged: false,
  heardLive: null,
  audioState: "connected",
  working: false,
  lastTranscriptText: null,
  geminiStatus: "connected",
};

describe("resolveCaption precedence", () => {
  // Wake state outranks everything: an asleep session is not having a turn.
  it("lets the wake caption win over every live state", () => {
    const asleep = { ...AWAKE, sidecarRunning: false, audioState: "speaking", working: true };
    expect(resolveCaption(asleep).text).not.toBe("Speaking…");
  });

  // Without this, "hearing perfectly" and "capture is dead" look identical
  // until the mode ends.
  it("reports what listen-only mode is hearing, ahead of any turn state", () => {
    const listening = { ...AWAKE, listenOnlyEngaged: true, heardLive: "the deploy is Friday", working: true };
    expect(resolveCaption(listening)).toEqual({ text: "the deploy is Friday", dim: false });
  });

  it("says listen-only is hearing nothing rather than falling through", () => {
    const silent = { ...AWAKE, listenOnlyEngaged: true, heardLive: null, audioState: "speaking" };
    expect(resolveCaption(silent)).toEqual({ text: "Listening — nothing heard yet…", dim: true });
  });

  it("prefers speaking over listening over working", () => {
    expect(resolveCaption({ ...AWAKE, audioState: "speaking", working: true }).text).toBe("Speaking…");
    expect(resolveCaption({ ...AWAKE, audioState: "listening", working: true }).text).toBe("Listening…");
    expect(resolveCaption({ ...AWAKE, working: true }).text).toBe("Working on it…");
  });

  it("shows the last thing said when no turn is in progress", () => {
    expect(resolveCaption({ ...AWAKE, lastTranscriptText: "hello there" })).toEqual({
      text: "hello there",
      dim: false,
    });
  });

  // A live turn outranks the transcript, or the caption would lag a turn behind.
  it("prefers the live turn state over the last transcript line", () => {
    const speaking = { ...AWAKE, audioState: "speaking", lastTranscriptText: "hello there" };
    expect(resolveCaption(speaking).text).toBe("Speaking…");
  });

  it("falls back to a prompt when connected and to connecting otherwise", () => {
    expect(resolveCaption(AWAKE)).toEqual({ text: "How can I help?", dim: true });
    expect(resolveCaption({ ...AWAKE, geminiStatus: "connecting" })).toEqual({ text: "Connecting…", dim: true });
  });

  // Ambient status is dim; something actually said is not.
  it("dims status but never dims speech", () => {
    expect(resolveCaption(AWAKE).dim).toBe(true);
    expect(resolveCaption({ ...AWAKE, lastTranscriptText: "hello" }).dim).toBe(false);
  });
});

describe("resolveAudioDot", () => {
  it("is off when there is no session at all", () => {
    expect(resolveAudioDot({ sidecarRunning: false, muted: false, audioState: "speaking" })).toBe("off");
  });

  // Both warn cases mean the same thing to the user: your voice is not
  // reaching Iris right now.
  it("warns when muted, whatever the session is doing", () => {
    expect(resolveAudioDot({ sidecarRunning: true, muted: true, audioState: "speaking" })).toBe("warn");
  });

  it("warns when the session is up but idle", () => {
    expect(resolveAudioDot({ sidecarRunning: true, muted: false, audioState: "idle" })).toBe("warn");
  });

  it("reports speaking and otherwise on", () => {
    expect(resolveAudioDot({ sidecarRunning: true, muted: false, audioState: "speaking" })).toBe("speaking");
    expect(resolveAudioDot({ sidecarRunning: true, muted: false, audioState: "listening" })).toBe("on");
  });
});

describe("resolveReactorState", () => {
  const live = {
    running: true,
    listenOnlyEngaged: false,
    audioState: "connected",
    working: false,
    geminiStatus: "connected",
  };

  // An orb reporting "listening" with nothing running describes a session that
  // does not exist.
  it("is idle whenever the session is down, whatever else is true", () => {
    for (const over of [{ audioState: "speaking" }, { working: true }, { listenOnlyEngaged: true }]) {
      expect(resolveReactorState({ ...live, ...over, running: false })).toBe("idle");
    }
  });

  // The mode is a CONDITION, not a turn. A "speaking" flash over it would
  // announce a reply that reached nobody.
  it("holds listenMode above every per-turn state", () => {
    expect(resolveReactorState({ ...live, listenOnlyEngaged: true, audioState: "speaking" })).toBe("listenMode");
    expect(resolveReactorState({ ...live, listenOnlyEngaged: true, working: true })).toBe("listenMode");
  });

  it("prefers speaking over listening over working", () => {
    expect(resolveReactorState({ ...live, audioState: "speaking", working: true })).toBe("speaking");
    expect(resolveReactorState({ ...live, audioState: "listening", working: true })).toBe("listening");
    expect(resolveReactorState({ ...live, working: true })).toBe("working");
  });

  it("falls back to online when connected and idle otherwise", () => {
    expect(resolveReactorState(live)).toBe("online");
    expect(resolveReactorState({ ...live, geminiStatus: "connecting" })).toBe("idle");
  });
});
