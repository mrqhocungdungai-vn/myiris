// verb-tool-surface spec: "Prompt text describes the verb surface that
// exists". Prompt prose has no typechecker and no runtime failure when it
// goes stale (announcements.mjs carried three role-era lines through a whole
// verb migration undetected) — this asserts the prohibition directly against
// what the builders can actually send, not by reading source as text.
import { describe, it, expect, vi } from "vitest";
import { createAnnouncements } from "./announcements.mjs";
import { createGeminiPrompts } from "./gemini-prompts.mjs";

function makeAnnouncements() {
  const session = { sendRealtimeInput: vi.fn() };
  const announcements = createAnnouncements({
    getLiveSession: () => session,
    emitEvent: vi.fn(),
    findWorkstream: () => null,
    getActiveWorkstreamId: () => null,
    runStatus: { CANCELLED: "cancelled", LIMITED: "limited" },
  });
  return { announcements, session };
}

function sentTexts(session) {
  return session.sendRealtimeInput.mock.calls.map(([{ text }]) => text);
}

// Every string the app can send to the voice layer, gathered from each
// builder's public surface — the two prompt builders (gemini-prompts,
// announcements) rather than every possible call, per design.md ("Prompt
// prose is the one verb-describing surface with no such binding").
function allPromptStrings() {
  const converseOn = createGeminiPrompts({
    getPipelineAvailable: () => true,
    modelChoices: [{ id: "claude-opus-5", label: "Opus 5" }],
    envFlag: () => false,
    userDisplayName: () => "Alex",
    workspaceContextLine: () => "WORKSPACE_CONTEXT_LINE_STUB",
  }).buildSystemInstructionText();
  const converseOff = createGeminiPrompts({
    getPipelineAvailable: () => false,
    modelChoices: [{ id: "claude-opus-5", label: "Opus 5" }],
    envFlag: () => false,
    userDisplayName: () => "Alex",
    workspaceContextLine: () => "WORKSPACE_CONTEXT_LINE_STUB",
  }).buildSystemInstructionText();

  const { announcements, session } = makeAnnouncements();
  announcements.sendContextSupplement("https://example.com/some-repo");
  announcements.announceClaudeCompletion({
    runId: "r1",
    task: "do thing",
    status: "completed",
    output: "done",
    verb: "execute",
    decisions: [{ question: "Which approach?", options: [{ label: "A" }, { label: "B" }] }],
  });
  announcements.announceClaudeCompletion({
    runId: "r2",
    task: "do other thing",
    status: "completed",
    output: "Decisions needed:\n1. Pick one",
  });
  announcements.announceClaudeCompletion({
    runId: "r3",
    task: "do a third thing",
    status: "completed",
    output: "done",
    decisions: [{ question: "Which approach?", options: [{ label: "A" }] }],
    // verb omitted on purpose: the genuinely-unavailable case (task 2.4).
  });

  return [converseOn, converseOff, ...sentTexts(session)];
}

describe("verb-tool-surface: prompt text describes what exists", () => {
  it("no prompt or announcement string instructs the model about an agent/role parameter", () => {
    for (const text of allPromptStrings()) {
      expect(text).not.toMatch(/agent field/i);
      expect(text).not.toMatch(/set (the |an? )?(agent|role) (field|parameter)/i);
    }
  });

  it("no prompt or announcement string refers to a currently-active role or worker", () => {
    for (const text of allPromptStrings()) {
      expect(text).not.toMatch(/(role|worker) (is |that('s| is) )?already active/i);
      expect(text).not.toMatch(/same role/i);
    }
  });

  it("a decisions follow-up names the verb that produced them, not an implicit addressee", () => {
    const { announcements, session } = makeAnnouncements();
    announcements.announceClaudeCompletion({
      runId: "r1",
      task: "do thing",
      status: "completed",
      output: "done",
      verb: "shape_requirements",
      decisions: [{ question: "Which approach?", options: [{ label: "A" }] }],
    });
    const [{ text }] = session.sendRealtimeInput.mock.calls[0];
    expect(text).toContain("shape_requirements");
    expect(text).not.toMatch(/same role/i);
  });

  it("the prose 'Decisions needed' fallback also names the verb", () => {
    const { announcements, session } = makeAnnouncements();
    announcements.announceClaudeCompletion({
      runId: "r1",
      task: "do thing",
      status: "completed",
      output: "Decisions needed:\n1. Pick one",
      verb: "finish",
    });
    const [{ text }] = session.sendRealtimeInput.mock.calls[0];
    expect(text).toContain("finish");
  });

  it("says so plainly, rather than falling back to an implicit addressee, when the run's verb is unavailable", () => {
    const { announcements, session } = makeAnnouncements();
    announcements.announceClaudeCompletion({
      runId: "r1",
      task: "do thing",
      status: "completed",
      output: "done",
      decisions: [{ question: "Which approach?", options: [{ label: "A" }] }],
    });
    const [{ text }] = session.sendRealtimeInput.mock.calls[0];
    expect(text).not.toMatch(/same role/i);
    expect(text).toContain("not recorded for this run");
  });
});
