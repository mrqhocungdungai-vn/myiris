// Who a transcript line is attributed to, in one place, because the deck and
// the HUD both render it and a disagreement between them would be a
// disagreement about whose words the user is reading.

export type TranscriptVoice = "self" | "iris" | "heard";

/**
 * The speaker id main uses for a line Iris merely OVERHEARD
 * (listen-mode-hears-system-audio).
 *
 * While listen-only mode is engaged the input is one summed stream — the
 * microphone AND the audio the machine is playing — so a line may be the user,
 * another person in the room, a remote participant, or a video. Nothing can
 * separate them: the two sources are mixed in the renderer's worklet before
 * anything leaves the machine, which is the whole reason the transport and the
 * chunk format were left untouched.
 *
 * Attributing that to "You" is a false statement about the user's own words,
 * and the same principle is already spelled out for what gets written to the
 * vault: it "SHALL NOT be presented as the user's own words". The screen was
 * simply never brought in line with it.
 *
 * Deliberately contains neither "you" nor "user", so the self test below cannot
 * match it by accident.
 */
export const HEARD_SPEAKER = "heard";

export function transcriptVoice(speaker: string): TranscriptVoice {
  if (speaker === HEARD_SPEAKER) return "heard";
  return /you|user/i.test(speaker) ? "self" : "iris";
}

/**
 * "Heard" rather than a guess at who spoke. It says what is actually known —
 * Iris heard this — and claims nothing further, which is the honest position
 * when the sources are unseparable.
 */
export function transcriptVoiceLabel(voice: TranscriptVoice): string {
  if (voice === "self") return "You";
  if (voice === "heard") return "Heard";
  return "Iris";
}

/**
 * The tail of what Iris is hearing right now, for the caption under the orb.
 *
 * The tail rather than the head: this reads as live captioning, so the newest
 * words are the ones that prove the capture is alive. Bounded because the
 * caption is one line of chrome, not a transcript — the full text is in the
 * mode's own record.
 */
export function liveHeardCaption(text: string, max = 150): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(-max)}`;
}
