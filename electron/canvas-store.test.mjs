// Pure, Electron-free coverage of the main-side scene seam in
// openspec/changes/hud-drawing-canvas/specs/hud-drawing-canvas/spec.md:
// the in-memory cache stays fresh independent of the disk-write debounce,
// disk-loads lazily on first call, the size guard skips persisting an
// oversized scene, and the async atomic write replaces the file on flush.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvasStore, reconcileSceneElements } from "./canvas-store.mjs";

let dirs = [];
function makeTmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-store-test-"));
  dirs.push(dir);
  return path.join(dir, "canvas.json");
}

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("createCanvasStore", () => {
  it("returns null before anything is pushed or persisted", () => {
    const store = createCanvasStore({ file: makeTmpFile() });
    expect(store.getScene()).toBeNull();
  });

  it("getScene returns the last pushed scene immediately, ahead of the disk debounce", () => {
    const store = createCanvasStore({ file: makeTmpFile(), debounceMs: 10_000 });
    const scene = { type: "excalidraw", elements: [{ id: "a" }], appState: {}, files: {} };

    store.setScene(scene);

    expect(store.getScene()).toEqual(scene);
  });

  it("loads from disk on first call when the in-memory cache is empty", () => {
    const file = makeTmpFile();
    const persisted = { type: "excalidraw", elements: [{ id: "disk" }], appState: {}, files: {} };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(persisted), "utf8");

    const store = createCanvasStore({ file });

    expect(store.getScene()).toEqual(persisted);
  });

  it("returns null if the persisted file is missing or corrupt, without throwing", () => {
    const file = makeTmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not valid json{{{");

    const store = createCanvasStore({ file });

    expect(() => store.getScene()).not.toThrow();
    expect(store.getScene()).toBeNull();
  });

  it("flush writes the pending scene to disk via an atomic (temp + rename) write", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 10_000 });
    const scene = { type: "excalidraw", elements: [{ id: "a" }], appState: {}, files: {} };

    store.setScene(scene);
    await store.flush();

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(scene);
    const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("a later flush call replaces the file with the newest pushed scene", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 10_000 });

    store.setScene({ type: "excalidraw", elements: [{ id: "first" }], appState: {}, files: {} });
    await store.flush();
    store.setScene({ type: "excalidraw", elements: [{ id: "second" }], appState: {}, files: {} });
    await store.flush();

    expect(JSON.parse(fs.readFileSync(file, "utf8")).elements).toEqual([{ id: "second" }]);
  });

  it("the debounced timer eventually persists without an explicit flush", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 20 });
    const scene = { type: "excalidraw", elements: [{ id: "a" }], appState: {}, files: {} };

    store.setScene(scene);
    expect(fs.existsSync(file)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(scene);
  });

  it("the size guard skips persisting an oversized scene but still serves it fresh from memory", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 10_000, maxBytes: 100 });
    const oversized = {
      type: "excalidraw",
      elements: [],
      appState: {},
      files: { huge: "x".repeat(1000) },
    };

    store.setScene(oversized);
    await store.flush();

    expect(store.getScene()).toEqual(oversized);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("flush is a no-op when nothing is pending, and says so", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file });

    await expect(store.flush()).resolves.toEqual({ persisted: true, reason: "nothing-pending" });
    expect(fs.existsSync(file)).toBe(false);
  });
});

