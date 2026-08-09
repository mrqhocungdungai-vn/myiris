import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../canvas-store.mjs", async () => {
  // reconcileSceneElements is pure and covered in canvas-store.test.mjs — the
  // capability's job is to decide *when* to reconcile, so the real function
  // stays wired here and only the store instance is faked.
  const actual = await vi.importActual("../canvas-store.mjs");
  return {
    ...actual,
    createCanvasStore: vi.fn(() => ({
      getScene: vi.fn(() => ({ elements: [] })),
      getRevision: vi.fn(() => 0),
      getSceneWithRevision: vi.fn(() => ({ scene: { elements: [] }, revision: 0 })),
      changedIdsSince: vi.fn(() => []),
      setScene: vi.fn(() => ({ revision: 1, persisted: true, reason: null })),
      flush: vi.fn(() => Promise.resolve({ persisted: true, reason: null })),
    })),
  };
});

vi.mock("../canvas-mcp.mjs", () => ({
  createCanvasMcp: vi.fn(() => ({
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    getInfo: vi.fn(() => ({ url: "http://127.0.0.1:1/mcp", token: "tok" })),
  })),
  buildMcpServerRecord: vi.fn((info) => ({ type: "http", url: info.url, headers: { Authorization: `Bearer ${info.token}` }, alwaysLoad: true })),
}));

import { createCanvasStore as createCanvasStoreReal } from "../canvas-store.mjs";
import { createCanvasMcp as createCanvasMcpReal } from "../canvas-mcp.mjs";
import { createCanvasCapability } from "./canvas.mjs";

// Cast to the vi.fn() mock shape — the real modules' JSDoc types don't
// carry `.mock`, but vi.mock() above replaces them with mocks at runtime.
/** @type {any} */
const createCanvasStore = createCanvasStoreReal;
/** @type {any} */
const createCanvasMcp = createCanvasMcpReal;

