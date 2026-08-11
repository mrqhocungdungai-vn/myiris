// The canvas-claude-mcp module: hosts one local MCP server (Streamable HTTP,
// stateless, 127.0.0.1 + ephemeral port + bearer token) exposing read/write
// tools over the drawing canvas to Claude. Mirrors the canvas-store.mjs /
// stateful-session.mjs seams — dependencies (cache getter/setter/flush, an
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
// share (design.md D6/5.1/5.2): the resident Agent SDK session gets it verbatim as
// `options.mcpServers["iris-canvas"]`, and the stateless run wraps it in
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
    groupIds: Array.isArray(skeleton.groupIds) ? [...skeleton.groupIds] : [],
    frameId: null,
    index,
    roundness: skeleton.roundness ?? null,
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

// A linear element's x/y is its FIRST vertex, not the top-left of what it
// covers — a route that turns upwards has negative offsets. Anything centring
// on a container has to ask for the box, not read x/y/width/height.
function boxOf(el) {
  if (!Array.isArray(el.points) || el.points.length < 2) {
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }
  const xs = el.points.map((p) => el.x + p[0]);
  const ys = el.points.map((p) => el.y + p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// Bound labels use excalidraw's dedicated label font family (5), NOT the 1
// buildTextElement defaults to for free-standing text. Measured against the
// real convertToExcalidrawElements, not read off the docs — see design.md D4
// and the labelled cases in canvas-mcp.golden.test.mjs.
const LABEL_FONT_FAMILY = 5;

// The text element that IS a shape's/connector's label: excalidraw centres,
// wraps and re-measures it against its container at render time, which is the
// whole reason a bound label beats a free-standing one placed by arithmetic
// (the width below is the same estimate buildTextElement uses, and is only a
// starting point here). The container end of the link — its boundElements
// entry — is added by the caller through addBoundElement.
function buildBoundLabel(container, label, index) {
  const text = String(label?.text ?? "");
  const fontSize = Number(label?.fontSize) || 20;
  const width = Math.max(20, text.length * fontSize * 0.6);
  const height = Math.ceil(fontSize * 1.25);
  const box = boxOf(container);
  return {
    ...baseFields({ strokeColor: label?.strokeColor }, index),
    type: "text",
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
    text,
    originalText: text,
    fontSize,
    fontFamily: LABEL_FONT_FAMILY,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: container.id,
    lineHeight: 1.25,
    autoResize: true,
  };
}

// A declared route, normalized to offsets from its own first vertex (which is
// where the element sits). Fewer than two usable vertices is not a route.
function routeOffsets(points) {
  if (!Array.isArray(points)) return null;
  const valid = points.filter(
    (p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])),
  );
  if (valid.length < 2) return null;
  const ox = Number(valid[0][0]);
  const oy = Number(valid[0][1]);
  return valid.map((p) => [Number(p[0]) - ox, Number(p[1]) - oy]);
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
  const route = routeOffsets(skeleton.points);
  const lastVertex = route ? route[route.length - 1] : null;
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
    endPoint = lastVertex
      ? { x: startPoint.x + lastVertex[0], y: startPoint.y + lastVertex[1] }
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
    endPoint = lastVertex
      ? { x: startPoint.x + lastVertex[0], y: startPoint.y + lastVertex[1] }
      : { x: startPoint.x + 100, y: startPoint.y };
  }

  // A declared route keeps every vertex it declared — its waypoints are what
  // stop a connector cutting through the shapes between its ends. Only the
  // first and last are the server's to place: they are where the bindings (or
  // the caller's x/y) put them.
  const tail = [endPoint.x - startPoint.x, endPoint.y - startPoint.y];
  const points = route ? [...route.slice(0, -1), tail] : [[0, 0], tail];

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);

  return {
    ...baseFields(skeleton, index),
    type: skeleton.type,
    x: startPoint.x,
    y: startPoint.y,
    // The extent of the whole route, not of its last vertex — a route that
    // turns is wider and taller than its endpoints alone say.
    width: Math.max(...xs) - Math.min(...xs) || 1,
    height: Math.max(...ys) - Math.min(...ys) || 1,
    points,
    lastCommittedPoint: null,
    startBinding,
    endBinding,
    startArrowhead: skeleton.startArrowhead ?? null,
    endArrowhead: skeleton.type === "arrow" ? (skeleton.endArrowhead ?? "arrow") : null,
    elbowed: skeleton.elbowed === true,
    // Elbow arrows are a distinct shape in excalidraw and carry three fields a
    // straight one does not (measured against the real converter, design.md
    // D4's method). Emitted only when elbowed, exactly as the converter does.
    ...(skeleton.elbowed === true ? { fixedSegments: [], startIsSpecial: false, endIsSpecial: false } : {}),
  };
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const LINEAR_TYPES = new Set(["arrow", "line"]);

