// The test that was missing, and whose absence let "Iris draws, I close the
// panel, her work is gone" ship.
//
// The two suites that looked like they covered this each stopped just short:
// `canvas.test.mjs` mocks the store (so `changedIdsSince` always answered
// `[]`), and `canvas-store.test.mjs` re-implements the `canvas:scene` handler
// rather than calling it. Between them, nothing ever ran the actual chain —
// real store, real handler, real revisions — which is precisely where the bug
// lived. So this file mocks neither.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvasCapability } from "./canvas.mjs";

let dirs = [];
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function makeCapability() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-real-path-"));
  dirs.push(dir);
  const file = path.join(dir, "canvas.json");

  // Stands in for the renderer, and only for the renderer: it remembers the
  // revision an apply teaches it, exactly as DrawingCanvas does.
  const renderer = { revision: null, applies: [] };
  const capability = createCanvasCapability({
    canvasStoreFile: file,
    emitToRenderer: (channel, payload) => {
      if (channel !== "canvas:apply") return;
      renderer.applies.push(payload);
      if (typeof payload.revision === "number") renderer.revision = payload.revision;
    },
    emitEvent: () => {},
    notifyIris: () => {},
    getMainWindow: () => null,
    getPipelineAvailable: () => true,
    userDisplayName: () => "Alex",
    // Never reached here: the native open/save handlers are not part of this
    // path, and stubs that throw say so rather than quietly returning.
    dialog: {
      showOpenDialog: () => {
        throw new Error("not part of this path");
      },
      showSaveDialog: () => {
        throw new Error("not part of this path");
      },
    },
  });
  const handlers = Object.fromEntries(capability.ipcHandlers.map((handler) => [handler.channel, handler.fn]));
  return { capability, handlers, renderer, file };
}

const element = (id, x) => ({ id, type: "rectangle", x, y: 0, width: 50, height: 50, version: 1, versionNonce: 1 });
const scene = (elements) => ({ type: "excalidraw", version: 2, source: "local", elements, appState: {}, files: {} });
const idsIn = (result) => (result?.elements ?? []).map((el) => el.id).sort();

describe("canvas real path: a write by Iris is not deleted by a push that predates it", () => {
  it("survives when the renderer pushes a snapshot taken before the write", async () => {
    const { capability, handlers, renderer, file } = makeCapability();

    // 1. The user draws. The renderer learns the revision from the ack.
    const ack = handlers["canvas:scene"](null, { scene: scene([element("u1", 0)]), baseRevision: renderer.revision });
    renderer.revision = ack.revision;

    // 2. The user keeps drawing: a second snapshot is taken and queued, based
    //    at the revision current RIGHT NOW. It has not been sent yet.
    const queuedSnapshot = scene([element("u1", 0), element("u2", 100)]);
    const queuedBase = renderer.revision;

    // 3. Iris writes. The renderer is told, and adopts her revision.
    const store = handlers["canvas:get-scene"]();
    handlers["canvas:scene"](null, {
      scene: scene([...(store?.elements ?? []), element("ai1", 300)]),
      baseRevision: renderer.revision,
    });
    const irisRevision = handlers["canvas:get-scene"]().irisRevision;
    renderer.revision = irisRevision;

    // 4. The queued snapshot is finally pushed. It must declare the revision
    //    it was TAKEN at (queuedBase), not the one the renderer has since
    //    adopted — that lie is what deleted Iris's work.
    handlers["canvas:scene"](null, { scene: queuedSnapshot, baseRevision: queuedBase });

    expect(idsIn(handlers["canvas:get-scene"]())).toEqual(["ai1", "u1", "u2"]);

    // And on disk, through the real teardown flush — the moment the user
    // actually experiences as "I closed it".
    await capability.teardown();
    expect(fs.existsSync(file)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(file, "utf8"))
        .elements.map((el) => el.id)
        .sort(),
    ).toEqual(["ai1", "u1", "u2"]);
  });

  it("is deleted, demonstrably, when the push declares the newer revision instead", () => {
    // The old behaviour, kept as a test so the bug cannot come back quietly:
    // same sequence, but the push claims the revision the renderer had adopted
    // from the apply. Main sees a current push and replaces the scene.
    const { handlers, renderer } = makeCapability();

    const ack = handlers["canvas:scene"](null, { scene: scene([element("u1", 0)]), baseRevision: null });
    renderer.revision = ack.revision;
    const queuedSnapshot = scene([element("u1", 0), element("u2", 100)]);

    const store = handlers["canvas:get-scene"]();
    handlers["canvas:scene"](null, {
      scene: scene([...(store?.elements ?? []), element("ai1", 300)]),
      baseRevision: renderer.revision,
    });
    renderer.revision = handlers["canvas:get-scene"]().irisRevision;

    handlers["canvas:scene"](null, { scene: queuedSnapshot, baseRevision: renderer.revision });

    expect(idsIn(handlers["canvas:get-scene"]())).not.toContain("ai1");
  });

  it("still lets a push delete an element it has actually seen", () => {
    // The protection must not become resurrection: a push based at the
    // revision that introduced an element, and omitting it, is a real delete.
    const { handlers, renderer } = makeCapability();

    handlers["canvas:scene"](null, { scene: scene([element("u1", 0)]), baseRevision: null });
    const store = handlers["canvas:get-scene"]();
    handlers["canvas:scene"](null, {
      scene: scene([...(store?.elements ?? []), element("ai1", 300)]),
      baseRevision: handlers["canvas:get-scene"]().irisRevision,
    });
    renderer.revision = handlers["canvas:get-scene"]().irisRevision;

    handlers["canvas:scene"](null, { scene: scene([element("u1", 0)]), baseRevision: renderer.revision });

    expect(idsIn(handlers["canvas:get-scene"]())).toEqual(["u1"]);
  });
});
