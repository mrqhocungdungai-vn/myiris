// Pure tool-logic + server-lifecycle coverage for canvas-mcp.mjs. No
// Electron, no excalidraw import here (see canvas-mcp.golden.test.mjs for the
// jsdom-dependent golden element-builder comparison) — these exercise the
// scene transforms and the raw HTTP/MCP listener directly.
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  emptyScene,
  sceneOrEmpty,
  applyAddElements,
  applyUpdateElements,
  applyDeleteElements,
  createCanvasMcp,
  buildMcpServerRecord,
  describePersist,
  persistNote,
  annotateResults,
  changedIdsFrom,
  normalizeImageResult,
  imageUnavailableText,
  DEFAULT_IMAGE_TIMEOUT_MS,
} from "./canvas-mcp.mjs";

function rect(id, x = 0, y = 0, width = 50, height = 50) {
  return { id, type: "rectangle", x, y, width, height, angle: 0, index: "a0" };
}

// Wiring-shape coverage (design.md D6/5.1/5.2, task 7.4): both the PO
// options.mcpServers entry (po-session.test.mjs asserts it flows through
// unmodified) and the DEV --mcp-config JSON (main.mjs wraps this same record
// as { mcpServers: { "iris-canvas": record } }) are built from this one
// function, so this is the single place that needs to assert the shape.
describe("buildMcpServerRecord", () => {
  it("returns null when the server isn't up", () => {
    expect(buildMcpServerRecord(null)).toBeNull();
  });

  it("builds the Iris-scoped McpHttpServerConfig record both wiring paths share", () => {
    const record = buildMcpServerRecord({ url: "http://127.0.0.1:54321/mcp", token: "sekret" });
    expect(record).toEqual({
      type: "http",
      url: "http://127.0.0.1:54321/mcp",
      headers: { Authorization: "Bearer sekret" },
      alwaysLoad: true,
    });
  });
});

describe("sceneOrEmpty", () => {
  it("treats null (fresh machine) as an empty scene", () => {
    expect(sceneOrEmpty(null)).toEqual(emptyScene());
  });

  it("passes through a real scene unchanged", () => {
    const scene = { type: "excalidraw", elements: [rect("a")], appState: {}, files: {} };
    expect(sceneOrEmpty(scene)).toEqual(scene);
  });
});