// Single entry point used by both applyAddElements and the golden test
// (canvas-mcp.golden.test.mjs) so there is exactly one builder to keep in
// sync with excalidraw's real field set.
//
// A skeleton carrying `label` produces TWO elements, exactly as excalidraw's
// own converter does: the container is returned, and the bound text element is
// pushed onto `labels` — an out-parameter, like `danglingRefs`, so the return
// type stays "the element you asked for". Every caller must place what lands
// in `labels` too; a label that never reaches the scene (or never reaches the
// per-element results) is design.md D5's failure.
export function buildElement(skeleton, { index = "a0", lookup = new Map(), danglingRefs = [], labels = [] } = {}) {
  let el;
  if (SHAPE_TYPES.has(skeleton.type)) el = buildShapeElement(skeleton, index);
  else if (skeleton.type === "text") el = buildTextElement(skeleton, index);
  else if (LINEAR_TYPES.has(skeleton.type)) el = buildLinearElement(skeleton, index, lookup, danglingRefs);
  else throw new Error(`Unsupported element type: ${skeleton.type}`);

  // Text cannot contain text: a label on a text element has no container to
  // centre against, so it is not a thing the vocabulary offers.
  if (skeleton.label?.text != null && el.type !== "text") {
    labels.push(buildBoundLabel(el, skeleton.label, generateKeyBetween(index, null)));
  }
  return el;
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

  // A bound label is an element the caller never listed. It still has to be
  // placed and still has to be reported — `changedIdsFrom` is what tells the
  // open canvas which elements to reconcile, so a label missing from the
  // results persists but never appears on screen (design.md D5). It is marked
  // `boundTo` so it does not read as a second element the caller asked for.
  function place(el, labels, status) {
    lookup.set(el.id, el);
    added.push(el);
    results.push({ id: el.id, status });
    for (const label of labels) {
      added.push(label);
      results.push({ id: label.id, status: "applied", boundTo: el.id });
      cursorIndex = label.index;
    }
  }

  for (const sk of nonLinear) {
    cursorIndex = generateKeyBetween(cursorIndex, null);
    const labels = [];
    const el = buildElement(sk, { index: cursorIndex, lookup, labels });
    place(el, labels, "applied");
  }
  for (const sk of linear) {
    cursorIndex = generateKeyBetween(cursorIndex, null);
    const danglingRefs = [];
    const labels = [];
    const el = buildElement(sk, { index: cursorIndex, lookup, danglingRefs, labels });
    place(el, labels, danglingRefs.length ? "rebound: dropped-binding" : "applied");
  }

  const nextElements = elements.concat(added);
  const nextIdIndex = new Map(nextElements.map((e, i) => [e.id, i]));
  for (const el of added) {
    // startBinding/endBinding exist only on the linear-element branch of
    // buildElement's return union; the shape/text branch has neither.
    const linearEl = /** @type {any} */ (el);
    if (linearEl.startBinding) addBoundElement(nextElements, nextIdIndex, linearEl.startBinding.elementId, el.id, el.type);
    if (linearEl.endBinding) addBoundElement(nextElements, nextIdIndex, linearEl.endBinding.elementId, el.id, el.type);
    // The other half of a label's binding: the container names its text, the
    // same way it names an arrow that binds to it.
    if (linearEl.containerId) addBoundElement(nextElements, nextIdIndex, linearEl.containerId, el.id, "text");
  }

  return { scene: { ...s, elements: nextElements }, results };
}

