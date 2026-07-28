// The canvas capability (canvas-claude-mcp): the drawing panel's scene
// store, the local MCP server that exposes it to Claude, and this
// capability's slice of Gemini prose / IPC / teardown — gathered here per
// design.md D10 rather than spread across the layered core modules.
// Electron-free: `dialog` is received as an injected dependency (one of the
// four modules permitted to import Electron directly hands it in), same
// pattern as any other Electron capability reaching a domain module.
import crypto from "node:crypto";
import fs from "node:fs";
import { createCanvasStore } from "../canvas-store.mjs";
import { createCanvasMcp, buildMcpServerRecord } from "../canvas-mcp.mjs";

// canvas-claude-mcp: main→renderer image-export request/response. Keyed by a
// correlation id since preload has no invoke-based main→renderer req/resp
// primitive (design.md D3) — a plain `on`+`send` pair, with a pending-promise
// registry here and a generous cleanup timer so a request that never gets a
// reply (panel unmounted mid-flight) can't leak the map entry. canvas-mcp.mjs
// itself owns the hard timeout the get_canvas tool actually blocks on
// (DEFAULT_IMAGE_TIMEOUT_MS) — this cleanup timer is just a longer backstop.
const CANVAS_IMAGE_CLEANUP_MS = 8000;

/**
 * @param {{
 *   canvasStoreFile: string,
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   emitEvent: (event: any) => void,
 *   getMainWindow: () => any,
 *   getPipelineAvailable: () => boolean,
 *   userDisplayName: () => string,
 *   dialog: { showOpenDialog: Function, showSaveDialog: Function },
 * }} deps
 */
