import { describe, it, expect } from "vitest";
import { writeRemovesNothing } from "./note-write-guard.mjs";

describe("writeRemovesNothing", () => {
  it("passes a pure-insertion Edit (old_string is a substring of new_string)", () => {
    expect(
      writeRemovesNothing({
        toolName: "Edit",
        input: { old_string: "Paragraph one.", new_string: "Paragraph one.\n\nParagraph two." },
        currentContent: "Paragraph one.",
      }),
    ).toBe(true);
  });

  it("passes a pure-insertion Edit with an empty old_string", () => {
    expect(
      writeRemovesNothing({
        toolName: "Edit",
        input: { old_string: "", new_string: "Added text." },
        currentContent: "",
      }),
    ).toBe(true);
  });

  it("confirms an Edit that drops text", () => {
    expect(
      writeRemovesNothing({
        toolName: "Edit",
        input: { old_string: "Paragraph one.\n\nParagraph two.", new_string: "Paragraph one." },
        currentContent: "Paragraph one.\n\nParagraph two.",
      }),
    ).toBe(false);
  });

  it("confirms an Edit that replaces text with unrelated text", () => {
    expect(
      writeRemovesNothing({
        toolName: "Edit",
        input: { old_string: "the deadline is Friday", new_string: "the deadline is Monday" },
        currentContent: "the deadline is Friday",
      }),
    ).toBe(false);
  });

  it("passes a Write whose content contains the current content in full", () => {
    expect(
      writeRemovesNothing({
        toolName: "Write",
        input: { content: "Paragraph one.\n\nParagraph two." },
        currentContent: "Paragraph one.",
      }),
    ).toBe(true);
  });

  it("confirms a Write that shrinks the file", () => {
    expect(
      writeRemovesNothing({
        toolName: "Write",
        input: { content: "Paragraph one." },
        currentContent: "Paragraph one.\n\nParagraph two.",
      }),
    ).toBe(false);
  });

  it("confirms an unrecognized tool", () => {
    expect(
      writeRemovesNothing({ toolName: "Bash", input: { command: "rm note.md" }, currentContent: "anything" }),
    ).toBe(false);
  });
});
