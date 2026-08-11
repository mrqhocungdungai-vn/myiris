// What notice, if any, engaging listen-only mode should raise.
//
// Two different things are decided here and they must not be conflated:
//
//   * **Consent** — the mode widens what Iris hears to whatever the machine
//     plays, which may include other people. Engaging IS the consent point, so
//     the statement is made on the engaging edge and remembered, making it a
//     first-run notice rather than a nag.
//   * **Mechanics** — speaker output re-enters the microphone and reaches Iris
//     a second time, degraded. That is advice about audio quality, not about
//     permission, and it is only worth raising once consent is settled.
//
// Both belong to the engaging edge, and **only when there is actually a capture
// to consent to**: under the escape hatch (`systemAudio` false) the mode
// retains nothing and captures nothing, so saying otherwise would be false.
//
// Extracted from App.tsx so this stays assertable. A consent statement that
// silently stops appearing is not a defect any type or lint check can see.

export type ListenOnlyNotice = "consent" | "headphones" | "refused" | null;

export type NoticeInputs = {
  /** Whether the mode is now engaged. */
  engaged: boolean;
  /** Whether this engagement actually captures system audio. */
  systemAudio: boolean;
  /** Whether the consent statement has been shown before. */
  consentSeen: boolean;
  /** Whether output is going to speakers rather than headphones. */
  outputIsSpeakers: boolean;
};

/**
 * The notice for an engaging edge.
 *
 * Consent outranks the headphone advice: on a first engage the user is told
 * what the mode hears, and the audio-quality tip waits for a later one rather
 * than competing with it.
 *
 * Returns `null` when nothing should be said — including every disengaging
 * edge, which is handled by `noticeAfterTransition` below.
 */
export function noticeForEngagement(input: NoticeInputs): ListenOnlyNotice {
  if (!input.engaged || !input.systemAudio) return null;
  if (!input.consentSeen) return "consent";
  return input.outputIsSpeakers ? "headphones" : null;
}

/**
 * The notice after any transition, given whatever was showing before.
 *
 * Disengaging clears the notice: a statement about what Iris is hearing must
 * not outlive the hearing. An engaging edge that raises nothing leaves the
 * current notice alone rather than clearing it, so a "refused" notice raised by
 * main is not wiped by an unrelated push.
 */
export function noticeAfterTransition(current: ListenOnlyNotice, input: NoticeInputs): ListenOnlyNotice {
  if (!input.engaged) return null;
  return noticeForEngagement(input) ?? current;
}

/**
 * Whether the consent statement has now been made and should be remembered.
 *
 * Separate from raising it so the caller persists on exactly the edge that
 * showed it, and never on one that did not.
 */
export function consentWasStated(notice: ListenOnlyNotice): boolean {
  return notice === "consent";
}