describe("applyAddElements", () => {
  it("appends new elements to an empty scene", () => {
    const { scene, results } = applyAddElements(null, [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }]);
    expect(scene.elements).toHaveLength(1);
    expect(results).toEqual([{ id: scene.elements[0].id, status: "applied" }]);
  });

  it("reassigns a colliding id rather than silently overwriting the existing element", () => {
    const existing = { type: "excalidraw", elements: [rect("dup")], appState: {}, files: {} };
    const { scene, results } = applyAddElements(existing, [{ id: "dup", type: "rectangle", x: 1, y: 1, width: 5, height: 5 }]);
    expect(scene.elements).toHaveLength(2);
    expect(scene.elements[0].id).toBe("dup"); // original untouched
    expect(results[0].id).not.toBe("dup"); // new element got a fresh id
    expect(results[0].status).toBe("applied");
  });

  it("binds an arrow to two shapes added in the same batch and records boundElements both ways", () => {
    const { scene, results } = applyAddElements(null, [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 50, height: 50 },
      { id: "b", type: "rectangle", x: 200, y: 0, width: 50, height: 50 },
      { id: "arr", type: "arrow", start: { id: "a" }, end: { id: "b" } },
    ]);
    expect(results.find((r) => r.id === "arr").status).toBe("applied");
    const arrow = scene.elements.find((e) => e.id === "arr");
    expect(arrow.startBinding.elementId).toBe("a");
    expect(arrow.endBinding.elementId).toBe("b");
    const shapeA = scene.elements.find((e) => e.id === "a");
    const shapeB = scene.elements.find((e) => e.id === "b");
    expect(shapeA.boundElements).toEqual([{ id: "arr", type: "arrow" }]);
    expect(shapeB.boundElements).toEqual([{ id: "arr", type: "arrow" }]);
  });

  it("reports rebound: dropped-binding for a connector bound to a nonexistent element, but still adds it", () => {
    const { scene, results } = applyAddElements(null, [
      { id: "arr", type: "arrow", x: 0, y: 0, start: { id: "ghost" } },
    ]);
    expect(results).toEqual([{ id: "arr", status: "rebound: dropped-binding" }]);
    const arrow = scene.elements.find((e) => e.id === "arr");
    expect(arrow).toBeDefined();
    expect(arrow.startBinding).toBeNull();
  });

  // design.md D5: the label is an element the caller never listed. If its id
  // misses the results, changedIdsFrom won't name it, the renderer won't
  // reconcile it, and the box appears on an open canvas with no caption while
  // the persisted scene says otherwise.
  it("binds a label inside its container and reports the label's own id so the open canvas reconciles it", () => {
    const { scene, results } = applyAddElements(null, [
      { id: "box", type: "rectangle", x: 10, y: 20, width: 200, height: 80, label: { text: "Auth Service" } },
    ]);
    const label = scene.elements.find((e) => e.type === "text");
    expect(label.containerId).toBe("box");
    expect(label.textAlign).toBe("center");
    expect(label.verticalAlign).toBe("middle");
    expect(label.fontFamily).toBe(5); // the bound-label family, not free-standing text's 1
    expect(label.height).toBe(25); // fontSize * 1.25
    expect(label.y).toBe(20 + (80 - 25) / 2); // centred in the container
    expect(label.x).toBe(10 + (200 - label.width) / 2);

    const box = scene.elements.find((e) => e.id === "box");
    expect(box.boundElements).toEqual([{ id: label.id, type: "text" }]);

    // Reported, but not as a second element the caller asked for.
    expect(results).toEqual([
      { id: "box", status: "applied" },
      { id: label.id, status: "applied", boundTo: "box" },
    ]);
    expect(changedIdsFrom(results)).toEqual(["box", label.id]);
  });

  it("binds a label to a connector, centred on the route rather than on its first vertex", () => {
    const { scene } = applyAddElements(null, [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 50, height: 50 },
      { id: "b", type: "rectangle", x: 300, y: 0, width: 50, height: 50 },
      { id: "arr", type: "arrow", start: { id: "a" }, end: { id: "b" }, label: { text: "yes" } },
    ]);
    const label = scene.elements.find((e) => e.type === "text");
    expect(label.containerId).toBe("arr");
    const arrow = scene.elements.find((e) => e.id === "arr");
    expect(arrow.boundElements).toEqual([{ id: label.id, type: "text" }]);
    // Sized to its own text, not to the connector — a label as wide as the
    // arrow would mask the arrow (design.md D4).
    expect(label.width).toBeLessThan(arrow.width);
  });

  it("stores roundness, groupIds and elbowed instead of replacing them with defaults", () => {
    const { scene } = applyAddElements(null, [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 10, height: 10, roundness: { type: 3 }, groupIds: ["g1"] },
      { id: "arr", type: "arrow", x: 0, y: 0, elbowed: true },
    ]);
    const box = scene.elements.find((e) => e.id === "box");
    expect(box.roundness).toEqual({ type: 3 });
    expect(box.groupIds).toEqual(["g1"]);
    const arrow = scene.elements.find((e) => e.id === "arr");
    expect(arrow.elbowed).toBe(true);
    expect(arrow.fixedSegments).toEqual([]);
  });

  it("keeps every vertex of a multi-point route and sizes the connector to the whole route", () => {
    const { scene } = applyAddElements(null, [
      {
        id: "arr",
        type: "arrow",
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 0],
          [50, 60],
          [120, 60],
        ],
      },
    ]);
    const arrow = scene.elements.find((e) => e.id === "arr");
    expect(arrow.points).toEqual([
      [0, 0],
      [50, 0],
      [50, 60],
      [120, 60],
    ]);
    expect(arrow.width).toBe(120);
    expect(arrow.height).toBe(60); // the route's extent, not the last vertex alone
  });
});

