// The test the last three bugs got past, and the reason they did.
//
// `wiring-capabilities.test.mjs` mocks BOTH `run-exec` and the canvas
// capability, so it can only ever assert that things were CONSTRUCTED and
// CALLED. Every one of those bugs was a call that happened and an effect that
// did not: a warm that looked its workstream up with an accessor matching
// nothing, prose routed to a parser the resident path does not use, a lane
// chosen by the wrong predicate. Each had a green test sitting exactly where
// it could not see.
//
// So this file mocks only the process boundaries — the Agent SDK session and
// the MCP listener — and builds the real wiring on top of them. It asks what
// the user would ask: I opened the canvas; did anything actually happen?
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("./po-session.mjs", () => ({
  poBillingStatus: () => ({ ok: true, mode: "subscription" }),
  getOrCreatePoSession: vi.fn(() => ({ currentModel: "claude-opus-5", currentMcp: true, ended: false })),
  getPoSessionState: vi.fn(() => null),
  hasUsedPoSession: vi.fn(() => false),
  deliverPoTurn: vi.fn(() => new Promise(() => {})),
  cancelPoTurn: vi.fn(),
  setPoSessionModel: vi.fn(async () => {}),
  setPoSessionMcpServers: vi.fn(async () => {}),
  DEFAULT_PO_QUESTION_TIMEOUT_MS: 300000,
}));

vi.mock("./canvas-mcp.mjs", () => ({
  createCanvasMcp: vi.fn(() => ({
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getInfo: vi.fn(() => ({ url: "http://127.0.0.1:1/mcp", token: "tok" })),
  })),
  buildMcpServerRecord: vi.fn((info) => ({ type: "http", url: info.url, headers: {}, alwaysLoad: true })),
}));

/** @type {any} */
const poSession = await import("./po-session.mjs");
const { createCapabilitiesWiring } = await import("./wiring-capabilities.mjs");

let dirs = [];
function tempCanvasFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wiring-effects-"));
  dirs.push(dir);
  return path.join(dir, "canvas.json");
}

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function buildWiring(overrides = {}) {
  const workstream = { id: "ws1", cwd: os.tmpdir(), agent_sessions: {}, label: "Project" };
  const notifyIris = vi.fn();
  const wiring = createCapabilitiesWiring({
    canvasStoreFile: tempCanvasFile(),
    emitToRenderer: vi.fn(),
    emitEvent: vi.fn(),
    notifyIris,
    getMainWindow: vi.fn(() => null),
    getPipelineAvailable: vi.fn(() => true),
    userDisplayName: vi.fn(() => "Alex"),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    irisPluginDir: vi.fn(() => "/fake/iris-plugin"),
    runQueue: { list: vi.fn(() => []), finalize: vi.fn() },
    // A lookup BY ID answers null when given no id, exactly as the real one
    // does — which is what makes this test able to tell the two accessors
    // apart. A fake that answers the same for both hides the bug where a warm
    // reaches for the wrong one, and that is precisely the bug that shipped.
    findWorkstream: vi.fn((id) => (id === workstream.id ? workstream : null)),
    activeWorkstream: vi.fn(() => workstream),
    persistSessionStore: vi.fn(),
    sessionKeyFor: vi.fn(() => "stateful"),
    resolveVerbModel: vi.fn(() => "claude-opus-5"),
    agentPrefix: "iris-",
    claudeWorkdir: vi.fn(() => os.tmpdir()),
    claudeBinary: vi.fn(() => "/bundled/claude"),
    resolveAgentDefinition: vi.fn(() => ({ description: "d", prompt: "p" })),
    irisPluginConfig: vi.fn(() => []),
    ensureProjectScaffold: vi.fn(() => ({ created: [] })),
    openChangesWithTasks: vi.fn(() => []),
    handleClaudeStreamMessage: vi.fn(),
    pushActivity: vi.fn(),
    speakWorkingText: vi.fn(),
    rememberClaudeSessionId: vi.fn(),
    pushToolStart: vi.fn(),
    pushToolEnd: vi.fn(),
    askUserQuestionViaVoice: vi.fn(),
    getLiveStatus: vi.fn(() => ({ running: true })),
    recentUtterances: vi.fn(() => []),
    modelChoices: [{ id: "claude-opus-5", label: "Opus 5" }],
    envFlag: vi.fn(() => false),
    workspaceContextLine: vi.fn(() => ""),
    ...overrides,
  });
  const activate = wiring.canvasCapability.ipcHandlers.find((h) => h.channel === "canvas:activate");
  return { wiring, notifyIris, activate, workstream };
}

