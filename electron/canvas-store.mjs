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

// How many recent writes the store remembers by revision. A push carries the
// revision it was derived from; to reconcile it we need the ids written since
// that revision. Anything older than this window degrades to the conservative
// merge (keep everything) rather than to a silent overwrite — the window only
// has to cover the renderer's 500 ms debounce plus a Claude write or two.
const REVISION_HISTORY = 64;

// Merges a scene pushed by one writer into the scene another writer has
// already committed, per element id — the "last-writer-wins per element" rule
// of hud-drawing-canvas, as opposed to the whole-scene replace that let a
// stale push delete a newer write outright.
//
// `protectedIds` is the set of ids written since the push was derived (i.e.
// the writes the push could not have seen); `null` means "unknown", in which
// case every cached element is protected. That asymmetry is deliberate: an
// element the push never saw must never be deleted by it, while an element
// the push *did* see and dropped is a genuine delete and is honoured.
/**
 * @param {any} cacheScene
 * @param {any} pushedScene
 * @param {string[] | null | undefined} protectedIds
 */
export function reconcileSceneElements(cacheScene, pushedScene, protectedIds) {
  const cacheElements = Array.isArray(cacheScene?.elements) ? cacheScene.elements : [];
  const pushedElements = Array.isArray(pushedScene?.elements) ? pushedScene.elements : [];
  const cacheById = new Map(cacheElements.map((el) => [el?.id, el]));
  const protect =
    protectedIds === null || protectedIds === undefined
      ? new Set(cacheById.keys())
      : new Set(protectedIds);

  const merged = [];
  const seen = new Set();
  for (const el of pushedElements) {
    // The newer write wins for an id both sides touched.
    const newer = protect.has(el?.id) ? cacheById.get(el?.id) : null;
    merged.push(newer || el);
    seen.add(el?.id);
  }
  for (const el of cacheElements) {
    if (seen.has(el?.id)) continue;
    if (!protect.has(el?.id)) continue; // the push saw this id and dropped it: a real delete
    merged.push(el);
  }

  return {
    ...pushedScene,
    // `files` is content-addressed and append-only in practice, so a union
    // keeps an image one writer embedded from vanishing with the other's push.
    files: { ...cacheScene?.files, ...pushedScene?.files },
    elements: merged,
  };
}

// Main-cached scene store: an in-memory cache updated eagerly on every push
// (so `getScene` is never behind the disk-write debounce), with the disk
// write itself coarse-debounced and off the hot path via an async atomic
// write. See design.md D5 of hud-drawing-canvas.
//
// Every accepted write stamps a monotonic `revision`; a writer declares the
// revision it derived its scene from so a stale write can be reconciled per
// element instead of replacing the cache wholesale.
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
  let revision = 0;
  // Reason the newest accepted write is not on its way to disk, so a later
  // flush() can report it instead of looking like "nothing to do".
  let dropReason = null;
  /** @type {Array<{ revision: number, changedIds: string[] | null }>} */
  let history = [];

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

  function getRevision() {
    return revision;
  }

  // The pair a reader needs to push back safely later: the scene it read and
  // the revision it read it at.
  function getSceneWithRevision() {
    return { scene: getScene(), revision };
  }

  // Ids written after `baseRevision`, or null when that cannot be known (no
  // base declared, or the base is older than the retained history) — null is
  // the caller's signal to reconcile conservatively.
  /** @param {number | null | undefined} baseRevision */
  function changedIdsSince(baseRevision) {
    if (typeof baseRevision !== "number" || !Number.isFinite(baseRevision)) return null;
    if (baseRevision >= revision) return [];
    const relevant = history.filter((entry) => entry.revision > baseRevision);
    // A gap in the history (evicted entries) means writes we can no longer
    // describe; treat that as unknown rather than as "nothing changed".
    if (relevant.length !== revision - baseRevision) return null;
    if (relevant.some((entry) => entry.changedIds === null)) return null;
    return [...new Set(relevant.flatMap((entry) => entry.changedIds || []))];
  }

  // Returns the outcome rather than swallowing it: an oversized scene is
  // still served from memory but never reaches disk, and its writer has to be
  // able to say so instead of reporting success.
  /**
   * @param {any} scene
   * @param {{ changedIds?: string[] | null }} [meta]
   * @returns {{ revision: number, persisted: boolean, reason: string | null }}
   */
  function setScene(scene, meta = {}) {
    cache = scene;
    revision += 1;
    history.push({ revision, changedIds: meta?.changedIds ? [...meta.changedIds] : null });
    if (history.length > REVISION_HISTORY) history = history.slice(-REVISION_HISTORY);

    const json = JSON.stringify(scene);
    if (Buffer.byteLength(json, "utf8") > maxBytes) {
      // Oversized: keep serving the fresh in-memory scene, but skip writing
      // it to disk so the persisted file and future disk-load stay bounded.
      pendingJson = null;
      dropReason = "oversized";
      return { revision, persisted: false, reason: "oversized" };
    }
    pendingJson = json;
    dropReason = null;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flush().catch(() => {
          // Best-effort persist; the in-memory cache remains authoritative.
        });
      }, debounceMs);
    }
    return { revision, persisted: true, reason: null };
  }

  /** @returns {Promise<{ persisted: boolean, reason: string | null }>} */
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingJson === null) {
      // "nothing-pending" is not a failure — it is the already-persisted (or
      // never-written) case; "oversized" is the one a writer must hear about.
      return { persisted: dropReason === null, reason: dropReason || "nothing-pending" };
    }
    const json = pendingJson;
    pendingJson = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await writeFileAtomicAsync(file, json, "utf8");
    return { persisted: true, reason: null };
  }

  return { getScene, getRevision, getSceneWithRevision, changedIdsSince, setScene, flush };
}
