import { describe, it, expect } from "vitest";
import { HEARD_SPEAKER, liveHeardCaption, transcriptVoice, transcriptVoiceLabel } from "./transcript-speaker";

// listen-mode-hears-system-audio. Before the mode existed, "you" was accurate:
// Iris only ever heard the microphone, so everything she heard WAS the user.
// Mixing system audio into the same stream made that label a false statement
// about the user's own words — and nothing can separate the sources, since they
// are summed in the renderer's worklet before anything leaves the machine.
describe("transcriptVoice", () => {
  it("attributes overheard audio to neither the user nor Iris", () => {
    expect(transcriptVoice(HEARD_SPEAKER)).toBe("heard");
    expect(transcriptVoiceLabel("heard")).toBe("Heard");
  });

  it("keeps the user's own words the user's outside the mode", () => {
    expect(transcriptVoice("you")).toBe("self");
    expect(transcriptVoice("user")).toBe("self");
    expect(transcriptVoiceLabel("self")).toBe("You");
  });

  it("still reads Gemini's own lines as Iris", () => {
    expect(transcriptVoice("gemini")).toBe("iris");
    expect(transcriptVoiceLabel("iris")).toBe("Iris");
  });

  it("cannot let the overheard id match the self test by accident", () => {
    // The failure this guards: any label containing "you" or "user" would fall
    // through to "self" and re-attribute a video's words to the user.
    expect(HEARD_SPEAKER).not.toMatch(/you|user/i);
  });
});

// The caption under the orb, so "hearing perfectly" and "capture is dead" stop
// looking identical until the mode ends — the state that had the user asking
// Claude to read a record that turned out to be empty.
describe("liveHeardCaption", () => {
  it("shows short text unchanged", () => {
    expect(liveHeardCaption("  the deploy goes out Friday  ")).toBe("the deploy goes out Friday");
  });

  it("keeps the NEWEST words, not the oldest — that is what proves it is alive", () => {
    const text = `${"old ".repeat(60)}the newest words`;
    const caption = liveHeardCaption(text, 40);
    expect(caption).toContain("the newest words");
    expect(caption.startsWith("…")).toBe(true);
    expect(caption.length).toBeLessThanOrEqual(41);
  });

  it("has nothing to show for empty input", () => {
    expect(liveHeardCaption("   ")).toBe("");
  });
});
