import { fenceUntrustedText } from "../untrusted-text.mjs";

// The SYSTEM_EVENT messages the second brain pushes to the voice layer.
//
// Pure builders: each takes what it describes and returns the message lines.
// Split out of second-brain.mjs so the two properties that actually matter here
// can be asserted directly.
//
// **1. Untrusted content is fenced.** Note titles and tags reach a model
// without Iris having authored them, and vault content may originate from the
// web (second-brain-focus). Every line carrying a title or tag goes through
// `fenceUntrustedText`. A fence quietly dropped from one of these builders is a
// prompt-injection path, and it is not the kind of thing a type or a lint rule
// notices.
//
// **2. The "gone" case is announced, not skipped.** Closing a note or clearing
// the focus pushes a message of its own, so the model drops a stale deictic
// referent rather than continuing to believe something is open or focused
// ("No focus, no focus talk"). Announcing only the present state is the bug
// these paired messages exist to prevent.

/** One bullet per focused note: title, and tags when it has any. */
function noteBullet(note) {
  return `- ${note.title}${note.tags.length ? ` (tags: ${note.tags.join(", ")})` : ""}`;
}

/** The focused notes, fenced. */
export function focusLine(notes) {
  return fenceUntrustedText(
    notes.map(noteBullet).join("\n"),
    "titles/tags of the notes currently focused in the second-brain galaxy",
  );
}

/**
 * The open note's own line — "identity, title, and tags — not its body"
 * (open-note-session), fenced on the same terms as `focusLine`.
 */
export function openNoteLine(note) {
  return fenceUntrustedText(noteBullet(note), "title/tags of the note currently open in the reader");
}

/**
 * Fired on open, on close, and on switch. A close tells the model the referent
 * is gone rather than leaving it believing a note that no longer exists is
 * still open — the focus, if any, becomes the referent again the instant this
 * fires with nothing open.
 *
 * @param {{ title: string, tags: string[] } | null} note
 */
export function noteOpenedMessage(note) {
  if (note) {
    return [
      "SYSTEM_EVENT_NOTE_OPENED",
      openNoteLine(note),
      "instructions_to_iris:",
      "- Silently remember this as the note currently open in the reader. Do NOT speak or respond to this message.",
      '- While a note is open, a deictic request ("this", "this note") refers to it, not to whatever is focused in the second-brain galaxy.',
    ];
  }
  return [
    "SYSTEM_EVENT_NOTE_CLOSED",
    "No note is open in the reader anymore.",
    "instructions_to_iris:",
    "- Silently forget the open note as a deictic referent. Do NOT speak or respond to this message.",
    "- A deictic request now resolves against whatever is focused in the second-brain galaxy, if anything.",
  ];
}

/**
 * A hand edit invalidates the session's reading of the note (open-note-session).
 * The note now has two writers, and the session's value is that a reading and
 * the edits referring to it come from one context. Iris deliberately does not
 * try to reconcile the old reading with the new text — there is no correct way
 * to do that from outside the session — it says the reading is superseded and
 * lets the session re-read.
 */
export function noteEditedMessage(note) {
  return [
    "SYSTEM_EVENT_NOTE_EDITED",
    openNoteLine(note),
    "The user just edited this note by hand in the reader, so its text has changed.",
    "instructions_to_iris:",
    "- Silently remember that any earlier reading of this note is superseded. Do NOT speak or respond to this message.",
    "- Before changing a named part of it, have the note read again — a part named against the earlier reading may no longer be the same text.",
  ];
}

/**
 * The live focus push. The Gemini Live system instruction is built once at
 * connect and does not update mid-session, so a fact that changes constantly
 * needs its own SYSTEM_EVENT rather than relying on `promptFragment()`, which
 * only describes the focus as of the last connect.
 */
export function focusUpdateMessage(notes) {
  return [
    "SYSTEM_EVENT_FOCUS_UPDATE",
    notes.length ? focusLine(notes) : "Nothing is focused in the second-brain galaxy right now.",
    "instructions_to_iris:",
    "- Silently remember this as the currently focused vault notes. Do NOT speak or respond to this message.",
    "- If nothing is focused, forget any notes you previously heard about this way — a deictic request ('these', 'this one') now has nothing to resolve against, so ask what the user means rather than guessing.",
  ];
}
