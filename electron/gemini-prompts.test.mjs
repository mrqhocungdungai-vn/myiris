import { describe, it, expect } from "vitest";
import {
  createGeminiPrompts,
  LISTEN_ONLY_ENGAGE_REQUEST,
  LISTEN_ONLY_DISENGAGE_REQUEST,
} from "./gemini-prompts.mjs";

const modelChoices = [{ id: "claude-opus-5", label: "Opus 5" }];

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
    capabilities,
  });
}

describe("gemini-prompts", () => {
  it("interpolates the user name and workspace context", () => {
    const converse = make({ userName: "Alex" }).buildSystemInstructionText();
    expect(converse).toContain("Alex");
    expect(converse).toContain("WORKSPACE_CONTEXT_LINE_STUB");
  });

  it("omits pipeline-only prose when the pipeline is unavailable", () => {
    const converse = make({ pipelineAvailable: false }).buildSystemInstructionText();
    expect(converse).not.toContain("submit_claude_task");
    expect(converse).toContain("no background worker");
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

// listen-mode-hears-system-audio 2.2. These live here with the rest of the
// prompt text rather than inside live-session.mjs, so the module that sends
// them holds no prose of its own.
describe("gemini-prompts: listen-only mode's in-band requests", () => {
  it("asks for complete silence and says why, without asking for a reply", () => {
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toContain("SYSTEM_EVENT_LISTEN_ONLY_ENGAGED");
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toMatch(/do not reply/i);
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toMatch(/call no tools or functions/i);
  });

  // listen-window-is-bounded: the request has to state the actual job — hold on
  // to the question, because it will be asked about in minutes — and must NOT
  // promise a record, because none is written. A model told a transcript exists
  // will offer to go and read it.
  it("says the engagement is short and that she will be asked about it", () => {
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toMatch(/next few minutes/i);
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toMatch(/will ask you about it/i);
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toMatch(/nothing is being written down/i);
  });

  it("promises no record, since none is written", () => {
    for (const text of [LISTEN_ONLY_ENGAGE_REQUEST, LISTEN_ONLY_DISENGAGE_REQUEST]) {
      expect(text).not.toMatch(/\binbox\b/i);
      expect(text).not.toMatch(/vault/i);
      expect(text).not.toMatch(/\bfile\b/i);
    }
  });

  it("releases the model without volunteering a reply or a summary on the way out", () => {
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toContain("SYSTEM_EVENT_LISTEN_ONLY_DISENGAGED");
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/do not say anything in response/i);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/do not summarize/i);
  });
});
