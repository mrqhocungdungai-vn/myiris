import { describe, it, expect } from "vitest";
import { buildRoleInstructions, buildSystemPrompt, ROLE_CLAUSES } from "./role-prompt.mjs";

describe("buildRoleInstructions", () => {
  // The regression guard F1 lacked: the two roles are one clause apart, and a
  // change that quietly gives one of them a different base fails here.
  it("differs between PO and DEV only in the documented role clause", () => {
    const po = buildRoleInstructions("po");
    const dev = buildRoleInstructions("dev");
    expect(po).not.toEqual(dev);
    expect(po.replace(ROLE_CLAUSES.po, "<CLAUSE>")).toEqual(dev.replace(ROLE_CLAUSES.worker, "<CLAUSE>"));
  });

  it("gives DEV and plain Claude the same headless clause", () => {
    expect(buildRoleInstructions("dev")).toEqual(buildRoleInstructions("plain"));
  });

  it("tells PO it may ask and DEV that it may not", () => {
    expect(buildRoleInstructions("po")).toContain("AskUserQuestion");
    expect(buildRoleInstructions("dev")).not.toContain("AskUserQuestion");
    expect(buildRoleInstructions("dev")).toContain("never ask for clarification");
  });

  describe("the notes vault clause", () => {
    const vault = { dir: "/Users/x/.iris/notes", skillsInstalled: true };

    it("names the vault root for plain Claude when the skills are installed", () => {
      const text = buildRoleInstructions("plain", { notesVault: vault });
      expect(text).toContain("/Users/x/.iris/notes");
      expect(text).toContain("Use the wiki skills there");
      // The clause informs; run-exec grants the directory for real via
      // `additionalDirectories`. It no longer pleads with the model to proceed.
      expect(text).toContain("granted to this run");
      expect(text).not.toContain("never ask the user");
    });

    it("refuses honestly when the skills are not installed", () => {
      const text = buildRoleInstructions("plain", { notesVault: { ...vault, skillsInstalled: false } });
      expect(text).toContain("not installed on this machine yet");
      expect(text).not.toContain("/Users/x/.iris/notes");
    });

    // design.md D3/D5 of the llm-wiki change: the role prompts must stay
    // byte-identical whether or not a vault exists.
    it("is never added to a role prompt, even if a caller passes one", () => {
      for (const role of /** @type {const} */ (["po", "dev"])) {
        expect(buildRoleInstructions(role, { notesVault: vault })).toEqual(buildRoleInstructions(role));
      }
    });
  });
});

describe("buildSystemPrompt", () => {
  it("uses the preset form the SDK actually reads", () => {
    expect(buildSystemPrompt("dev")).toEqual({
      type: "preset",
      preset: "claude_code",
      append: buildRoleInstructions("dev"),
    });
  });

  // F1's failure mode: `appendSystemPrompt` is not a field of the public
  // `Options` type, and the SDK's normalizer destructures it away without ever
  // reading it. Nothing this module produces may carry one.
  it("never emits an appendSystemPrompt field", () => {
    for (const role of /** @type {const} */ (["po", "dev", "plain"])) {
      expect(Object.keys(buildSystemPrompt(role))).toEqual(["type", "preset", "append"]);
    }
  });
});
