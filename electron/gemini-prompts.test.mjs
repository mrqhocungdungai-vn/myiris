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

  it("releases the model without volunteering a summary on the way out", () => {
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toContain("SYSTEM_EVENT_LISTEN_ONLY_DISENGAGED");
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/do not summarize/i);
  });

  // iris-answers-from-the-open-folder D4: the settling step is this sentence and
  // nothing else — no new event, no new channel. The disengage note already fired
  // at exactly the right moment; what changed is what it says.
  it("sends her to the prepared folder at once, before any verb", () => {
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/find_prepared_answer/);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/RIGHT NOW/);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/before you consider any other tool or verb/i);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/without asking the user whether you should look/i);
  });

  // The one line a disengage may produce, and the beat after it. Reading
  // unprompted would talk over a live presentation, which is worse than waiting.
  it("allows exactly one short line for a found answer, and no reading until the cue", () => {
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/ONE short line/);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/do not read it out/i);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/until the user tells you to go ahead/i);
  });

  // listen-only-mode: "In every other case — nothing prepared was found, or
  // nothing was heard at all — Iris SHALL say nothing until the user next
  // addresses her." A miss is silent HERE even though a miss the user asked for
  // is reported, and the note says which of the two this is so the two rules
  // cannot collide in the model's reading.
  it("stays completely silent on a miss, and defers the two costly routes", () => {
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/say nothing at all in response to this message/i);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/not even that nothing was prepared/i);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/only then, if they ask/i);
  });
});
