import { describe, it, expect, vi } from "vitest";

vi.mock("./run-exec.mjs", () => ({
  createRunExec: vi.fn((deps) => ({
    killChild: vi.fn(),
    startClaudeRun: vi.fn(),
    __deps: deps,
  })),
}));

vi.mock("./gemini-tools.mjs", () => ({
  createGeminiTools: vi.fn((deps) => ({ buildLiveTools: vi.fn(() => []), __deps: deps })),
}));

vi.mock("./gemini-prompts.mjs", () => ({
  createGeminiPrompts: vi.fn((deps) => ({ buildSystemInstructionText: vi.fn(() => ""), __deps: deps })),
}));

vi.mock("./capabilities/canvas.mjs", () => ({
  createCanvasCapability: vi.fn(() => ({
    toolDeclarations: [],
    ensureCanvasMcpForRun: vi.fn(),
    maybeStartCanvasMcp: vi.fn(),
    promptFragment: vi.fn(() => ""),
    ipcHandlers: [],
    teardown: vi.fn(),
  })),
}));

vi.mock("./capabilities/second-brain.mjs", () => ({
  createSecondBrainCapability: vi.fn(() => ({
    toolDeclarations: [],
    notesVaultDir: "/fake/vault",
    checkNotesSkillsStatus: vi.fn(() => ({ ok: true })),
    ensureNotesVaultReady: vi.fn(),
    probeSecondBrainAvailability: vi.fn(() => false),
    stopVaultGraphWatch: vi.fn(),
    promptFragment: vi.fn(() => ""),
    ipcHandlers: [],
    teardown: vi.fn(),
  })),
}));

import { createRunExec as createRunExecReal } from "./run-exec.mjs";
import { createGeminiTools as createGeminiToolsReal } from "./gemini-tools.mjs";
import { createGeminiPrompts as createGeminiPromptsReal } from "./gemini-prompts.mjs";
import { createCanvasCapability as createCanvasCapabilityReal } from "./capabilities/canvas.mjs";
import { createSecondBrainCapability as createSecondBrainCapabilityReal } from "./capabilities/second-brain.mjs";
import { createCapabilitiesWiring } from "./wiring-capabilities.mjs";

// Cast to the vi.fn() mock shape — the real modules' JSDoc types don't
// carry `.mock`, but vi.mock() above replaces them with mocks at runtime.
/** @type {any} */
const createRunExec = createRunExecReal;
/** @type {any} */
const createGeminiTools = createGeminiToolsReal;
/** @type {any} */
const createGeminiPrompts = createGeminiPromptsReal;
/** @type {any} */
const createCanvasCapability = createCanvasCapabilityReal;
/** @type {any} */
const createSecondBrainCapability = createSecondBrainCapabilityReal;

function makeDeps(overrides = {}) {
  return {
    canvasStoreFile: "/fake/canvas.json",
    emitToRenderer: vi.fn(),
    emitEvent: vi.fn(),
    getMainWindow: vi.fn(() => null),
    getPipelineAvailable: vi.fn(() => true),
    userDisplayName: vi.fn(() => "Alex"),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    irisPluginDir: vi.fn(() => "/fake/iris-plugin"),
    runQueue: {},
    findWorkstream: vi.fn(),
    persistSessionStore: vi.fn(),
    sessionKeyFor: vi.fn(),
    resolveVerbModel: vi.fn(),
    agentPrefix: "iris-",
    claudeWorkdir: vi.fn(),
    claudeBinary: vi.fn(),
    resolveAgentDefinition: vi.fn(),
    irisPluginConfig: vi.fn(() => null),
    ensureProjectScaffold: vi.fn(),
    openChangesWithTasks: vi.fn(),
    handleClaudeStreamMessage: vi.fn(),
    pushActivity: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    recentUtterances: vi.fn(() => []),
    modelChoices: [{ id: "claude-opus-5", label: "Opus 5" }],
    envFlag: vi.fn(() => false),
    workspaceContextLine: vi.fn(() => ""),
    fenceUntrustedText: vi.fn((text) => text),
    ...overrides,
  };
}

describe("wiring-capabilities: createCapabilitiesWiring", () => {
  it("constructs both capabilities, run-exec, and the Gemini modules without throwing", () => {
    expect(() => createCapabilitiesWiring(makeDeps())).not.toThrow();
  });

  it("returns both capabilities in the capabilities array, in canvas-then-second-brain order", () => {
    const result = createCapabilitiesWiring(makeDeps());
    expect(result.capabilities).toHaveLength(2);
    expect(result.capabilities[0]).toBe(result.canvasCapability);
    expect(result.capabilities[1]).toBe(result.secondBrainCapability);
  });

  it("passes both capabilities into geminiTools and geminiPrompts for composition", () => {
    const result = createCapabilitiesWiring(makeDeps());
    expect(createGeminiTools).toHaveBeenCalledWith(expect.objectContaining({ capabilities: result.capabilities }));
    expect(createGeminiPrompts).toHaveBeenCalledWith(expect.objectContaining({ capabilities: result.capabilities }));
  });

  it("wires run-exec's canvas/notes-vault gates to the constructed capabilities, not the raw deps", async () => {
    createCapabilitiesWiring(makeDeps());
    const runExecDeps = createRunExec.mock.calls.at(-1)[0];
    const canvasInstance = createCanvasCapability.mock.results.at(-1).value;
    const secondBrainInstance = createSecondBrainCapability.mock.results.at(-1).value;

    await runExecDeps.ensureCanvasMcpForRun();
    expect(canvasInstance.ensureCanvasMcpForRun).toHaveBeenCalled();

    runExecDeps.checkNotesSkillsStatus();
    expect(secondBrainInstance.checkNotesSkillsStatus).toHaveBeenCalled();

    expect(runExecDeps.notesVaultDir).toBe("/fake/vault");
  });

  it("returns run-exec's startClaudeRun directly", () => {
    const result = createCapabilitiesWiring(makeDeps());
    const runExecInstance = createRunExec.mock.results.at(-1).value;
    expect(result.startClaudeRun).toBe(runExecInstance.startClaudeRun);
  });
});