function make(overrides = {}) {
  return createCanvasCapability({
    canvasStoreFile: "/fake/canvas.json",
    emitToRenderer: vi.fn(),
    emitEvent: vi.fn(),
    notifyIris: vi.fn(),
    getMainWindow: vi.fn(() => null),
    getPipelineAvailable: vi.fn(() => true),
    userDisplayName: vi.fn(() => "Alex"),
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canvas capability: canvasEngaged gate", () => {
  it("maybeStartCanvasMcp does nothing until canvas:activate marks it engaged", () => {
    const cap = make();
    const mcpInstance = createCanvasMcp.mock.results[0].value;
    cap.maybeStartCanvasMcp();
    expect(mcpInstance.start).not.toHaveBeenCalled();

    const activateHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:activate").fn;
    activateHandler();
    expect(mcpInstance.start).toHaveBeenCalled();
  });

  it("maybeStartCanvasMcp does nothing when the pipeline is unavailable, even once engaged", () => {
    const cap = make({ getPipelineAvailable: vi.fn(() => false) });
    const mcpInstance = createCanvasMcp.mock.results[0].value;
    const activateHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:activate").fn;
    activateHandler();
    expect(mcpInstance.start).not.toHaveBeenCalled();
  });

  it("ensureCanvasMcpForRun returns null when not engaged", async () => {
    const cap = make();
    expect(await cap.ensureCanvasMcpForRun()).toBeNull();
  });

  it("ensureCanvasMcpForRun returns an McpHttpServerConfig record once engaged and available", async () => {
    const cap = make();
    cap.ipcHandlers.find((h) => h.channel === "canvas:activate").fn();
    const record = await cap.ensureCanvasMcpForRun();
    expect(record).toEqual({
      type: "http",
      url: "http://127.0.0.1:1/mcp",
      headers: { Authorization: "Bearer tok" },
      alwaysLoad: true,
    });
  });
});

describe("canvas capability: promptFragment", () => {
  it("is gated on pipeline availability, mirroring the pre-split behavior", () => {
    expect(make({ getPipelineAvailable: () => false }).promptFragment()).toBe("");
    expect(make({ getPipelineAvailable: () => true }).promptFragment()).toContain("CANVAS");
  });

  // The workaround this capability used to carry — "call submit_claude_task with
  // no 'agent' parameter (never DEV, which would be refused for lacking an open
  // OpenSpec change)" — was a drawing feature describing a pipeline gate it has
  // nothing to do with. A capability that must warn the voice layer away from a
  // worker on unrelated grounds is being routed around, not served.
  it("points at the canvas verb and carries no workaround for an unrelated gate", () => {
    const fragment = make().promptFragment();
    expect(fragment).toContain("shape_on_canvas");
    expect(fragment).not.toContain("submit_claude_task");
    expect(fragment).not.toMatch(/\bDEV\b|OpenSpec change/);
  });
});

describe("canvas capability: ipcHandlers", () => {
  it("registers exactly the 7 canvas:* channels with the correct handle/on split", () => {
    const cap = make();
    const byChannel = Object.fromEntries(cap.ipcHandlers.map((h) => [h.channel, h.kind]));
    expect(byChannel).toEqual({
      "canvas:activate": "on",
      "canvas:image-result": "on",
      "canvas:scene": "handle",
      "canvas:get-scene": "handle",
      "canvas:native-open-file": "handle",
      "canvas:native-save-file": "handle",
      "canvas:native-export-image": "handle",
    });
  });

  it("canvas:scene writes a wrapped payload to the store and acks the revision", () => {
    const cap = make();
    const storeInstance = createCanvasStore.mock.results[0].value;
    const sceneHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:scene").fn;
    const ack = sceneHandler(null, { scene: { elements: [] }, baseRevision: 0 });
    expect(storeInstance.setScene).toHaveBeenCalledWith({ elements: [] });
    expect(ack).toEqual({ revision: 1, persisted: true, reason: null });
  });

  it("canvas:scene still accepts a bare scene, and refuses a non-object", () => {
    const cap = make();
    const storeInstance = createCanvasStore.mock.results[0].value;
    const sceneHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:scene").fn;
    sceneHandler(null, { elements: [] });
    expect(storeInstance.setScene).toHaveBeenCalledWith({ elements: [] });
    storeInstance.setScene.mockClear();
    expect(sceneHandler(null, "not-an-object")).toEqual({ revision: 0, persisted: false, reason: "invalid-payload" });
    expect(storeInstance.setScene).not.toHaveBeenCalled();
  });

  it("canvas:scene reconciles a stale push instead of replacing the cache", () => {
    const cap = make();
    const storeInstance = createCanvasStore.mock.results[0].value;
    storeInstance.getRevision.mockReturnValue(7);
    storeInstance.getScene.mockReturnValue({ elements: [{ id: "user" }, { id: "claude" }], files: {} });
    storeInstance.changedIdsSince.mockReturnValue(["claude"]);

    const sceneHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:scene").fn;
    sceneHandler(null, { scene: { elements: [{ id: "user" }], files: {} }, baseRevision: 6 });

    const written = storeInstance.setScene.mock.calls[0][0];
    expect(written.elements.map((e) => e.id)).toEqual(["user", "claude"]);
  });

  it("canvas:scene reports an unpersisted (oversized) push rather than acking success", () => {
    const emitEvent = vi.fn();
    const cap = make({ emitEvent });
    const storeInstance = createCanvasStore.mock.results[0].value;
    storeInstance.setScene.mockReturnValue({ revision: 3, persisted: false, reason: "oversized" });

    const ack = cap.ipcHandlers.find((h) => h.channel === "canvas:scene").fn(null, {
      scene: { elements: [] },
      baseRevision: 0,
    });

    expect(ack).toEqual({ revision: 3, persisted: false, reason: "oversized" });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ level: "warn" }));
  });

  it("canvas:get-scene reads through to the store and stamps the revision on the scene", () => {
    const cap = make();
    const storeInstance = createCanvasStore.mock.results[0].value;
    storeInstance.getSceneWithRevision.mockReturnValue({ scene: { elements: [] }, revision: 4 });
    const getSceneHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:get-scene").fn;
    expect(getSceneHandler()).toEqual({ elements: [], irisRevision: 4 });
  });

  it("canvas:get-scene returns null before anything has ever been cached", () => {
    const cap = make();
    const storeInstance = createCanvasStore.mock.results[0].value;
    storeInstance.getSceneWithRevision.mockReturnValue({ scene: null, revision: 0 });
    expect(cap.ipcHandlers.find((h) => h.channel === "canvas:get-scene").fn()).toBeNull();
  });

  it("canvas:image-result is a safe no-op for an id with no pending resolver", () => {
    // requestCanvasImage (which registers a pending resolver) isn't on the
    // returned interface — it's only reachable via canvas-mcp's
    // requestImage callback, which the mocked createCanvasMcp never
    // invokes — so this covers the "reply arrives late/unmatched" branch
    // directly instead.
    const cap = make();
    const imageResultHandler = cap.ipcHandlers.find((h) => h.channel === "canvas:image-result").fn;
    expect(() => imageResultHandler(null, { id: "unknown-id", image: "data:..." })).not.toThrow();
  });

  it("canvas:native-open-file returns canceled:true when the dialog is canceled", async () => {
    const dialog = { showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })), showSaveDialog: vi.fn() };
    const cap = make({ dialog });
    const handler = cap.ipcHandlers.find((h) => h.channel === "canvas:native-open-file").fn;
    expect(await handler()).toEqual({ canceled: true });
  });
});

describe("canvas capability: teardown", () => {
  it("flushes the store and stops the MCP server, swallowing errors from either", async () => {
    const cap = make();
    const storeInstance = createCanvasStore.mock.results[0].value;
    const mcpInstance = createCanvasMcp.mock.results[0].value;
    storeInstance.flush.mockImplementation(() => Promise.reject(new Error("disk full")));
    mcpInstance.stop.mockImplementation(() => Promise.reject(new Error("already down")));
    await expect(cap.teardown()).resolves.toBeUndefined();
    expect(storeInstance.flush).toHaveBeenCalled();
    expect(mcpInstance.stop).toHaveBeenCalled();
  });
});

