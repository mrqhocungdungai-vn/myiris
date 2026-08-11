// Which reader is open — and the rule that at most one ever is.
//
// There are two readers: the task reader (a run's output) and the note reader
// (a vault note). The spec is explicit — "At most one reader open at a time"
// (design.md D5) — but the rule lived as two `setState` calls in two different
// functions, each remembering to clear the other. Nothing stated it, and
// nothing would have failed if one of them stopped.
//
// Modelling it as a single slot makes the invariant true by construction: there
// is one place a reader can be, so opening one *is* closing the other.

/** The open note, as the reader needs it. */
export type OpenNote = {
  id: string;
  title: string;
  markdown: string;
  revision: string;
};

/** Exactly one of these is non-null, or neither is. Never both. */
export type ReaderSlot = {
  taskId: string | null;
  note: OpenNote | null;
};

export const NO_READER: ReaderSlot = { taskId: null, note: null };

/** Opening the task reader closes the note reader. */
export function openTaskReader(taskId: string): ReaderSlot {
  return { taskId, note: null };
}

/** Opening the note reader closes the task reader. */
export function openNoteReader(note: OpenNote): ReaderSlot {
  return { taskId: null, note };
}

export function closeReaders(): ReaderSlot {
  return NO_READER;
}

/** Whether either reader is open — the gate several gesture bindings read. */
export function readerOpen(slot: ReaderSlot): boolean {
  return slot.taskId !== null || slot.note !== null;
}

/**
 * A saved edit updates the open note in place — no reopen, no re-fetch.
 *
 * The new revision comes back from the write itself, so the next save in the
 * same sitting is checked against what was actually written rather than
 * against the content the reader was first opened on. A save that lands after
 * the note was closed, or after a different one was opened, is dropped.
 */
export function applyNoteSave(slot: ReaderSlot, content: string, revision: string): ReaderSlot {
  if (!slot.note) return slot;
  return { taskId: null, note: { ...slot.note, markdown: content, revision } };
}
