// Pure, Electron-free coverage of the main-side scene seam in
// openspec/changes/hud-drawing-canvas/specs/hud-drawing-canvas/spec.md:
// the in-memory cache stays fresh independent of the disk-write debounce,
// disk-loads lazily on first call, the size guard skips persisting an
// oversized scene, and the async atomic write replaces the file on flush.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvasStore } from "./canvas-store.mjs";

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

  it("flush is a no-op when nothing is pending", async () => {
    const file = makeTmpFile();
    const store = createCanvasStore({ file });

    await expect(store.flush()).resolves.toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });
});
