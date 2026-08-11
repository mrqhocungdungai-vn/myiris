import { describe, it, expect } from "vitest";
import {
  NO_READER,
  openTaskReader,
  openNoteReader,
  closeReaders,
  readerOpen,
  applyNoteSave,
  type OpenNote,
} from "./reader-slot";

const note = (id = "n1"): OpenNote => ({ id, title: "A note", markdown: "body", revision: "r1" });

// "At most one reader open at a time" (design.md D5). This used to be two
// setState calls in two functions, each remembering to clear the other.
describe("the single-reader invariant", () => {
  it("closes the note reader when the task reader opens", () => {
    const slot = openTaskReader("t1");
    expect(slot.taskId).toBe("t1");
    expect(slot.note).toBeNull();
  });

  it("closes the task reader when the note reader opens", () => {
    const slot = openNoteReader(note());
    expect(slot.note?.id).toBe("n1");
    expect(slot.taskId).toBeNull();
  });

  // The property, stated directly: no sequence of opens can leave both set.
  it("never holds both, whatever the order", () => {
    const sequences = [
      [() => openTaskReader("t1"), () => openNoteReader(note())],
      [() => openNoteReader(note()), () => openTaskReader("t1")],
      [() => openTaskReader("t1"), () => openTaskReader("t2")],
      [() => openNoteReader(note("a")), () => openNoteReader(note("b"))],
    ];
    for (const steps of sequences) {
      let slot = NO_READER;
      for (const step of steps) slot = step();
      expect(slot.taskId !== null && slot.note !== null).toBe(false);
    }
  });

  it("closes both", () => {
    expect(closeReaders()).toEqual(NO_READER);
    expect(readerOpen(closeReaders())).toBe(false);
  });
});

describe("readerOpen", () => {
  it("is true for either reader and false for neither", () => {
    expect(readerOpen(NO_READER)).toBe(false);
    expect(readerOpen(openTaskReader("t1"))).toBe(true);
    expect(readerOpen(openNoteReader(note()))).toBe(true);
  });
});

describe("applyNoteSave", () => {
  it("updates the open note in place, keeping its identity", () => {
    const slot = applyNoteSave(openNoteReader(note()), "new body", "r2");
    expect(slot.note).toMatchObject({ id: "n1", title: "A note", markdown: "new body", revision: "r2" });
  });

  // The next save is checked against what was actually written.
  it("carries the new revision forward", () => {
    let slot = openNoteReader(note());
    slot = applyNoteSave(slot, "one", "r2");
    slot = applyNoteSave(slot, "two", "r3");
    expect(slot.note?.revision).toBe("r3");
  });

  // A save landing after the reader closed must not resurrect it.
  it("drops a save that arrives with no note open", () => {
    expect(applyNoteSave(NO_READER, "body", "r2")).toEqual(NO_READER);
    expect(applyNoteSave(openTaskReader("t1"), "body", "r2").note).toBeNull();
  });

  it("does not mutate the slot it was given", () => {
    const before = openNoteReader(note());
    applyNoteSave(before, "changed", "r2");
    expect(before.note?.markdown).toBe("body");
  });
});
