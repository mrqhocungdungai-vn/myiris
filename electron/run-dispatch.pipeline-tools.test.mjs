import { describe, it, expect } from "vitest";
import { PIPELINE_ONLY_TOOLS } from "./run-dispatch.mjs";
import { createGeminiTools } from "./gemini-tools.mjs";

// PIPELINE_ONLY_TOOLS is a hand-maintained second copy of "which tools need a
// Claude credential". The declarations in gemini-tools.mjs are the first copy.
// Nothing forced them to agree, and the failure mode is silent in the direction
// that matters: a pipeline tool missing from the guard stays callable in
// chat-only mode and returns a confusing failure from deep inside a run
// instead of the clean "add a Claude credential" error.
//
// They agree today. This test exists so they keep agreeing.

const tools = createGeminiTools({
  getPipelineAvailable: () => true,
  modelChoices: [],
  envFlag: () => false,
  capabilities: [],
});

const declaredPipelineTools = new Set(tools.buildPipelineToolDeclarations().map((decl) => decl.name));

// Tools declared to Gemini that are deliberately NOT credential-gated, each
// with the reason. These are the voice/UI surface: they must keep working with
// no Claude credential at all, exactly as `find_prepared_answer` is
// deliberately outside this set (prepared-answers spec).
const DELIBERATELY_UNGATED = new Map([
  ["get_ui_context", "reads renderer state; chat-only mode still has a UI"],
  ["control_ui", "drives the renderer; nothing about it needs a run"],
  ["go_to_sleep", "wake/sleep is the voice session, not the pipeline"],
]);

describe("the pipeline-only guard matches the tool declarations", () => {
  it("gates every declared pipeline tool that is not deliberately exempt", () => {
    const ungated = [...declaredPipelineTools].filter(
      (name) => !PIPELINE_ONLY_TOOLS.has(name) && !DELIBERATELY_UNGATED.has(name),
    );
    expect(ungated).toEqual([]);
  });

  // The other direction: a name in the guard that no longer exists is dead
  // weight, and reads as protection that is not actually protecting anything.
  it("gates nothing that is not declared, except the deprecated alias", () => {
    const stale = [...PIPELINE_ONLY_TOOLS].filter(
      (name) => !declaredPipelineTools.has(name) && name !== "submit_claude_task",
    );
    expect(stale).toEqual([]);
  });

  // If one of these ever becomes credential-gated, that is a real decision:
  // update the map above with the reason rather than deleting the assertion.
  it("keeps the voice/UI tools usable with no Claude credential", () => {
    for (const [name] of DELIBERATELY_UNGATED) {
      expect(PIPELINE_ONLY_TOOLS.has(name)).toBe(false);
    }
  });

  it("still gates the tools a run cannot happen without", () => {
    for (const name of ["execute", "check_claude_status", "answer_claude_question", "stop_claude_task"]) {
      expect(PIPELINE_ONLY_TOOLS.has(name)).toBe(true);
    }
  });
});