// The revision seam of the-canvas-stops-fighting-back: every accepted write
// is stamped, a writer can ask what changed since the revision it read, and
// the size guard's drop is reported rather than swallowed.
describe("createCanvasStore: revision and persist reporting", () => {
  it("stamps a monotonic revision on every setScene and exposes it with the scene", () => {
    const store = createCanvasStore({ file: makeTmpFile(), debounceMs: 10_000 });
    expect(store.getRevision()).toBe(0);

    const first = store.setScene({ elements: [{ id: "a" }] });
    const second = store.setScene({ elements: [{ id: "a" }, { id: "b" }] });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(store.getSceneWithRevision()).toEqual({ scene: { elements: [{ id: "a" }, { id: "b" }] }, revision: 2 });
  });

  it("setScene reports persisted:false with a reason when the size guard drops the write", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 10_000, maxBytes: 100 });

    const outcome = store.setScene({ elements: [], files: { huge: "x".repeat(1000) } });

    expect(outcome).toEqual({ revision: 1, persisted: false, reason: "oversized" });
    // and the flush that follows must not look like "nothing to do"
    await expect(store.flush()).resolves.toEqual({ persisted: false, reason: "oversized" });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("flush reports a real write", async () => {
    const store = createCanvasStore({ file: makeTmpFile(), debounceMs: 10_000 });
    store.setScene({ elements: [] });
    await expect(store.flush()).resolves.toEqual({ persisted: true, reason: null });
  });

  it("changedIdsSince reports the ids written after a base revision", () => {
    const store = createCanvasStore({ file: makeTmpFile(), debounceMs: 10_000 });
    store.setScene({ elements: [{ id: "a" }] }, { changedIds: ["a"] });
    store.setScene({ elements: [{ id: "a" }, { id: "b" }] }, { changedIds: ["b"] });

    expect(store.changedIdsSince(2)).toEqual([]);
    expect(store.changedIdsSince(1)).toEqual(["b"]);
    expect(store.changedIdsSince(0)).toEqual(["a", "b"]);
  });

  it("changedIdsSince is null (unknown) for an undeclared base or a write that named no ids", () => {
    const store = createCanvasStore({ file: makeTmpFile(), debounceMs: 10_000 });
    store.setScene({ elements: [{ id: "a" }] }); // renderer push: whole-scene, ids unknown

    expect(store.changedIdsSince(null)).toBeNull();
    expect(store.changedIdsSince(0)).toBeNull();
  });
});

describe("reconcileSceneElements", () => {
  const cache = {
    type: "excalidraw",
    elements: [{ id: "user" }, { id: "claude", x: 1 }],
    appState: { scrollX: 5 },
    files: { f1: "a" },
  };

  it("keeps an element the push never saw and honours one it did see and dropped", () => {
    const pushed = { type: "excalidraw", elements: [{ id: "user" }, { id: "gone" }], appState: {}, files: {} };

    const merged = reconcileSceneElements(cache, { ...pushed, elements: [{ id: "user" }] }, ["claude"]);

    expect(merged.elements.map((e) => e.id)).toEqual(["user", "claude"]);
  });

  it("drops an element the push deleted when that id was not written since the base", () => {
    const pushed = { type: "excalidraw", elements: [{ id: "user" }], appState: {}, files: {} };

    const merged = reconcileSceneElements(cache, pushed, []);

    expect(merged.elements.map((e) => e.id)).toEqual(["user"]);
  });

  it("prefers the cached copy of an id written since the base", () => {
    const pushed = { type: "excalidraw", elements: [{ id: "claude", x: 999 }], appState: {}, files: {} };

    const merged = reconcileSceneElements(cache, pushed, ["claude"]);

    expect(merged.elements).toEqual([{ id: "claude", x: 1 }]);
  });

  it("protects every cached element when the changed ids are unknown", () => {
    const pushed = { type: "excalidraw", elements: [{ id: "fresh" }], appState: {}, files: {} };

    const merged = reconcileSceneElements(cache, pushed, null);

    expect(merged.elements.map((e) => e.id)).toEqual(["fresh", "user", "claude"]);
  });

  it("takes the push's appState (the renderer owns the viewport) and unions files", () => {
    const pushed = { type: "excalidraw", elements: [], appState: { scrollX: 42 }, files: { f2: "b" } };

    const merged = reconcileSceneElements(cache, pushed, []);

    expect(merged.appState).toEqual({ scrollX: 42 });
    expect(merged.files).toEqual({ f1: "a", f2: "b" });
  });
});

