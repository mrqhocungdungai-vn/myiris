import { describe, it, expect } from "vitest";
import { STATEFULNESS_CLAUSES, buildRunInstructions, buildSystemPrompt } from "./role-prompt.mjs";
import { VERB_NAMES, resolveVerb } from "./verbs.mjs";

const shape = resolveVerb("shape_requirements");
const canvas = resolveVerb("shape_on_canvas");
// ask-when-unspecified: `execute` resolves to TWO base clauses now, because
// ask-ability is a property of the work rather than of the run's shape. With an
// open change it cannot ask (the settled task list already holds the answers);
// with none it can. Both are named here so every assertion below says which one
// it means instead of relying on whatever NO_PROJECT_STATE happens to give.
const executeSettled = resolveVerb("execute", ["add-thing"]);
const executeUnspecified = resolveVerb("execute", []);
const capture = resolveVerb("capture_learning");

describe("buildRunInstructions", () => {
  // The regression guard the dropped-instruction failure lacked: two verbs of
  // the same statefulness are exactly one clause apart, and a change that
  // quietly gives one of them a different base fails here.
  it("differs between two verbs of the same statefulness only by their clause", () => {
    const a = buildRunInstructions(executeSettled);
    const b = buildRunInstructions(resolveVerb("finish"));
    expect(a).not.toEqual(b);
    expect(a.replace(executeSettled.clause, "<CLAUSE>")).toEqual(
      b.replace(resolveVerb("finish").clause, "<CLAUSE>"),
    );
  });

  it("differs between statefulness only by the documented statefulness clause and the verb clause", () => {
    const stateful = buildRunInstructions(shape).replace(shape.clause, "<CLAUSE>");
    const stateless = buildRunInstructions(executeSettled).replace(executeSettled.clause, "<CLAUSE>");
    expect(stateful.replace(STATEFULNESS_CLAUSES.stateful, "<BASE>")).toEqual(
      stateless.replace(STATEFULNESS_CLAUSES.stateless, "<BASE>"),
    );
  });

  it("tells a stateful verb it may ask and a stateless verb working from settled work that it may not", () => {
    expect(buildRunInstructions(shape)).toContain("AskUserQuestion");
    expect(buildRunInstructions(executeSettled)).not.toContain("AskUserQuestion");
    expect(buildRunInstructions(executeSettled)).toContain("never ask for clarification");
  });

  // ask-when-unspecified D5 / voice-decision-relay: "A verb told it may ask but
  // not given the tool, and a verb given the tool but told not to ask, are the
  // same defect." The prose is read off the run's own resolved bound, so the two
  // can never disagree.
  it("tells a stateless verb with no settled work that it MAY ask, and what is worth asking about", () => {
    const text = buildRunInstructions(executeUnspecified);
    expect(text).toContain("AskUserQuestion");
    expect(text).not.toContain("never ask for clarification");
    // The bar, and the consequence — both prompt-level, both stated.
    expect(text).toMatch(/wrong assumption would have to be undone/);
    expect(text).toMatch(/apply a sensible default/);
    expect(text).toMatch(/stops and writes nothing further/);
  });

  it("reads ask-ability off the resolved bound, so prose and configuration cannot disagree", () => {
    for (const name of VERB_NAMES) {
      for (const changes of [[], ["add-thing"]]) {
        const verb = resolveVerb(name, changes);
        const text = buildRunInstructions(verb);
        const withheld = verb.disallowedTools.includes("AskUserQuestion");
        expect(text.includes("AskUserQuestion"), `${name} (${changes.length ? "open change" : "no change"})`).toBe(
          !withheld,
        );
      }
    }
  });

  // Fails closed: a caller with no list at all must not be told it may ask.
  it("gives a verb with no declared bound the prose for a run that cannot ask", () => {
    const text = buildRunInstructions({ stateful: false, clause: "Do a thing." });
    expect(text).not.toContain("AskUserQuestion");
    expect(text).toContain("never ask for clarification");
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
      for (const name of VERB_NAMES.filter((verb) => verb !== "capture_learning" && verb !== "work_on_note")) {
        const verb = resolveVerb(name);
        expect(buildRunInstructions(verb, { notesVault: vault })).toEqual(buildRunInstructions(verb));
      }
    });
  });
});

describe("buildSystemPrompt", () => {
  it("uses the preset form the SDK actually reads", () => {
    expect(buildSystemPrompt(executeSettled)).toEqual({
      type: "preset",
      preset: "claude_code",
      append: buildRunInstructions(executeSettled),
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
