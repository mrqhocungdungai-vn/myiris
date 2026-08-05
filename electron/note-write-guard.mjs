// The pure predicate behind the open note's destructive-edit confirmation
// (open-note-session design.md D6/8.1): whether a proposed Edit or Write
// removes anything from the file it targets. Takes no model claim as input —
// only the tool call itself and the file's actual current content — because
// the whole point is a decision main can make for itself, not one it trusts
// the session to have reported honestly.
//
// An Edit removes nothing when its `new_string` contains its `old_string` (a
// pure insertion is the special case where `old_string` is empty, which is
// trivially contained). A Write removes nothing when its proposed content
// contains the file's current content in full. Everything this cannot decide
// — an unrecognized tool, or either of the above failing — falls to
// "removes something", the safe direction: incompleteness here costs an
// extra confirmation, never a silent deletion.
//
// Electron-free, no I/O — the caller reads the file and hands its content in.

/**
 * @param {{ toolName: string, input: any, currentContent: string }} params
 * @returns {boolean} true when the write is known to remove nothing
 */
export function writeRemovesNothing({ toolName, input, currentContent }) {
  if (toolName === "Edit") {
    const oldString = String(input?.old_string ?? "");
    const newString = String(input?.new_string ?? "");
    return newString.includes(oldString);
  }
  if (toolName === "Write") {
    const content = String(input?.content ?? "");
    return content.includes(String(currentContent ?? ""));
  }
  return false;
}