export function applyUpdateElements(scene, updates) {
  const s = sceneOrEmpty(scene);
  const elements = s.elements.map((e) => ({ ...e }));
  const idIndex = new Map(elements.map((e, i) => [e.id, i]));
  const results = [];
  let cursorIndex = elements.length ? elements[elements.length - 1].index ?? null : null;

  // `label` is not a stored field — it is a second element. Updating it means
  // rewriting the text already bound to this container, never adding a rival
  // one: a container with two bound labels is the same silent-damage class
  // this change exists to close. A container that has no label yet gets one.
  function applyLabel(container, label) {
    const boundId = (container.boundElements || []).find((b) => b?.type === "text")?.id;
    const j = boundId == null ? undefined : idIndex.get(boundId);
    if (j !== undefined) {
      const next = buildBoundLabel(container, label, elements[j].index);
      elements[j] = {
        ...elements[j],
        ...next,
        id: elements[j].id,
        index: elements[j].index,
        version: (elements[j].version ?? 1) + 1,
        versionNonce: randInt32(),
        updated: Date.now(),
      };
      results.push({ id: elements[j].id, status: "applied", boundTo: container.id });
      return;
    }
    cursorIndex = generateKeyBetween(cursorIndex, null);
    const text = buildBoundLabel(container, label, cursorIndex);
    elements.push(text);
    idIndex.set(text.id, elements.length - 1);
    addBoundElement(elements, idIndex, container.id, text.id, "text");
    results.push({ id: text.id, status: "applied", boundTo: container.id });
  }

  for (const patch of updates || []) {
    const i = idIndex.get(patch?.id);
    if (i === undefined) {
      results.push({ id: patch?.id, status: "skipped: unknown-id" });
      continue;
    }
    const { id, label, ...fields } = patch;
    elements[i] = {
      ...elements[i],
      ...fields,
      id,
      version: (elements[i].version ?? 1) + 1,
      versionNonce: randInt32(),
      updated: Date.now(),
    };
    results.push({ id, status: "applied" });
    // After the patch, so the label re-centres against wherever the container
    // now is and whatever size it now has.
    if (label?.text != null && elements[i].type !== "text") applyLabel(elements[i], label);
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

// Naming a field here is a promise that the builders store it. The four at the
// bottom were reaching the server already — `.passthrough()` validated them
// and construction then dropped them, so a model that set `label` was told
// `applied` about a label that never existed. Declared, they are honoured.
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
    label: z
      .object({ text: z.string(), fontSize: z.number().optional(), strokeColor: z.string().optional() })
      .optional(),
    roundness: z.object({ type: z.number() }).nullable().optional(),
    groupIds: z.array(z.string()).optional(),
    elbowed: z.boolean().optional(),
  })
  .passthrough();

// ===== Persist / image outcome reporting (pure) =====

// A write is only "applied" once it is somewhere it can be read back from.
// canvas-store keeps an oversized scene in memory but never writes it, so the
// tool result has to distinguish the two rather than report `applied` for a
// scene that was never written (hud-drawing-canvas: "An unpersisted oversized
// scene is not reported as persisted").
export function describePersist(setResult, flushResult) {
  if (setResult && setResult.persisted === false) {
    return { persisted: false, reason: setResult.reason || "not-persisted" };
  }
  if (flushResult && flushResult.persisted === false) {
    return { persisted: false, reason: flushResult.reason || "not-persisted" };
  }
  return { persisted: true, reason: null };
}

const PERSIST_REASON_TEXT = {
  oversized: "the scene exceeds the persistence size guard, so it lives only in memory until it shrinks",
};

export function persistNote(persist) {
  if (persist.persisted) return null;
  return PERSIST_REASON_TEXT[persist.reason] || `not persisted (${persist.reason})`;
}

// Rewrites per-element statuses when the scene never reached disk — the
// elements are on the live canvas, but calling that "applied" full stop would
// be the silent lie this change exists to remove.
export function annotateResults(results, persist) {
  if (persist.persisted) return results;
  return results.map((r) =>
    r.status === "applied" ? { ...r, status: `applied in memory only, not persisted: ${persist.reason}` } : r,
  );
}

// The ids a write touched, for the renderer's per-element reconciliation —
// a skipped id was never written and must not be claimed as changed.
export function changedIdsFrom(results) {
  return (results || []).filter((r) => r && r.id && !String(r.status).startsWith("skipped")).map((r) => r.id);
}

const IMAGE_REASON_TEXT = {
  "panel-closed": "the drawing panel is not open, so there is nothing rendered to capture",
  "export-timeout": "the export exceeded its budget",
  "export-failed": "the panel replied without an image",
};

// requestImage may resolve an image, or { image, reason }, or null (its own
// hard timeout). Normalizes all three into one shape so get_canvas always has
// something to say about a missing image.
export function normalizeImageResult(raw) {
  if (!raw) return { image: null, reason: "export-timeout" };
  if (typeof raw === "object" && "image" in raw) {
    return { image: raw.image || null, reason: raw.image ? null : raw.reason || "export-failed" };
  }
  return { image: raw, reason: null };
}

