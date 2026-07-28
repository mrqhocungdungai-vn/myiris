// The canvas-claude-mcp module: hosts one local MCP server (Streamable HTTP,
// stateless, 127.0.0.1 + ephemeral port + bearer token) exposing read/write
// tools over the drawing canvas to Claude. Mirrors the canvas-store.mjs /
// po-session.mjs seams — dependencies (cache getter/setter/flush, an
// apply-broadcast callback, and an image-request function) are injected so
// the tool logic and the pure element builder below are unit-testable
// without app/ipcMain/BrowserWindow. See
// openspec/changes/canvas-claude-mcp/design.md D1-D8.
import http from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { generateKeyBetween } from "fractional-indexing";

export const DEFAULT_IMAGE_TIMEOUT_MS = 4000;

// The one Iris-scoped McpHttpServerConfig-shaped record both wiring paths
// share (design.md D6/5.1/5.2): the PO Agent SDK session gets it verbatim as
// `options.mcpServers["iris-canvas"]`, and the DEV/plain spawn wraps it in
// `{ mcpServers: { "iris-canvas": ... } }` for --mcp-config. One builder, so
// the two paths can't drift into carrying different fields.
export function buildMcpServerRecord(info) {
  if (!info) return null;
  return { type: "http", url: info.url, headers: { Authorization: `Bearer ${info.token}` }, alwaysLoad: true };
}

// ===== Pure scene / element helpers (no Electron, no MCP) =====

// canvas-store.mjs's getScene() returns null on a fresh machine (design.md
// D8) — every reader/mutator must treat that as an empty scene, never crash.
export function emptyScene() {
  return { type: "excalidraw", version: 2, source: "iris", elements: [], appState: {}, files: {} };
}

export function sceneOrEmpty(scene) {
  return scene && typeof scene === "object" && Array.isArray(scene.elements) ? scene : emptyScene();
}

function randInt32() {
  return Math.floor(Math.random() * 2 ** 31);
}

const STYLE_DEFAULTS = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
};