describe("applyUpdateElements", () => {
  it("patches an existing element by id", () => {
    const existing = { type: "excalidraw", elements: [rect("a", 0, 0, 10, 10)], appState: {}, files: {} };
    const { scene, results } = applyUpdateElements(existing, [{ id: "a", x: 99 }]);
    expect(scene.elements[0].x).toBe(99);
    expect(scene.elements[0].width).toBe(10); // untouched fields survive
    expect(results).toEqual([{ id: "a", status: "applied" }]);
  });

  it("returns skipped: unknown-id for a missing id, without throwing", () => {
    const { results } = applyUpdateElements(null, [{ id: "ghost", x: 1 }]);
    expect(results).toEqual([{ id: "ghost", status: "skipped: unknown-id" }]);
  });

  // A container with two bound labels is the same silent damage as a dropped
  // one: the model asked to change a caption, not to stack a second one on it.
  it("rewrites the label already bound to a container rather than adding a rival one", () => {
    const added = applyAddElements(null, [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 200, height: 80, label: { text: "Old" } },
    ]);
    const labelId = added.scene.elements.find((e) => e.type === "text").id;

    const { scene, results } = applyUpdateElements(added.scene, [{ id: "box", x: 400, label: { text: "New" } }]);

    expect(scene.elements.filter((e) => e.type === "text")).toHaveLength(1);
    const label = scene.elements.find((e) => e.type === "text");
    expect(label.id).toBe(labelId); // same element, patched in place
    expect(label.text).toBe("New");
    expect(label.x).toBe(400 + (200 - label.width) / 2); // re-centred on the moved container
    expect(scene.elements.find((e) => e.id === "box").boundElements).toEqual([{ id: labelId, type: "text" }]);
    expect(results).toEqual([
      { id: "box", status: "applied" },
      { id: labelId, status: "applied", boundTo: "box" },
    ]);
  });

  it("gives a container that had no label one, rather than dropping the field", () => {
    const existing = { type: "excalidraw", elements: [rect("a", 0, 0, 100, 40)], appState: {}, files: {} };
    const { scene, results } = applyUpdateElements(existing, [{ id: "a", label: { text: "Hi" } }]);
    const label = scene.elements.find((e) => e.type === "text");
    expect(label.containerId).toBe("a");
    expect(scene.elements.find((e) => e.id === "a").boundElements).toEqual([{ id: label.id, type: "text" }]);
    expect(results[1]).toEqual({ id: label.id, status: "applied", boundTo: "a" });
    // `label` is a second element, never a field smuggled onto the container.
    expect(scene.elements.find((e) => e.id === "a").label).toBeUndefined();
  });
});

describe("applyDeleteElements", () => {
  it("removes elements by id", () => {
    const existing = { type: "excalidraw", elements: [rect("a"), rect("b")], appState: {}, files: {} };
    const { scene, results } = applyDeleteElements(existing, ["a"]);
    expect(scene.elements.map((e) => e.id)).toEqual(["b"]);
    expect(results).toEqual([{ id: "a", status: "applied" }]);
  });

  it("returns skipped: unknown-id for a missing id", () => {
    const { results } = applyDeleteElements(null, ["ghost"]);
    expect(results).toEqual([{ id: "ghost", status: "skipped: unknown-id" }]);
  });
});

describe("get_canvas over a scene object", () => {
  it("returns the current cache contents", () => {
    // Exercised end-to-end (over real HTTP/MCP) in the "live server" describe
    // block below — this just documents that sceneOrEmpty is what backs it.
    const scene = { type: "excalidraw", elements: [rect("a")], appState: {}, files: {} };
    expect(sceneOrEmpty(scene).elements).toHaveLength(1);
  });
});

// ===== Live server: auth, crash-safety, image-timeout degradation =====