export function imageUnavailableText(reason) {
  return `No canvas image is attached: ${IMAGE_REASON_TEXT[reason] || `the export failed (${reason})`}. The scene JSON above is the canvas as it currently stands — do not claim to have looked at a picture of it.`;
}

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

  // One commit path for all three write tools: stamp the write with the ids
  // it touched (so the renderer reconciles per element), learn whether it was
  // actually persisted, and broadcast the resulting revision.
  async function commitWrite(scene, results) {
    const changedIds = changedIdsFrom(results);
    const setResult = setScene(scene, { changedIds });
    let flushResult;
    try {
      flushResult = await flush();
    } catch (error) {
      flushResult = { persisted: false, reason: `write-failed: ${error?.message || "unknown"}` };
    }
    const persist = describePersist(setResult, flushResult);
    const revision = setResult && typeof setResult.revision === "number" ? setResult.revision : null;
    broadcastApply(scene.elements, { revision, changedIds });
    const payload = { results: annotateResults(results, persist), persisted: persist.persisted, revision };
    const note = persistNote(persist);
    if (note) {
      payload.persistError = note;
      log?.("persist_failed", { reason: persist.reason });
    }
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }

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
        const raw = await withTimeout(requestImage({ timeoutMs: DEFAULT_IMAGE_TIMEOUT_MS }), DEFAULT_IMAGE_TIMEOUT_MS);
        const { image, reason } = normalizeImageResult(raw);
        if (image?.data) {
          content.push({ type: "image", data: image.data, mimeType: image.mimeType });
        } else {
          // Say why, and log the degrade: a missing image that reads as
          // "canvas is empty" is how Claude ends up claiming it looked.
          content.push({ type: "text", text: imageUnavailableText(reason) });
          log?.("image_degraded", { reason });
        }
      }
      return { content };
    },
  );

  server.registerTool(
    "add_elements",
    {
      description:
        "Add one or more elements (rectangle, ellipse, diamond, text, arrow, line) to the drawing canvas. " +
        "Give any shape or connector a label: { text } and the text is bound INSIDE it — centred, wrapped and re-measured against it by the canvas — which is how a box gets a caption; a free-standing text element is only for text that belongs to no shape. " +
        "Arrows/lines may set start/end to { id } to bind to an existing element or one added in this same call, expressing a relationship between shapes; endpoints are clipped to the shapes' edges for you, so never compute them yourself. " +
        "Also honoured: roundness ({ type: 3 } for rounded corners), groupIds (move shapes together), elbowed (right-angle routing), and points with more than two vertices to route a connector around what lies between its ends. " +
        "Returns a per-element result: applied, or rebound: dropped-binding if a start/end reference didn't resolve. A generated label appears as its own result marked boundTo: <container id>.",
      inputSchema: { elements: z.array(ELEMENT_SCHEMA) },
    },
    async ({ elements }) => {
      const { scene, results } = applyAddElements(getScene(), elements);
      log?.("tool_call", { tool: "add_elements", elements: elements.length });
      return commitWrite(scene, results);
    },
  );

  server.registerTool(
    "update_elements",
    {
      description:
        "Update one or more existing canvas elements by id (patch — only the given fields change). " +
        "The same vocabulary as add_elements applies: label, roundness, groupIds, elbowed, points. " +
        "Setting label on a container rewrites the label already bound to it (and re-centres it against the container's new position and size), rather than adding a second one. " +
        "Returns skipped: unknown-id for any id not currently on the canvas.",
      inputSchema: { elements: z.array(ELEMENT_SCHEMA.extend({ id: z.string() })) },
    },
    async ({ elements }) => {
      const { scene, results } = applyUpdateElements(getScene(), elements);
      log?.("tool_call", { tool: "update_elements", elements: elements.length });
      return commitWrite(scene, results);
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
      log?.("tool_call", { tool: "delete_elements", elements: ids.length });
      return commitWrite(scene, results);
    },
  );
}

// ===== Server lifecycle =====

// Creates the (not-yet-started) canvas MCP host. All side-effecting
// dependencies are injected so tool logic stays testable in isolation
// (design.md D8): getScene/setScene mirror canvas-store.mjs's
// getScene/setScene, flush forces a durable persist per write (Claude writes
// carry a higher durability bar than user strokes) and both report their
// outcome so an unpersisted scene is never announced as applied,
// broadcastApply is called with the full post-write element set plus
// { revision, changedIds } after every write (main wires it to
// emitToRenderer("canvas:apply", ...), which is naturally a no-op with no
// window and the renderer only listens while the panel is mounted), and
// requestImage resolves { image, reason } (or a bare image) for get_canvas's
// optional image — the reason is what a degraded read reports.
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
