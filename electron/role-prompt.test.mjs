import { describe, it, expect } from "vitest";
import { STATEFULNESS_CLAUSES, buildRunInstructions, buildSystemPrompt } from "./role-prompt.mjs";
import { VERB_NAMES, resolveVerb } from "./verbs.mjs";

const shape = resolveVerb("shape_requirements");
const canvas = resolveVerb("shape_on_canvas");
const execute = resolveVerb("execute");
const capture = resolveVerb("capture_learning");

describe("buildRunInstructions", () => {
  // The regression guard the dropped-instruction failure lacked: two verbs of
  // the same statefulness are exactly one clause apart, and a change that
  // quietly gives one of them a different base fails here.
  it("differs between two verbs of the same statefulness only by their clause", () => {
    const a = buildRunInstructions(execute);
    const b = buildRunInstructions(resolveVerb("finish"));
    expect(a).not.toEqual(b);
    expect(a.replace(execute.clause, "<CLAUSE>")).toEqual(b.replace(resolveVerb("finish").clause, "<CLAUSE>"));
  });

  it("differs between statefulness only by the documented statefulness clause and the verb clause", () => {
    const stateful = buildRunInstructions(shape).replace(shape.clause, "<CLAUSE>");
    const stateless = buildRunInstructions(execute).replace(execute.clause, "<CLAUSE>");
    expect(stateful.replace(STATEFULNESS_CLAUSES.stateful, "<BASE>")).toEqual(
      stateless.replace(STATEFULNESS_CLAUSES.stateless, "<BASE>"),
    );
  });

  it("tells a stateful verb it may ask and a stateless one that it may not", () => {
    expect(buildRunInstructions(shape)).toContain("AskUserQuestion");
    expect(buildRunInstructions(execute)).not.toContain("AskUserQuestion");
    expect(buildRunInstructions(execute)).toContain("never ask for clarification");
  });

  it("carries each verb's own clause", () => {
    for (const name of VERB_NAMES) {
      const verb = resolveVerb(name);
      expect(buildRunInstructions(verb)).toContain(verb.clause);
    }
  });

  // The two shaping verbs share a session but not a job, so their prompts differ
  // even though everything else about them matches.
  it("keeps the two shaping verbs' clauses distinct", () => {
    expect(buildRunInstructions(shape)).not.toEqual(buildRunInstructions(canvas));
    expect(buildRunInstructions(canvas)).toContain("canvas");
  });

  // A missing base is a bundle-level bug, and a prompt silently missing its
  // instruction is the exact failure mode this module exists to prevent.
  it("fails loudly rather than composing a prompt with no clause", () => {
    expect(() => buildRunInstructions(null)).toThrow(/resolved verb with a clause/);
    expect(() => buildRunInstructions({ stateful: false, clause: "" })).toThrow(/resolved verb with a clause/);
  });

  describe("the notes vault clause", () => {
    const vault = { dir: "/Users/x/iris-second-brain", skillsInstalled: true, inbox: "/Users/x/iris-second-brain/inbox/runs" };

    it("names the vault root and the run inbox for the verb that declares it", () => {
      const text = buildRunInstructions(capture, { notesVault: vault });
      expect(text).toContain("/Users/x/iris-second-brain");
      expect(text).toContain("/Users/x/iris-second-brain/inbox/runs");
      // The clause informs; run-exec grants the directory for real via
      // `additionalDirectories`. It no longer pleads with the model to proceed.
      expect(text).toContain("granted to this run");
      expect(text).not.toContain("never ask the user");
    });

    it("says so honestly when the skills are not in the bundle", () => {
      const text = buildRunInstructions(capture, { notesVault: { ...vault, skillsInstalled: false } });
      expect(text).toContain("not available in this build");
      expect(text).not.toContain("/Users/x/iris-second-brain/inbox");
    });

    // The grant and the prose must agree: a verb without `vault` gets no
    // `additionalDirectories`, so telling it about a vault would describe access
    // it does not have.
    it("is never added to a verb that does not declare a vault, even if a caller passes one", () => {
      for (const name of VERB_NAMES.filter((verb) => verb !== "capture_learning")) {
        const verb = resolveVerb(name);
        expect(buildRunInstructions(verb, { notesVault: vault })).toEqual(buildRunInstructions(verb));
      }
    });
  });
});

describe("buildSystemPrompt", () => {
  it("uses the preset form the SDK actually reads", () => {
    expect(buildSystemPrompt(execute)).toEqual({
      type: "preset",
      preset: "claude_code",
      append: buildRunInstructions(execute),
    });
  });

  // The original failure mode: `appendSystemPrompt` is not a field of the public
  // `Options` type, and the SDK's normalizer destructures it away without ever
  // reading it. Nothing this module produces may carry one.
  it("never emits an appendSystemPrompt field", () => {
    for (const name of VERB_NAMES) {
      expect(Object.keys(buildSystemPrompt(resolveVerb(name)))).toEqual(["type", "preset", "append"]);
    }
  });
});
