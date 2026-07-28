import { describe, it, expect } from "vitest";
import { createGeminiPrompts } from "./gemini-prompts.mjs";

const modelChoices = [{ id: "claude-fable-5", label: "Fable" }];

function make({
  pipelineAvailable = true,
  envFlag = () => false,
  userName = "Alex",
  capabilities = [],
} = {}) {
  return createGeminiPrompts({
    getPipelineAvailable: () => pipelineAvailable,
    modelChoices,
    envFlag,
    userDisplayName: () => userName,
    workspaceContextLine: () => "WORKSPACE_CONTEXT_LINE_STUB",
    fenceUntrustedText: (text, label) => `<<${label}>>${text}<<end>>`,
    capabilities,
  });
}

describe("gemini-prompts", () => {
  it("converse instructions differ from listening instructions", () => {
    const prompts = make();
    const converse = prompts.buildSystemInstructionText();
    const listen = prompts.buildListenSystemInstructionText();
    expect(converse).not.toEqual(listen);
    expect(listen).toContain("LISTENING MODE is engaged");
    expect(converse).not.toContain("LISTENING MODE is engaged");
  });

  it("interpolates the user name and workspace context in converse mode", () => {
    const converse = make({ userName: "Alex" }).buildSystemInstructionText();
    expect(converse).toContain("Alex");
    expect(converse).toContain("WORKSPACE_CONTEXT_LINE_STUB");
  });

  it("omits pipeline-only prose when the pipeline is unavailable", () => {
    const converse = make({ pipelineAvailable: false }).buildSystemInstructionText();
    expect(converse).not.toContain("submit_claude_task");
    expect(converse).toContain("no background worker");
  });

  it("fences captured speech in the exit synthesis prompt", () => {
    const prompt = make().buildListenExitSynthesisPrompt("we should ship on Friday");
    expect(prompt).toContain("<<what the user said while listening mode was engaged (transcribed, not verbatim)>>we should ship on Friday<<end>>");
  });

  it("exit synthesis prompt handles an empty segment", () => {
    const prompt = make().buildListenExitSynthesisPrompt("");
    expect(prompt).toContain("Nothing was captured");
  });

  it("entry confirmation prompt is a stable one-liner", () => {
    const prompt = make().buildListenEntryConfirmationPrompt();
    expect(prompt).toContain("SYSTEM_EVENT_LISTEN_MODE_START");
  });

  it("splicing an empty capability list changes nothing", () => {
    expect(make({ capabilities: [] }).buildSystemInstructionText()).toEqual(make().buildSystemInstructionText());
  });

  it("splices a registered capability's prompt fragment into the instructions", () => {
    const fakeCapability = { promptFragment: () => "FAKE_CAPABILITY_FRAGMENT" };
    const text = make({ capabilities: [fakeCapability] }).buildSystemInstructionText();
    expect(text).toContain("FAKE_CAPABILITY_FRAGMENT");
  });
});
