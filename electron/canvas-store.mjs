import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "./atomic-file.mjs";

// Default cap on the persisted scene's serialized size — excalidraw `files`
// embed images as dataURLs, so an unbounded scene could otherwise bloat disk
// and jank the debounced write. See design.md D5 "Size guard" of
// hud-drawing-canvas. The in-memory cache is never capped (it must always
// serve the freshest scene to the canvas-claude-mcp seam); only the disk
// persist is skipped when oversized.
export const DEFAULT_MAX_SCENE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_DEBOUNCE_MS = 2000;

// Main-cached scene store: an in-memory cache updated eagerly on every push
// (so `getScene` is never behind the disk-write debounce), with the disk
// write itself coarse-debounced and off the hot path via an async atomic
// write. See design.md D5 of hud-drawing-canvas.
/**
 * @param {{ file?: string, debounceMs?: number, maxBytes?: number }} options
 */
export function createCanvasStore({
  file,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxBytes = DEFAULT_MAX_SCENE_BYTES,
} = {}) {
  if (!file) throw new Error("createCanvasStore requires a file path");

  let cache = null;
  let triedDiskLoad = false;
  let timer = null;
  let pendingJson = null;

  function loadFromDisk() {
    triedDiskLoad = true;
    try {
      cache = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      cache = null;
    }
  }

  function getScene() {
    if (cache === null && !triedDiskLoad) loadFromDisk();
    return cache;
  }

  function setScene(scene) {
    cache = scene;
    const json = JSON.stringify(scene);
    if (Buffer.byteLength(json, "utf8") > maxBytes) {
      // Oversized: keep serving the fresh in-memory scene, but skip writing
      // it to disk so the persisted file and future disk-load stay bounded.
      return;
    }
    pendingJson = json;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {
        // Best-effort persist; the in-memory cache remains authoritative.
      });
    }, debounceMs);
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingJson === null) return;
    const json = pendingJson;
    pendingJson = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await writeFileAtomicAsync(file, json, "utf8");
  }

  return { getScene, setScene, flush };
}