function makeMcp(overrides = {}) {
  let scene = null;
  return {
    mcp: createCanvasMcp({
      getScene: () => scene,
      setScene: (next) => {
        scene = next;
      },
      flush: async () => {},
      broadcastApply: () => {},
      requestImage: async () => null,
      log: () => {},
      ...overrides,
    }),
    getScene: () => scene,
  };
}

async function connectClient(info, headers) {
  const transport = new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers } });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("canvas MCP live server", () => {
  let mcp;

  afterEach(async () => {
    await mcp?.stop();
  });

  it("start() is idempotent and returns url + token", async () => {
    ({ mcp } = makeMcp());
    const info1 = await mcp.start();
    const info2 = await mcp.start();
    expect(info1).toBe(info2);
    expect(mcp.isReady()).toBe(true);
    expect(info1.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it("accepts a client that presents the correct bearer token", async () => {
    ({ mcp } = makeMcp());
    const info = await mcp.start();
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "add_elements",
      "delete_elements",
      "get_canvas",
      "update_elements",
    ]);
    await client.close();
  });

  it("rejects a request with no bearer token", async () => {
    ({ mcp } = makeMcp());
    const info = await mcp.start();
    await expect(connectClient(info, {})).rejects.toBeTruthy();
  });

  it("rejects a request with the wrong bearer token", async () => {
    ({ mcp } = makeMcp());
    const info = await mcp.start();
    await expect(connectClient(info, { Authorization: "Bearer wrong-token" })).rejects.toBeTruthy();
  });

  it("get_canvas over the live server round-trips the current cache", async () => {
    const { mcp: server, getScene } = makeMcp();
    mcp = server;
    const info = await mcp.start();
    // Prime the cache the way a write tool would.
    const { scene } = applyAddElements(getScene(), [{ type: "rectangle", x: 0, y: 0, width: 20, height: 20 }]);
    // reach in via the same setScene the tools use
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });
    // Directly call add_elements over MCP instead, so the live cache updates:
    await client.callTool({ name: "add_elements", arguments: { elements: [{ type: "rectangle", x: 5, y: 5, width: 10, height: 10 }] } });
    const result = await client.callTool({ name: "get_canvas", arguments: {} });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.elements).toHaveLength(1);
    await client.close();
    // scene from the manual apply above is unused by the live cache (separate
    // call) — assert it at least didn't throw, sanity-checking the helper.
    expect(scene.elements).toHaveLength(1);
  });

  it("get_canvas({ includeImage: true }) degrades within its budget and states the timeout", async () => {
    ({ mcp } = makeMcp({ requestImage: () => new Promise(() => {}) }));
    const info = await mcp.start();
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });
    const start = Date.now();
    const result = await client.callTool({ name: "get_canvas", arguments: { includeImage: true } });
    expect(Date.now() - start).toBeLessThan(DEFAULT_IMAGE_TIMEOUT_MS + 2000);
    // JSON plus an explanation, never an image block and never a silent omission
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toMatch(/budget/);
    expect(result.isError).not.toBe(true);
    await client.close();
  }, 10000);

  it("a bind failure rejects start() without throwing/crashing the process", async () => {
    // Occupy a fixed port first, then force a canvas-mcp instance to try
    // binding that exact port (production always uses ephemeral port 0; the
    // `port` override exists solely so this test doesn't race an OS-assigned
    // port number).
    const blocker = http.createServer(() => {});
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = blocker.address();
    const port = typeof address === "object" && address ? address.port : undefined;

    const { mcp: second } = makeMcp({ port });
    mcp = second;
    try {
      await expect(second.start()).rejects.toBeTruthy();
      expect(second.isReady()).toBe(false);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});


// ===== Persist reporting and degraded reads (the-canvas-stops-fighting-back) =====

describe("describePersist / annotateResults", () => {
  it("is persisted when neither the write nor the flush objected", () => {
    expect(describePersist({ revision: 2, persisted: true, reason: null }, { persisted: true })).toEqual({
      persisted: true,
      reason: null,
    });
  });

  it("treats a dependency that reports nothing as persisted (older injected shapes)", () => {
    expect(describePersist(undefined, undefined).persisted).toBe(true);
  });

  it("reports the size guard rather than success", () => {
    const persist = describePersist({ revision: 2, persisted: false, reason: "oversized" }, { persisted: false, reason: "oversized" });
    expect(persist).toEqual({ persisted: false, reason: "oversized" });
    expect(persistNote(persist)).toMatch(/size guard/);
  });

  it("stops calling an unpersisted write applied", () => {
    const results = [{ id: "a", status: "applied" }, { id: "b", status: "skipped: unknown-id" }];
    const annotated = annotateResults(results, { persisted: false, reason: "oversized" });
    expect(annotated[0].status).toBe("applied in memory only, not persisted: oversized");
    expect(annotated[1].status).toBe("skipped: unknown-id"); // untouched
    expect(annotateResults(results, { persisted: true, reason: null })).toBe(results);
  });
});

describe("changedIdsFrom", () => {
  it("names only the ids a write actually touched", () => {
    expect(
      changedIdsFrom([
        { id: "a", status: "applied" },
        { id: "b", status: "rebound: dropped-binding" },
        { id: "c", status: "skipped: unknown-id" },
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("normalizeImageResult / imageUnavailableText", () => {
  it("reads a bare image, a { image, reason } pair, and a hard timeout alike", () => {
    expect(normalizeImageResult({ data: "x", mimeType: "image/png" }).image).toEqual({ data: "x", mimeType: "image/png" });
    expect(normalizeImageResult({ image: null, reason: "panel-closed" })).toEqual({ image: null, reason: "panel-closed" });
    expect(normalizeImageResult(null)).toEqual({ image: null, reason: "export-timeout" });
  });

  it("explains every reason in words Claude can repeat, and warns it off claiming it looked", () => {
    expect(imageUnavailableText("panel-closed")).toMatch(/panel is not open/);
    expect(imageUnavailableText("export-timeout")).toMatch(/budget/);
    expect(imageUnavailableText("weird")).toMatch(/weird/);
    expect(imageUnavailableText("panel-closed")).toMatch(/do not claim/);
  });
});

describe("canvas MCP write tools over the live server", () => {
  let mcp;

  afterEach(async () => {
    await mcp?.stop();
  });

  it("broadcasts the apply with the revision and the ids it changed", async () => {
    const applies = [];
    const { mcp: server } = makeMcp({
      setScene: () => ({ revision: 9, persisted: true, reason: null }),
      flush: async () => ({ persisted: true, reason: null }),
      broadcastApply: (elements, meta) => applies.push({ count: elements.length, meta }),
    });
    mcp = server;
    const info = await mcp.start();
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });

    const result = await client.callTool({
      name: "add_elements",
      arguments: { elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] },
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.persisted).toBe(true);
    expect(payload.revision).toBe(9);
    expect(applies).toHaveLength(1);
    expect(applies[0].meta).toEqual({ revision: 9, changedIds: ["r1"] });
    await client.close();
  });

  it("does not report applied for a scene the size guard refused to write", async () => {
    const { mcp: server } = makeMcp({
      setScene: () => ({ revision: 4, persisted: false, reason: "oversized" }),
      flush: async () => ({ persisted: false, reason: "oversized" }),
    });
    mcp = server;
    const info = await mcp.start();
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });

    const result = await client.callTool({
      name: "add_elements",
      arguments: { elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] },
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.persisted).toBe(false);
    expect(payload.persistError).toMatch(/size guard/);
    expect(payload.results[0].status).not.toBe("applied");
    await client.close();
  });

  it("get_canvas({ includeImage: true }) says why the image is missing instead of omitting it", async () => {
    ({ mcp } = makeMcp({ requestImage: async () => ({ image: null, reason: "panel-closed" }) }));
    const info = await mcp.start();
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });

    const result = await client.callTool({ name: "get_canvas", arguments: { includeImage: true } });

    expect(result.content).toHaveLength(2);
    expect(result.content[1].type).toBe("text");
    expect(result.content[1].text).toMatch(/panel is not open/);
    await client.close();
  });
});
