import { describe, it, expect } from "vitest";
import {
  createGeminiPrompts,
  LISTEN_ONLY_ENGAGE_REQUEST,
  LISTEN_ONLY_DISENGAGE_REQUEST,
  meetingRecordNote,
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
    expect(LISTEN_ONLY_ENGAGE_REQUEST).toMatch(/keep listening/i);
  });

  it("releases the model without volunteering a reply or a summary on the way out", () => {
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toContain("SYSTEM_EVENT_LISTEN_ONLY_DISENGAGED");
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/do not say anything in response/i);
    expect(LISTEN_ONLY_DISENGAGE_REQUEST).toMatch(/do not summarize/i);
  });
});

describe("gemini-prompts: the meeting-record note", () => {
  const record = {
    relativePath: "inbox/meetings/meeting-2026-08-07T10-03-00.md",
    startedAt: new Date(Date.UTC(2026, 7, 7, 3, 3, 0)),
    endedAt: new Date(Date.UTC(2026, 7, 7, 3, 23, 0)),
  };

  it("names the exact record and its span, so a verb reads the right one", () => {
    const note = meetingRecordNote(record);
    expect(note).toContain("inbox/meetings/meeting-2026-08-07T10-03-00.md");
    expect(note).toContain("2026-08-07T03:03:00.000Z");
    expect(note).toContain("2026-08-07T03:23:00.000Z");
    expect(note).toMatch(/hand a Claude verb that exact path/i);
  });

  it("carries the untrusted warning with the path, not separately from it", () => {
    // The record is the highest-risk content in the vault — it is a verbatim
    // capture of a room and of whatever the machine played, and one of those
    // recordings verifiably contained an instruction addressed to an agent.
    const note = meetingRecordNote(record);
    expect(note).toMatch(/UNTRUSTED/);
    expect(note).toMatch(/never a request from the user/i);
  });

  it("asks for no reply, since it is sent mid-conversation", () => {
    expect(meetingRecordNote(record)).toMatch(/say nothing in response/i);
  });
});