// the-canvas-becomes-a-conversation: opening the canvas is a mode the user is
// told they are in, and while it is open Iris carries rather than compresses.
describe("canvas capability: canvas mode is announced, and changes Iris's job", () => {
  it("announces canvas mode when the panel opens", () => {
    const notifyIris = vi.fn();
    const capability = make({ notifyIris });
    const activate = capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate");

    activate.fn();

    expect(notifyIris).toHaveBeenCalledTimes(1);
    const spoken = notifyIris.mock.calls[0][0].join("\n");
    expect(spoken).toContain("SYSTEM_EVENT_CANVAS_MODE_OPEN");
    expect(spoken).toMatch(/canvas mode is open/i);
    // Once per opening — not narrated again on every later turn.
    expect(spoken).toMatch(/ONCE/);
  });

  it("says nothing when there is no pipeline to have a conversation with", () => {
    // Announcing a mode the app cannot actually enter is a promise it cannot keep.
    const notifyIris = vi.fn();
    const capability = make({ notifyIris, getPipelineAvailable: vi.fn(() => false) });

    capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn();

    expect(notifyIris).not.toHaveBeenCalled();
  });

  it("says it once, however many times the panel activates", () => {
    // It used to announce per activation, on the reading that reopening the
    // surface is entering the mode again. A live session settled that: the
    // panel re-activates for reasons that have nothing to do with the user
    // opening it, and Iris announced canvas mode five times in four minutes —
    // twice over her own answer. A greeting repeated mid-conversation is an
    // interruption, and the mode had not ended in between.
    const notifyIris = vi.fn();
    const capability = make({ notifyIris });
    const activate = capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate");

    activate.fn();
    activate.fn();
    activate.fn();

    expect(notifyIris).toHaveBeenCalledTimes(1);
  });

  it("gives Iris her conduit instructions only once the canvas is engaged", () => {
    const capability = make({});

    // Before opening: only the routing prose, which is all that applies.
    const before = capability.promptFragment();
    expect(before).toContain("CANVAS —");
    expect(before).not.toContain("CANVAS MODE IS OPEN");

    capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn();
    const after = capability.promptFragment();

    expect(after).toContain("CANVAS MODE IS OPEN");
    // The three rules that make her a conduit rather than a router.
    expect(after).toMatch(/UNCHANGED/);
    expect(after).toMatch(/READ THE ANSWER OUT IN FULL/);
    expect(after).toMatch(/cannot see the canvas/i);
  });

  it("keeps the prompt empty when the pipeline is unavailable, engaged or not", () => {
    const capability = make({ getPipelineAvailable: vi.fn(() => false) });
    capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn();
    expect(capability.promptFragment()).toBe("");
  });
});

// the-canvas-becomes-a-conversation, task 2: opening the board opens the
// conversation, not just the tools.
describe("canvas capability: opening the board warms the conversation", () => {
  it("warms on activate", () => {
    const warmConversation = vi.fn(async () => ({ warmed: true, reason: null }));
    const capability = make({ warmConversation });

    capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn();

    expect(warmConversation).toHaveBeenCalledTimes(1);
  });

  it("does not warm when there is no pipeline to warm", () => {
    const warmConversation = vi.fn();
    const capability = make({ warmConversation, getPipelineAvailable: vi.fn(() => false) });

    capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn();

    expect(warmConversation).not.toHaveBeenCalled();
  });

  it("does not let a failed warm break opening the panel", () => {
    // A warm is an optimisation the user never asked for by name. If it cannot
    // happen, the panel still opens and the first spoken turn opens the
    // session the way it always did.
    const warmConversation = vi.fn(async () => {
      throw new Error("no credential");
    });
    const capability = make({ warmConversation });

    expect(() => capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn()).not.toThrow();
  });
});

// The board Claude reads has to be the board the user is looking at. The
// renderer batches scene pushes on a debounce, so without this the cache can
// be a window behind — and the case where that bites is the ordinary one:
// drawing a line while saying "and this arrow here", where the stroke being
// asked about is exactly the one still pending.
describe("canvas capability: a run reads the board on screen", () => {
  it("asks the panel to flush before wiring a run", async () => {
    const emitToRenderer = vi.fn();
    const capability = make({ emitToRenderer });
    capability.ipcHandlers.find((handler) => handler.channel === "canvas:activate").fn();
    emitToRenderer.mockClear();

    await capability.ensureCanvasMcpForRun();

    expect(emitToRenderer).toHaveBeenCalledWith("canvas:flush-scene", {});
  });

  it("asks for nothing when the canvas does not apply to this run", async () => {
    // Never engaged: there is no panel holding anything, and a run that does
    // not touch the canvas should not be poking at it.
    const emitToRenderer = vi.fn();
    const capability = make({ emitToRenderer });

    await capability.ensureCanvasMcpForRun();

    expect(emitToRenderer).not.toHaveBeenCalledWith("canvas:flush-scene", {});
  });
});
