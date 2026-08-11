import { useState } from "react";
import {
  NO_READER,
  openTaskReader,
  openNoteReader,
  closeReaders,
  readerOpen as isReaderOpen,
  applyNoteSave,
  type OpenNote,
  type ReaderSlot,
} from "../lib/reader-slot";

// Which reader is open — the task reader or the note reader — held as one slot
// so "at most one reader open at a time" (design.md D5) is true by
// construction rather than by two setters each remembering to clear the other.
//
// This is deliberately its own domain. Neither tasks nor the second brain owns
// it: both *open into* it, which is exactly why the invariant kept having to be
// restated at each call site.

export type ReaderControl = {
  /** The open task's id, or null. */
  taskId: string | null;
  /** The open note, or null. */
  note: OpenNote | null;
  /** True while either reader is open — the gate several gesture bindings read. */
  isOpen: boolean;
  openTask: (taskId: string) => void;
  openNote: (note: OpenNote) => void;
  closeTask: () => void;
  /** Closes the note reader and tells main, which is the authority on what is open. */
  closeNote: () => void;
  /** A saved edit updates the note in place — no reopen, no re-fetch. */
  noteSaved: (content: string, revision: string) => void;
  /** Both readers closed without notifying main — for teardown paths that already did. */
  closeAll: () => void;
};

export function useReaderSlot({ onNoteClosed }: { onNoteClosed: () => void }): ReaderControl {
  const [slot, setSlot] = useState<ReaderSlot>(NO_READER);

  return {
    taskId: slot.taskId,
    note: slot.note,
    isOpen: isReaderOpen(slot),
    openTask: (taskId) => setSlot(openTaskReader(taskId)),
    openNote: (note) => setSlot(openNoteReader(note)),
    closeTask: () => setSlot((current) => (current.taskId === null ? current : closeReaders())),
    closeNote() {
      setSlot(closeReaders());
      onNoteClosed();
    },
    noteSaved: (content, revision) => setSlot((current) => applyNoteSave(current, content, revision)),
    closeAll: () => setSlot(NO_READER),
  };
}
