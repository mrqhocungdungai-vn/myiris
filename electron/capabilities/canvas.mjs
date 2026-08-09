// The canvas capability (canvas-claude-mcp): the drawing panel's scene
// store, the local MCP server that exposes it to Claude, and this
// capability's slice of Gemini prose / IPC / teardown — gathered here per
// design.md D10 rather than spread across the layered core modules.
// Electron-free: `dialog` is received as an injected dependency (one of the
// four modules permitted to import Electron directly hands it in), same
// pattern as any other Electron capability reaching a domain module.
import crypto from "node:crypto";
import fs from "node:fs";
import { createCanvasStore, reconcileSceneElements } from "../canvas-store.mjs";
import { createCanvasMcp, buildMcpServerRecord } from "../canvas-mcp.mjs";

// canvas-claude-mcp: main→renderer image-export request/response. Keyed by a
// correlation id since preload has no invoke-based main→renderer req/resp
// primitive (design.md D3) — a plain `on`+`send` pair, with a pending-promise
// registry here and a generous cleanup timer so a request that never gets a
// reply (panel unmounted mid-flight) can't leak the map entry. canvas-mcp.mjs
// itself owns the hard timeout the get_canvas tool actually blocks on
// (DEFAULT_IMAGE_TIMEOUT_MS) — this cleanup timer is just a longer backstop.
// canvas-claude-mcp design.md D3 / this change's "A degraded read says so":
// the image budget belongs to the *caller* — canvas-mcp's get_canvas declares
// how long it is prepared to block — and this side only adds a small grace so
// a reply that arrives just after the tool gave up still clears its map entry.
// The old fixed 8 s backstop meant a slow export always lost the race and then
// kept a dead promise alive for another 4 s.
const CANVAS_IMAGE_DEFAULT_BUDGET_MS = 4000;
const CANVAS_IMAGE_GRACE_MS = 500;

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

  // Resolves { image, reason }: never a bare null, because "no image" has to
  // be explainable to Claude (panel closed vs. export too slow) rather than
  // degrading silently into JSON-only.
  function requestCanvasImage({ timeoutMs = CANVAS_IMAGE_DEFAULT_BUDGET_MS } = {}) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return Promise.resolve({ image: null, reason: "panel-closed" });
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      pendingCanvasImageRequests.set(id, resolve);
      emitToRenderer("canvas:request-image", { id });
      const timer = setTimeout(() => {
        if (pendingCanvasImageRequests.delete(id)) resolve({ image: null, reason: "export-timeout" });
      }, timeoutMs + CANVAS_IMAGE_GRACE_MS);
      timer.unref?.();
    });
  }

  // One Iris-hosted local MCP server exposing the drawing canvas to Claude
  // (design.md of canvas-claude-mcp) — gated on pipelineAvailable AND
  // canvasEngaged below, never started for a session that never opens the
  // drawing panel.
  const canvasMcp = createCanvasMcp({
    getScene: () => canvasStore.getScene(),
    setScene: (scene, meta) => canvasStore.setScene(scene, meta),
    flush: () => canvasStore.flush(),
    // The apply carries the revision it produced and the ids it touched, so
    // the renderer can reconcile per element and push back from a base the
    // main cache recognises instead of from a revision it never saw.
    broadcastApply: (elements, meta) =>
      emitToRenderer("canvas:apply", {
        elements,
        revision: meta?.revision ?? null,
        changedIds: meta?.changedIds ?? [],
      }),
    requestImage: (options) => requestCanvasImage(options),
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
    // Gated on pipelineAvailable, same as the rest of the pipeline-only prose
    // in gemini-prompts.mjs — the verb this points at is only declared then.
    //
    // The workaround that used to live here is gone. It read: call the general
    // task tool "with no 'agent' parameter (never DEV, which would be refused
    // for lacking an open OpenSpec change)" — a drawing feature carrying an
    // instruction about a pipeline gate it has nothing to do with, because
    // there was no way to reach Claude except through one tool that meant
    // seven things. `shape_on_canvas` is that way, so this fragment now says
    // only what a schema cannot: that Iris cannot see the canvas.
    if (!getPipelineAvailable()) return "";
    return `CANVAS — ${userDisplayName()} has a drawing canvas/whiteboard in the app that YOU cannot see. When they ask something like "what should I add to my diagram", "what do you think of my drawing", "connect these two boxes", or anything else about the canvas/diagram/whiteboard, call shape_on_canvas — it CAN read and draw on it, and it continues whatever was already being discussed. Never guess at what is drawn yourself.`;
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
        resolve({ image: payload?.image ?? null, reason: payload?.image ? null : "export-failed" });
      },
    },
    // Scene-access seam (design.md D5): the in-memory cache updates
    // immediately on every push so `canvas:get-scene` is never behind the
    // debounced disk write; that debounced write is the only async part.
    // It is a `handle`, not an `on`, because the push is now half of an
    // exchange: the renderer has to learn the revision its push produced to
    // use as the base of the next one.
    {
      channel: "canvas:scene",
      kind: "handle",
      fn: (_event, payload) => {
        // Accept both the wrapped seam payload and a bare scene, so a push in
        // flight across a reload is not dropped on the floor.
        const scene =
          payload && typeof payload === "object" && payload.scene && typeof payload.scene === "object"
            ? payload.scene
            : payload && typeof payload === "object" && Array.isArray(payload.elements)
              ? payload
              : null;
        if (!scene) return { revision: canvasStore.getRevision(), persisted: false, reason: "invalid-payload" };

        const baseRevision =
          typeof payload?.baseRevision === "number" && Number.isFinite(payload.baseRevision)
            ? payload.baseRevision
            : null;
        const current = canvasStore.getRevision();
        // Stale (or unattributed) push: reconcile per element rather than
        // letting it replace a write it never saw. A push at the current
        // revision is the fast path and replaces as before.
        const stale = baseRevision === null ? current > 0 : baseRevision < current;
        const next = stale
          ? reconcileSceneElements(canvasStore.getScene(), scene, canvasStore.changedIdsSince(baseRevision))
          : scene;
        const outcome = canvasStore.setScene(next);
        if (!outcome.persisted) {
          emitEvent({
            type: "log",
            level: "warn",
            message: `[canvas] scene not persisted (${outcome.reason}) at revision ${outcome.revision}`,
          });
        }
        return { revision: outcome.revision, persisted: outcome.persisted, reason: outcome.reason };
      },
    },
    // The revision rides inside the scene object (`irisRevision`) rather than
    // wrapping it, so the renderer can keep handing the result straight to
    // excalidraw's restore after stripping the one field.
    {
      channel: "canvas:get-scene",
      kind: "handle",
      fn: () => {
        const { scene, revision } = canvasStore.getSceneWithRevision();
        if (!scene || typeof scene !== "object") return scene ?? null;
        return { ...scene, irisRevision: revision };
      },
    },
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
    // No declaration of its own: `shape_on_canvas` is a verb in the registry,
    // and the registry is the single place a verb is defined — a capability
    // adding a parallel declaration for the same work is exactly the
    // duplication the registry exists to prevent. The canvas tool server is
    // likewise wired from that verb's `mcpServers`, not from a per-run special
    // case. `get_canvas` remains a Claude-facing MCP tool, never a Gemini one.
    toolDeclarations: [],
    ensureCanvasMcpForRun,
    maybeStartCanvasMcp,
    promptFragment,
    ipcHandlers,
    teardown,
  };
}