describe("opening the canvas, through the real wiring", () => {
  beforeEach(() => {
    poSession.getOrCreatePoSession.mockClear();
    poSession.getPoSessionState.mockReturnValue(null);
  });

  it("opens a Claude session — the effect, not the call", async () => {
    // This is the assertion that was missing. The old test proved
    // `warmConversation` was invoked; the function it stood for returned
    // "no-workstream" every time and opened nothing.
    const { activate, workstream } = buildWiring();

    activate.fn();
    await vi.waitFor(() => expect(poSession.getOrCreatePoSession).toHaveBeenCalledTimes(1));

    const [passedWorkstream, options] = poSession.getOrCreatePoSession.mock.calls[0];
    expect(passedWorkstream).toBe(workstream);
    expect(options.warm).toBe(true);
  });

  it("tells the user they are in canvas mode", async () => {
    const { activate, notifyIris } = buildWiring();

    activate.fn();

    expect(notifyIris).toHaveBeenCalled();
    expect(notifyIris.mock.calls[0][0].join("\n")).toContain("SYSTEM_EVENT_CANVAS_MODE_OPEN");
  });

  it("does neither when there is no pipeline", async () => {
    const { activate, notifyIris } = buildWiring({ getPipelineAvailable: vi.fn(() => false) });

    activate.fn();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(poSession.getOrCreatePoSession).not.toHaveBeenCalled();
    expect(notifyIris).not.toHaveBeenCalled();
  });

  it("gives Iris her conduit instructions once the canvas is open", () => {
    const { wiring, activate } = buildWiring();

    expect(wiring.canvasCapability.promptFragment()).not.toContain("CANVAS MODE IS OPEN");
    activate.fn();
    expect(wiring.canvasCapability.promptFragment()).toContain("CANVAS MODE IS OPEN");
  });
});

// The common startup order, and the hole it used to fall through: the user
// opens the board while the Claude probe is still running, so the warm is
// skipped for want of a pipeline. The probe finishes moments later and brings
// the MCP up — and nothing ever went back for the conversation, so the first
// sentence paid the whole cost the warm exists to remove.
describe("the canvas opened before Claude was reachable", () => {
  beforeEach(() => {
    poSession.getOrCreatePoSession.mockClear();
    poSession.getPoSessionState.mockReturnValue(null);
  });

  it("warms when the pipeline arrives later", async () => {
    let available = false;
    const { wiring, activate } = buildWiring({ getPipelineAvailable: vi.fn(() => available) });

    activate.fn();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(poSession.getOrCreatePoSession).not.toHaveBeenCalled();

    // Claude becomes reachable; this is the signal the pipeline probe sends.
    available = true;
    wiring.canvasCapability.maybeStartCanvasMcp();
    await vi.waitFor(() => expect(poSession.getOrCreatePoSession).toHaveBeenCalledTimes(1));

    expect(poSession.getOrCreatePoSession.mock.calls[0][1].warm).toBe(true);
  });

  it("does not warm a second time when one is already open", async () => {
    const { wiring, activate } = buildWiring();

    activate.fn();
    await vi.waitFor(() => expect(poSession.getOrCreatePoSession).toHaveBeenCalledTimes(1));

    // A later probe tick must not open a second conversation, which would be a
    // handoff closing the one it means to have ready.
    poSession.getPoSessionState.mockReturnValue({ ended: false });
    wiring.canvasCapability.maybeStartCanvasMcp();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(poSession.getOrCreatePoSession).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all while the canvas has never been opened", async () => {
    const { wiring } = buildWiring();

    wiring.canvasCapability.maybeStartCanvasMcp();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(poSession.getOrCreatePoSession).not.toHaveBeenCalled();
  });
});