export function createCanvasCapability({
  canvasStoreFile,
  emitToRenderer,
  emitEvent,
  getMainWindow,
  getPipelineAvailable,
  userDisplayName,
  dialog,
}) {
  // Drawing panel scene seam (hud-drawing-canvas design.md D5): the renderer
  // pushes the serialized excalidraw scene here; canvas-claude-mcp reads from
  // the same cache.
  const canvasStore = createCanvasStore({ file: canvasStoreFile });

  const pendingCanvasImageRequests = new Map(); // id -> resolve

  function requestCanvasImage() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return Promise.resolve(null);
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      pendingCanvasImageRequests.set(id, resolve);
      emitToRenderer("canvas:request-image", { id });
      const timer = setTimeout(() => {
        if (pendingCanvasImageRequests.delete(id)) resolve(null);
      }, CANVAS_IMAGE_CLEANUP_MS);
      timer.unref?.();
    });
  }

  // One Iris-hosted local MCP server exposing the drawing canvas to Claude
  // (design.md of canvas-claude-mcp) — gated on pipelineAvailable AND
  // canvasEngaged below, never started for a session that never opens the
  // drawing panel.
  const canvasMcp = createCanvasMcp({
    getScene: () => canvasStore.getScene(),
    setScene: (scene) => canvasStore.setScene(scene),
    flush: () => canvasStore.flush(),
    broadcastApply: (elements) => emitToRenderer("canvas:apply", { elements }),
    requestImage: () => requestCanvasImage(),
    log: (event, detail) => {
      emitEvent({ type: "log", level: "info", message: `[canvas-mcp] ${event} ${JSON.stringify(detail || {})}` });
    },
  });

  // Sticky per-session flag (design.md D6): set true the first time the
  // drawing panel reports it was opened; never reset except by an app
  // restart. Combined with pipelineAvailable, this is the sole gate on
  // whether the canvas MCP is ever wired — a pure-voice session that never
  // opens the canvas starts nothing.
  let canvasEngaged = false;

  function markCanvasEngaged() {
    canvasEngaged = true;
  }

  // Idempotent no-op unless BOTH gates hold; safe to call from any signal that
  // might have just flipped one of them (probePipelineAvailability, and the
  // drawing panel's first canvas:activate).
  function maybeStartCanvasMcp() {
    if (!getPipelineAvailable() || !canvasEngaged) return;
    canvasMcp.start().catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Canvas MCP server failed to start: ${error.message}` });
    });
  }

  // Awaited by both run paths right before wiring a Claude run — ensures the
  // server is up (starting it if this is the very first turn where both
  // gates already held) and returns the Iris-scoped McpHttpServerConfig
  // record, or null when the canvas MCP does not apply to this run.
  async function ensureCanvasMcpForRun() {
    if (!getPipelineAvailable() || !canvasEngaged) return null;
    try {
      await canvasMcp.start();
    } catch (error) {
      emitEvent({ type: "log", level: "warn", message: `Canvas MCP unavailable for this run: ${error.message}` });
      return null;
    }
    return buildMcpServerRecord(canvasMcp.getInfo());
  }

  function promptFragment() {
    // Mirrors the pre-split behavior: this text tells Gemini to call
    // submit_claude_task, a tool that only exists when the pipeline is
    // available — omit it entirely otherwise, same gating as the rest of
    // the pipeline-only prose in gemini-prompts.mjs.
    if (!getPipelineAvailable()) return "";
    return `CANVAS — ${userDisplayName()} has a drawing canvas/whiteboard in the app that YOU cannot see. When they ask something like "what should I add to my diagram", "what do you think of my drawing", "connect these two boxes", or anything else about the canvas/diagram/whiteboard, that is real work for Claude (which CAN read and draw on it) — call submit_claude_task with no 'agent' parameter (never DEV, which would be refused for lacking an open OpenSpec change) describing exactly what they asked. Never guess at what is drawn yourself.`;
  }

  /** @type {Array<{ channel: string, kind: "handle"|"on", fn: Function }>} */
  const ipcHandlers = [
    // Drawing panel activation (hud-drawing-canvas design.md D4): the HUD
    // window is transparent/frameless/always-on-top, which on macOS commonly
    // does not receive key events without an explicit focus() — needed for
    // excalidraw's text tool, Delete, and tool shortcuts.
    {
      channel: "canvas:activate",
      kind: "on",
      fn: () => {
        getMainWindow()?.focus();
        // First-open signal for canvas-claude-mcp's sticky canvasEngaged gate
        // (design.md D6) — a no-op on every subsequent open/close of the panel.
        markCanvasEngaged();
        maybeStartCanvasMcp();
      },
    },
    // Reply half of the main→renderer image-export request (design.md D3);
    // resolves the pending promise requestCanvasImage() created, if it hasn't
    // already been cleaned up by its own timeout.
    {
      channel: "canvas:image-result",
      kind: "on",
      fn: (_event, payload) => {
        const resolve = pendingCanvasImageRequests.get(payload?.id);
        if (!resolve) return;
        pendingCanvasImageRequests.delete(payload.id);
        resolve(payload?.image ?? null);
      },
    },
    // Scene-access seam (design.md D5): the in-memory cache updates
    // immediately on every push so `canvas:get-scene` is never behind the
    // debounced disk write; that debounced write is the only async part.
    {
      channel: "canvas:scene",
      kind: "on",
      fn: (_event, scene) => {
        if (scene && typeof scene === "object") canvasStore.setScene(scene);
      },
    },
    { channel: "canvas:get-scene", kind: "handle", fn: () => canvasStore.getScene() },
    // Native file-dialog fallback (design.md D5a) for when the renderer's File
    // System Access path is unavailable under file:// — feeds excalidraw's
    // own loadFromBlob / serializeAsJSON / exportToBlob on the renderer side.
    {
      channel: "canvas:native-open-file",
      kind: "handle",
      fn: async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
          title: "Open drawing",
          filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
          properties: ["openFile"],
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        const content = fs.readFileSync(result.filePaths[0], "utf8");
        return { canceled: false, content };
      },
    },
    {
      channel: "canvas:native-save-file",
      kind: "handle",
      fn: async (_event, payload) => {
        const result = await dialog.showSaveDialog(getMainWindow(), {
          title: "Save drawing",
          defaultPath: payload?.suggestedName || "drawing.excalidraw",
          filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        fs.writeFileSync(result.filePath, String(payload?.content ?? ""), "utf8");
        return { canceled: false, filePath: result.filePath };
      },
    },
    {
      channel: "canvas:native-export-image",
      kind: "handle",
      fn: async (_event, payload) => {
        const format = payload?.format === "svg" ? "svg" : "png";
        const result = await dialog.showSaveDialog(getMainWindow(), {
          title: "Export image",
          defaultPath: payload?.suggestedName || `drawing.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        // SVG exports as raw markup text; PNG as a base64 payload (no data: URL prefix).
        if (format === "svg") fs.writeFileSync(result.filePath, String(payload?.data ?? ""), "utf8");
        else fs.writeFileSync(result.filePath, String(payload?.data ?? ""), "base64");
        return { canceled: false, filePath: result.filePath };
      },
    },
  ];

  async function teardown() {
    // A quit-while-drawing shouldn't lose recent strokes (hud-drawing-canvas
    // design.md D5 "Flush").
    await canvasStore.flush().catch(() => {});
    // Stop the canvas MCP listener (canvas-claude-mcp design.md D6) — a no-op
    // if it was never started this session.
    await canvasMcp.stop().catch(() => {});
  }

  return {
    // No Gemini function declarations — get_canvas is a Claude-facing tool
    // exposed by the local MCP server (canvas-mcp.mjs), not a Gemini Live
    // tool. Declared explicitly (rather than omitted) so this capability
    // object shares at least one property with every other core module's
    // `{ toolDeclarations?: any[] }` composition target.
    toolDeclarations: [],
    ensureCanvasMcpForRun,
    maybeStartCanvasMcp,
    promptFragment,
    ipcHandlers,
    teardown,
  };
}
