import { describe, it, expect, vi } from "vitest";
import { createPreparedAnswers } from "./prepared-answers.mjs";
import { PREPARED_MATERIAL_MAX_CHARS } from "../prepared-material.mjs";

/**
 * The capability over a stubbed reader, so these assertions are about what the
 * voice layer is handed — never about the walk, which `prepared-material.test.mjs`
 * owns. `material` is what `gatherPreparedMaterial` would have returned.
 *
 * @param {{ folder?: string | null, material?: any }} [options]
 */
function make({ folder = "/Users/someone/talk", material } = {}) {
  const gatherMaterial = vi.fn(() => material ?? { files: [], truncated: false, narrowed: false });
  const capability = createPreparedAnswers({
    openFolder: () => folder,
    gatherMaterial,
  });
  return { capability, gatherMaterial };
}

describe("createPreparedAnswers — the tool surface", () => {
  it("declares find_prepared_answer taking a question, and routes it against its neighbours", () => {
    const { capability } = make();
    const [declaration] = capability.toolDeclarations;

    expect(declaration.name).toBe("find_prepared_answer");
    expect(Object.keys(declaration.parameters.properties)).toEqual(["question"]);
    expect(declaration.parameters.required).toEqual(["question"]);
    // The framing find_note_by_name uses, for the same reason: this is the
    // cheapest thing the app can do, and nothing about it needs a worker.
    expect(declaration.description).toMatch(/no Claude run/i);
    expect(declaration.description).toMatch(/no tokens/i);
    expect(declaration.description).toMatch(/no Claude credential/i);
    // Both boundaries, explicitly — the routing hazard is the whole reason the
    // description is this long.
    expect(declaration.description).toMatch(/find_note_by_name/);
    expect(declaration.description).toMatch(/capture_learning/);
  });
});

describe("createPreparedAnswers — looking for an answer", () => {
  it("says no folder is open rather than searching anywhere else", () => {
    const { capability, gatherMaterial } = make({ folder: null });

    const result = capability.findPreparedAnswer({ question: "how does the window expire?" });

    expect(result.found).toBe(false);
    expect(result.reason).toBe("no_folder_open");
    // The default workspace is where Claude's file work lands, not somewhere
    // anyone prepared anything (design D1) — so nothing is read at all.
    expect(gatherMaterial).not.toHaveBeenCalled();
    expect(capability.probe()).toEqual({ ok: false, folder: null });
  });

  it("returns the prepared text verbatim and names the file it came from", () => {
    const prepared = "The window is five minutes, and nothing you hear extends it.";
    const { capability, gatherMaterial } = make({
      material: { files: [{ path: "qa/window.md", text: prepared }], truncated: false, narrowed: false },
    });

    const result = capability.findPreparedAnswer({ question: "How long does listening last?" });

    expect(result.found).toBe(true);
    expect(result.folder).toBe("/Users/someone/talk");
    expect(result.sources).toEqual(["qa/window.md"]);
    // Fenced on the way to the model, unaltered inside the fence: the fence is a
    // label, and what Iris reads aloud is the user's wording (design D6).
    expect(result.material).toMatch(/untrusted content/i);
    expect(result.material).toContain(prepared);
    expect(result.material).toContain("qa/window.md");
    // The question travels, because it is what the overflow path would match on.
    expect(gatherMaterial).toHaveBeenCalledWith({
      folder: "/Users/someone/talk",
      question: "How long does listening last?",
    });
  });

  it("returns a not-found result when the folder holds no prepared material at all", () => {
    // The realistic mistake: the session is pointed at a code repository, whose
    // .js/.ts files are not prepared material. Deciding whether prepared text
    // ANSWERS the question is Gemini's job (design D2) — so "found: false" here
    // means there was nothing to consider, not that a scorer disliked it.
    const { capability } = make({ material: { files: [], truncated: false, narrowed: false } });

    const result = capability.findPreparedAnswer({ question: "what about pricing?" });

    expect(result.found).toBe(false);
    expect(result.reason).toBe("nothing_prepared");
    expect(result.folder).toBe("/Users/someone/talk");
    // The two costly routes are offered by the result, and neither is taken.
    expect(result.message).toMatch(/Claude verb/);
    expect(result.message).toMatch(/notes vault/);
    expect(result.message).toMatch(/start neither/i);
  });

  it("passes on that a large folder was narrowed rather than presenting it as full coverage", () => {
    const { capability } = make({
      material: {
        files: [{ path: "answers.md", text: "x".repeat(PREPARED_MATERIAL_MAX_CHARS) }],
        truncated: true,
        narrowed: true,
      },
    });

    const result = capability.findPreparedAnswer({ question: "anything" });

    expect(result.narrowed).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.instructions).toMatch(/only the most likely part/i);
    expect(result.instructions).toMatch(/not read at all/i);
  });

  it("does not claim narrowing when the whole folder fit", () => {
    const { capability } = make({
      material: { files: [{ path: "answers.md", text: "short" }], truncated: false, narrowed: false },
    });

    const result = capability.findPreparedAnswer({ question: "anything" });

    expect(result.narrowed).toBe(false);
    expect(result.instructions).not.toMatch(/most likely part/i);
  });

  it("tolerates a missing question rather than refusing to look", () => {
    const { capability, gatherMaterial } = make({
      material: { files: [{ path: "a.md", text: "material" }], truncated: false, narrowed: false },
    });

    expect(capability.findPreparedAnswer().found).toBe(true);
    expect(gatherMaterial).toHaveBeenCalledWith({ folder: "/Users/someone/talk", question: "" });
  });
});

describe("createPreparedAnswers — the prompt fragment", () => {
  it("names the folder being searched, so a wrong session is visible", () => {
    const { capability } = make({ folder: "/Users/someone/talk" });

    expect(capability.promptFragment()).toContain("/Users/someone/talk");
  });

  it("says the answer is announced in one line and read only on the user's cue", () => {
    const fragment = make().capability.promptFragment();

    expect(fragment).toMatch(/ONE short line/);
    expect(fragment).toMatch(/WAIT/);
    expect(fragment).toMatch(/do not begin reading unprompted/i);
    expect(fragment).toMatch(/exactly as written/i);
  });

  it("says a miss offers the two costly routes and starts neither", () => {
    const fragment = make().capability.promptFragment();

    expect(fragment).toMatch(/Claude verb/);
    expect(fragment).toMatch(/notes vault/);
    expect(fragment).toMatch(/NEITHER until the user chooses/);
  });

  it("says the lookup happens the moment the mode ends, without asking first", () => {
    const fragment = make().capability.promptFragment();

    expect(fragment).toMatch(/listen-only mode ends/);
    expect(fragment).toMatch(/before you consider any\s+verb/);
    expect(fragment).toMatch(/without asking the user whether you should look/i);
  });

  it("says up front that no folder is selected, rather than naming one", () => {
    const fragment = make({ folder: null }).capability.promptFragment();

    expect(fragment).toMatch(/NO folder is selected/);
  });
});