// Fields common to every excalidraw element type, verified against the real
// convertToExcalidrawElements output (see canvas-mcp.golden.test.mjs) — the
// golden test is what actually guards this against an excalidraw version
// bump, not this comment.
function baseFields(skeleton, index) {
  const now = Date.now();
  return {
    id: skeleton.id || crypto.randomUUID(),
    angle: skeleton.angle ?? 0,
    strokeColor: skeleton.strokeColor ?? STYLE_DEFAULTS.strokeColor,
    backgroundColor: skeleton.backgroundColor ?? STYLE_DEFAULTS.backgroundColor,
    fillStyle: skeleton.fillStyle ?? STYLE_DEFAULTS.fillStyle,
    strokeWidth: skeleton.strokeWidth ?? STYLE_DEFAULTS.strokeWidth,
    strokeStyle: skeleton.strokeStyle ?? STYLE_DEFAULTS.strokeStyle,
    roughness: skeleton.roughness ?? STYLE_DEFAULTS.roughness,
    opacity: skeleton.opacity ?? STYLE_DEFAULTS.opacity,
    groupIds: [],
    frameId: null,
    index,
    roundness: null,
    seed: randInt32(),
    version: 1,
    versionNonce: randInt32(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    customData: null,
  };
}

function buildShapeElement(skeleton, index) {
  return {
    ...baseFields(skeleton, index),
    type: skeleton.type,
    x: Number(skeleton.x) || 0,
    y: Number(skeleton.y) || 0,
    width: Number(skeleton.width) || 100,
    height: Number(skeleton.height) || 100,
  };
}

function buildTextElement(skeleton, index) {
  const text = String(skeleton.text ?? "");
  const fontSize = Number(skeleton.fontSize) || 20;
  return {
    ...baseFields(skeleton, index),
    type: "text",
    x: Number(skeleton.x) || 0,
    y: Number(skeleton.y) || 0,
    width: Number(skeleton.width) || Math.max(20, text.length * fontSize * 0.6),
    height: Number(skeleton.height) || Math.ceil(fontSize * 1.25),
    text,
    originalText: text,
    fontSize,
    fontFamily: skeleton.fontFamily ?? 1,
    textAlign: skeleton.textAlign ?? "left",
    verticalAlign: skeleton.verticalAlign ?? "top",
    containerId: null,
    lineHeight: 1.25,
    autoResize: true,
  };
}

function centerOf(el) {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

// Clips the ray from (cx,cy) towards (tx,ty) to rect's boundary — used to
// anchor an arrow's endpoint at the edge of a bound shape (facing the other
// shape) rather than floating at its center.
function clipToRect(cx, cy, tx, ty, rect) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  let tMin = Infinity;
  if (dx !== 0) {
    for (const t of [(rect.x - cx) / dx, (rect.x + rect.width - cx) / dx]) {
      if (t > 0) tMin = Math.min(tMin, t);
    }
  }
  if (dy !== 0) {
    for (const t of [(rect.y - cy) / dy, (rect.y + rect.height - cy) / dy]) {
      if (t > 0) tMin = Math.min(tMin, t);
    }
  }
  const t = Number.isFinite(tMin) ? Math.min(tMin, 1) : 1;
  return { x: cx + dx * t, y: cy + dy * t };
}

// Builds an arrow/line element. `lookup` is the union of the existing cache
// and the current add batch (design.md D5) so a connector can bind to a
// shape Claude is adding in the same call. Dangling start/end refs push onto
// `danglingRefs` (checked by the caller to decide the per-element result)
// instead of throwing, per the "invalid write is reported" requirement.
function buildLinearElement(skeleton, index, lookup, danglingRefs) {
  const startEl = skeleton.start?.id ? lookup.get(skeleton.start.id) : null;
  const endEl = skeleton.end?.id ? lookup.get(skeleton.end.id) : null;
  if (skeleton.start?.id && !startEl) danglingRefs.push("start");
  if (skeleton.end?.id && !endEl) danglingRefs.push("end");

  const startCenter = startEl ? centerOf(startEl) : null;
  const endCenter = endEl ? centerOf(endEl) : null;

  let startPoint;
  let endPoint;
  let startBinding = null;
  let endBinding = null;

  if (startCenter && endCenter) {
    startPoint = clipToRect(startCenter.x, startCenter.y, endCenter.x, endCenter.y, startEl);
    endPoint = clipToRect(endCenter.x, endCenter.y, startCenter.x, startCenter.y, endEl);
    startBinding = { elementId: startEl.id, focus: 0, gap: 4 };
    endBinding = { elementId: endEl.id, focus: 0, gap: 4 };
  } else if (startCenter) {
    startPoint = startCenter;
    endPoint = Array.isArray(skeleton.points?.[1])
      ? { x: startPoint.x + skeleton.points[1][0], y: startPoint.y + skeleton.points[1][1] }
      : { x: startPoint.x + 100, y: startPoint.y };
    startBinding = { elementId: startEl.id, focus: 0, gap: 4 };
  } else if (endCenter) {
    endPoint = endCenter;
    startPoint =
      skeleton.x != null && skeleton.y != null
        ? { x: Number(skeleton.x), y: Number(skeleton.y) }
        : { x: endPoint.x - 100, y: endPoint.y };
    endBinding = { elementId: endEl.id, focus: 0, gap: 4 };
  } else {
    startPoint = { x: Number(skeleton.x) || 0, y: Number(skeleton.y) || 0 };
    endPoint = Array.isArray(skeleton.points?.[1])
      ? { x: startPoint.x + skeleton.points[1][0], y: startPoint.y + skeleton.points[1][1] }
      : { x: startPoint.x + 100, y: startPoint.y };
  }

  const points = [
    [0, 0],
    [endPoint.x - startPoint.x, endPoint.y - startPoint.y],
  ];

  return {
    ...baseFields(skeleton, index),
    type: skeleton.type,
    x: startPoint.x,
    y: startPoint.y,
    width: Math.abs(points[1][0]) || 1,
    height: Math.abs(points[1][1]) || 1,
    points,
    lastCommittedPoint: null,
    startBinding,
    endBinding,
    startArrowhead: skeleton.startArrowhead ?? null,
    endArrowhead: skeleton.type === "arrow" ? (skeleton.endArrowhead ?? "arrow") : null,
    elbowed: false,
  };
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINEAR_TYPES = new Set(["arrow", "line"]);

// Single entry point used by both applyAddElements and the golden test
// (canvas-mcp.golden.test.mjs) so there is exactly one builder to keep in
// sync with excalidraw's real field set.
export function buildElement(skeleton, { index = "a0", lookup = new Map(), danglingRefs = [] } = {}) {
  if (SHAPE_TYPES.has(skeleton.type)) return buildShapeElement(skeleton, index);
  if (skeleton.type === "text") return buildTextElement(skeleton, index);
  if (LINEAR_TYPES.has(skeleton.type)) return buildLinearElement(skeleton, index, lookup, danglingRefs);
  throw new Error(`Unsupported element type: ${skeleton.type}`);
}

function addBoundElement(elements, idIndex, elementId, boundId, boundType) {
  const i = idIndex.get(elementId);
  if (i === undefined) return;
  const existing = elements[i].boundElements || [];
  elements[i] = { ...elements[i], boundElements: [...existing, { id: boundId, type: boundType }] };
}

// Read-modify-write over the whole scene (design.md D8 — canvas-store has no
// by-id API). Returns the next scene plus a per-element result so a
// turn-based agent can see and correct a dropped id/binding, never a silent
// drop (design.md D5).
export function applyAddElements(scene, skeletons) {
  const s = sceneOrEmpty(scene);
  const elements = s.elements.map((e) => ({ ...e }));
  const idIndex = new Map(elements.map((e, i) => [e.id, i]));
  const lookup = new Map(elements.map((e) => [e.id, e]));
  const results = [];

  const withIds = (skeletons || []).map((sk) => {
    let id = sk.id || crypto.randomUUID();
    if (idIndex.has(id)) id = crypto.randomUUID(); // id collision: reassign rather than silently overwrite/drop
    return { ...sk, id };
  });

  const nonLinear = withIds.filter((sk) => !LINEAR_TYPES.has(sk.type));
  const linear = withIds.filter((sk) => LINEAR_TYPES.has(sk.type));

  let cursorIndex = elements.length ? elements[elements.length - 1].index ?? null : null;
  const added = [];

  for (const sk of nonLinear) {
    cursorIndex = generateKeyBetween(cursorIndex, null);
    const el = buildElement(sk, { index: cursorIndex, lookup });
    lookup.set(el.id, el);
    added.push(el);
    results.push({ id: el.id, status: "applied" });
  }
  for (const sk of linear) {
    cursorIndex = generateKeyBetween(cursorIndex, null);
    const danglingRefs = [];
    const el = buildElement(sk, { index: cursorIndex, lookup, danglingRefs });
    lookup.set(el.id, el);
    added.push(el);
    results.push({ id: el.id, status: danglingRefs.length ? "rebound: dropped-binding" : "applied" });
  }

  const nextElements = elements.concat(added);
  const nextIdIndex = new Map(nextElements.map((e, i) => [e.id, i]));
  for (const el of added) {
    // startBinding/endBinding exist only on the linear-element branch of
    // buildElement's return union; the shape/text branch has neither.
    const linearEl = /** @type {any} */ (el);
    if (linearEl.startBinding) addBoundElement(nextElements, nextIdIndex, linearEl.startBinding.elementId, el.id, el.type);
    if (linearEl.endBinding) addBoundElement(nextElements, nextIdIndex, linearEl.endBinding.elementId, el.id, el.type);
  }

  return { scene: { ...s, elements: nextElements }, results };
}

export function applyUpdateElements(scene, updates) {
  const s = sceneOrEmpty(scene);
  const elements = s.elements.map((e) => ({ ...e }));
  const idIndex = new Map(elements.map((e, i) => [e.id, i]));
  const results = [];

  for (const patch of updates || []) {
    const i = idIndex.get(patch?.id);
    if (i === undefined) {
      results.push({ id: patch?.id, status: "skipped: unknown-id" });
      continue;
    }
    const { id, ...fields } = patch;
    elements[i] = {
      ...elements[i],
      ...fields,
      id,
      version: (elements[i].version ?? 1) + 1,
      versionNonce: randInt32(),
      updated: Date.now(),
    };
    results.push({ id, status: "applied" });
  }
  return { scene: { ...s, elements }, results };
}

export function applyDeleteElements(scene, ids) {
  const s = sceneOrEmpty(scene);
  const idSet = new Set(ids || []);
  const existingIds = new Set(s.elements.map((e) => e.id));
  const elements = s.elements.filter((e) => !idSet.has(e.id));
  const results = (ids || []).map((id) => ({ id, status: existingIds.has(id) ? "applied" : "skipped: unknown-id" }));
  return { scene: { ...s, elements }, results };
}

// ===== MCP tool declarations =====

const ELEMENT_SCHEMA = z
  .object({
    type: z.enum(["rectangle", "ellipse", "diamond", "text", "arrow", "line"]),
    id: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    text: z.string().optional(),
    fontSize: z.number().optional(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    start: z.object({ id: z.string() }).optional(),
    end: z.object({ id: z.string() }).optional(),
    points: z.array(z.tuple([z.number(), z.number()])).optional(),
  })
  .passthrough();

// Hard cap owned by the tool itself, not just whatever the injected
// requestImage does internally — a bug or slow path in the real
// (main.mjs) implementation must never hang get_canvas; it always degrades
// to JSON-only within DEFAULT_IMAGE_TIMEOUT_MS (design.md D3/D8).
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function registerTools(server, deps) {
  const { getScene, setScene, flush, broadcastApply, requestImage, log } = deps;

  server.registerTool(
    "get_canvas",
    {
      description:
        "Read the current drawing canvas: the canonical excalidraw scene (elements, including arrow start/end connectivity, and embedded files). Safe to call whether or not the drawing panel is open. Set includeImage to also get a rendered PNG, when the panel happens to be open (omitted otherwise).",
      inputSchema: { includeImage: z.boolean().optional() },
    },
    async ({ includeImage }) => {
      const scene = sceneOrEmpty(getScene());
      log?.("tool_call", { tool: "get_canvas", elements: scene.elements.length });
      /** @type {Array<{ type: string, text: string } | { type: string, data: string, mimeType: string }>} */
      const content = [{ type: "text", text: JSON.stringify(scene) }];
      if (includeImage) {
        const image = await withTimeout(requestImage({ timeoutMs: DEFAULT_IMAGE_TIMEOUT_MS }), DEFAULT_IMAGE_TIMEOUT_MS);
        if (image) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
      }
      return { content };
    },
  );

  server.registerTool(
    "add_elements",
    {
      description:
        "Add one or more elements (rectangle, ellipse, diamond, text, arrow, line) to the drawing canvas. Arrows/lines may set start/end to { id } to bind to an existing element or one added in this same call, expressing a relationship between shapes. Returns a per-element result: applied, or rebound: dropped-binding if a start/end reference didn't resolve.",
      inputSchema: { elements: z.array(ELEMENT_SCHEMA) },
    },
    async ({ elements }) => {
      const { scene, results } = applyAddElements(getScene(), elements);
      setScene(scene);
      await flush();
      broadcastApply(scene.elements);
      log?.("tool_call", { tool: "add_elements", elements: elements.length });
      return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
    },
  );

  server.registerTool(
    "update_elements",
    {
      description:
        "Update one or more existing canvas elements by id (patch — only the given fields change). Returns skipped: unknown-id for any id not currently on the canvas.",
      inputSchema: { elements: z.array(ELEMENT_SCHEMA.extend({ id: z.string() })) },
    },
    async ({ elements }) => {
      const { scene, results } = applyUpdateElements(getScene(), elements);
      setScene(scene);
      await flush();
      broadcastApply(scene.elements);
      log?.("tool_call", { tool: "update_elements", elements: elements.length });
      return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
    },
  );

  server.registerTool(
    "delete_elements",
    {
      description:
        "Delete one or more canvas elements by id. Returns skipped: unknown-id for any id not currently on the canvas.",
      inputSchema: { ids: z.array(z.string()) },
    },
    async ({ ids }) => {
      const { scene, results } = applyDeleteElements(getScene(), ids);
      setScene(scene);
      await flush();
      broadcastApply(scene.elements);
      log?.("tool_call", { tool: "delete_elements", elements: ids.length });
      return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
    },
  );
}

// ===== Server lifecycle =====

// Creates the (not-yet-started) canvas MCP host. All side-effecting
// dependencies are injected so tool logic stays testable in isolation
// (design.md D8): getScene/setScene mirror canvas-store.mjs's
// getScene/setScene, flush forces a durable persist per write (Claude writes
// carry a higher durability bar than user strokes), broadcastApply is called
// with the full post-write element set after every successful write
// (main wires it to emitToRenderer("canvas:apply", ...), which is naturally
// a no-op with no window and the renderer only listens while the panel is
// mounted), and requestImage resolves { mimeType, data } or null (timeout /
// panel unmounted) for get_canvas's optional image.
/**
 * @param {{
 *   getScene: Function,
 *   setScene: Function,
 *   flush: Function,
 *   broadcastApply: Function,
 *   requestImage: Function,
 *   log?: (event: string, detail?: object) => void,
 *   port?: number,
 * }} options
 */
export function createCanvasMcp({
  getScene,
  setScene,
  flush,
  broadcastApply,
  requestImage,
  log = () => {},
  // Test-only hook: production always binds an ephemeral port (0). Exposed
  // so tests can force a bind conflict deterministically (see
  // canvas-mcp.test.mjs's "bind failure" case) without racing an OS-assigned
  // port number.
  port = 0,
}) {
  let httpServer = null;
  let info = null; // { url, token, port }
  let startPromise = null;

  // The installed SDK's stateless StreamableHTTPServerTransport throws
  // ("Stateless transport cannot be reused across requests") the second time
  // the SAME transport instance handles a request — it must be paired with a
  // fresh McpServer + transport connection PER HTTP REQUEST, not once for the
  // listener's lifetime (verified directly against @modelcontextprotocol/sdk
  // 1.29.0; runQueue's one-Claude-at-a-time guarantee makes this cheap, not
  // a concurrency requirement). The tool logic itself is stateless (all
  // state lives in the injected getScene/setScene), so re-registering tools
  // on a fresh McpServer per request is just bookkeeping, not a real cost.
  function requestListener(req, res) {
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${info.token}`) {
      log("auth_rejected", { path: req.url });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const mcpServer = new McpServer({ name: "iris-canvas", version: "1.0.0" });
    registerTools(mcpServer, { getScene, setScene, flush, broadcastApply, requestImage, log });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const cleanup = () => {
      transport.close().catch(() => {});
      mcpServer.close().catch(() => {});
    };
    res.on("close", cleanup);
    mcpServer
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((error) => {
        log("tool_call_error", { message: error?.message });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      });
  }

  // Idempotent: a second start() while already up (or starting) resolves
  // with the same { url, token }, never opens a second listener.
  function start() {
    if (info) return Promise.resolve(info);
    if (startPromise) return startPromise;

    startPromise = new Promise((resolve, reject) => {
      const token = crypto.randomBytes(24).toString("hex");
      httpServer = http.createServer((req, res) => requestListener(req, res));
      // An unhandled 'error' on a Node http.Server throws and would crash
      // Electron main (design.md D8) — a bind failure must fail start()
      // cleanly instead, leaving no server and the whiteboard unaffected.
      httpServer.once("error", (error) => {
        startPromise = null;
        info = null;
        reject(error);
      });
      httpServer.listen(port, "127.0.0.1", () => {
        const { port } = httpServer.address();
        info = { url: `http://127.0.0.1:${port}/mcp`, token, port };
        log("server_ready", { port });
        resolve(info);
      });
    }).catch((error) => {
      startPromise = null;
      throw error;
    });

    return startPromise;
  }

  async function stop() {
    startPromise = null;
    const server = httpServer;
    httpServer = null;
    info = null;
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  return {
    start,
    stop,
    isReady: () => Boolean(info),
    getInfo: () => info,
  };
}