// The user-reported failure this change exists to end: "Iris draws on the
// canvas, I close the panel, and her work is gone — only what I drew myself
// survives." Every step below is a real store against a real temp file; the
// only thing stood in for is the renderer, which is represented by exactly
// what it sends: a whole scene plus the revision it was derived from.
describe("canvas-store: a write by Iris survives the panel closing and the app restarting", () => {
  const userStroke = { id: "user-1", x: 0, version: 3, versionNonce: 11 };
  const irisShape = { id: "iris-1", x: 300, version: 1, versionNonce: 22 };

  function sceneOf(...elements) {
    return { type: "excalidraw", version: 2, elements, appState: {}, files: {} };
  }

  /** What `capabilities/canvas.mjs`'s `canvas:scene` handler decides, kept in
   *  step with it deliberately: the point of this suite is the whole path, and
   *  a copy that drifts would pass while the app fails. */
  function pushFromRenderer(store, scene, baseRevision) {
    const current = store.getRevision();
    const stale = baseRevision === null ? current > 0 : baseRevision < current;
    const next = stale
      ? reconcileSceneElements(store.getScene(), scene, store.changedIdsSince(baseRevision))
      : scene;
    return store.setScene(next);
  }

  it("keeps Iris's elements when the panel closes without ever having seen them", async () => {
    // The mount-race / panel-closed case: the apply broadcast never reached
    // the canvas, so the renderer's idea of the scene predates Iris's write.
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 0 });

    const afterUser = store.setScene(sceneOf(userStroke));
    // Iris writes through the MCP tool path.
    store.setScene(sceneOf(userStroke, irisShape), { changedIds: ["iris-1"] });
    // The panel closes: the renderer flushes the scene IT holds, which has no
    // iris-1 in it, derived from the revision before Iris wrote.
    pushFromRenderer(store, sceneOf(userStroke), afterUser.revision);
    await store.flush();

    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(persisted.elements.map((e) => e.id).sort()).toEqual(["iris-1", "user-1"]);
  });

  it("keeps Iris's elements when the renderer did see them and pushes them back", async () => {
    // The healthy case: the apply landed, so the renderer's own scene already
    // contains iris-1 and its push is not stale.
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 0 });

    store.setScene(sceneOf(userStroke));
    const afterIris = store.setScene(sceneOf(userStroke, irisShape), { changedIds: ["iris-1"] });
    pushFromRenderer(store, sceneOf(userStroke, irisShape), afterIris.revision);
    await store.flush();

    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(persisted.elements.map((e) => e.id).sort()).toEqual(["iris-1", "user-1"]);
  });

  it("keeps Iris's elements when the renderer knows no revision at all", async () => {
    // A reload mid-session: the renderer restarts, has not read the scene yet,
    // and pushes with no base revision. Unattributed is treated as stale.
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 0 });

    store.setScene(sceneOf(userStroke));
    store.setScene(sceneOf(userStroke, irisShape), { changedIds: ["iris-1"] });
    pushFromRenderer(store, sceneOf(userStroke), null);
    await store.flush();

    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(persisted.elements.map((e) => e.id).sort()).toEqual(["iris-1", "user-1"]);
  });

  it("reads Iris's work back on the next launch", async () => {
    const file = makeTmpFile();
    const first = createCanvasStore({ file, debounceMs: 0 });
    first.setScene(sceneOf(userStroke));
    first.setScene(sceneOf(userStroke, irisShape), { changedIds: ["iris-1"] });
    await first.flush();

    // A fresh process, reading the same file.
    const second = createCanvasStore({ file, debounceMs: 0 });
    expect(second.getScene().elements.map((e) => e.id).sort()).toEqual(["iris-1", "user-1"]);
  });

  it("still lets the user delete something Iris drew", async () => {
    // The protection must not become a resurrection: an id the push saw and
    // deliberately dropped is a real delete, not a stale omission.
    const file = makeTmpFile();
    const store = createCanvasStore({ file, debounceMs: 0 });

    store.setScene(sceneOf(userStroke));
    const afterIris = store.setScene(sceneOf(userStroke, irisShape), { changedIds: ["iris-1"] });
    // The renderer HAS seen iris-1 (it pushes at Iris's revision) and removes it.
    pushFromRenderer(store, sceneOf(userStroke), afterIris.revision);
    await store.flush();

    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(persisted.elements.map((e) => e.id)).toEqual(["user-1"]);
  });
});
