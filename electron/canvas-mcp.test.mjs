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

  it("get_canvas({ includeImage: true }) degrades to JSON-only when the image request never resolves (timeout)", async () => {
    ({ mcp } = makeMcp({ requestImage: () => new Promise(() => {}) }));
    const info = await mcp.start();
    const client = await connectClient(info, { Authorization: `Bearer ${info.token}` });
    const start = Date.now();
    const result = await client.callTool({ name: "get_canvas", arguments: { includeImage: true } });
    expect(Date.now() - start).toBeLessThan(DEFAULT_IMAGE_TIMEOUT_MS + 2000);
    expect(result.content).toHaveLength(1); // JSON only, no image block, no throw
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
