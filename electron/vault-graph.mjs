import fs from "node:fs";
import path from "node:path";
import { parseVaultFiles, isUserNote } from "./vault-graph-parse.mjs";

export const DEFAULT_DEBOUNCE_MS = 500;
// Bounded concurrency for the async file-read fan-out (design.md H1): a
// synchronous readFileSync+gray-matter loop over a large vault would block
// the main process's single event loop — shared with the Gemini Live
// websocket and the 16/24kHz audio IPC — for tens-to-hundreds of ms per
// rebuild. fs.promises.readFile + a small worker pool yields between reads.
const SCAN_READ_CONCURRENCY = 8;

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

// Recursively collects `.md` candidate note paths under `dir` that pass
// `isUserNote`. Symlinked directories are never descended into (design.md
// D8/H3: fs.watch's recursive mode does not reliably follow symlinked
// subtrees, and a symlink cycle could loop readdir); visited real
// directory inodes are also tracked as a second guard against a cycle
// formed by hard-linked/bind-mounted directories. A symlinked *file* is a
// legitimate candidate (design.md's `secret.md -> ~/.ssh/id_rsa` scenario
// is a node that exists but whose *read* is refused later — see D8/H3 in
// vault-graph-parse.mjs's caller, main.mjs's read-note handler).
async function walkForNoteCandidates(baseDir) {
  const visitedDirInodes = new Set();
  const candidates = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return; // removed mid-walk, or (for the root) the vault doesn't exist
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        let stat;
        try {
          stat = await fs.promises.stat(full);
        } catch {
          continue; // broken symlink target
        }
        isDir = stat.isDirectory();
        isFile = stat.isFile();
        if (isDir) continue; // never descend into a symlinked directory
      }
      if (isDir) {
        let stat;
        try {
          stat = await fs.promises.stat(full);
        } catch {
          continue;
        }
        if (visitedDirInodes.has(stat.ino)) continue;
        visitedDirInodes.add(stat.ino);
        await walk(full);
        continue;
      }
      if (!isFile) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      const relativePath = path.relative(baseDir, full).split(path.sep).join("/");
      if (!isUserNote(relativePath)) continue;
      candidates.push({ relativePath, absolutePath: full });
    }
  }

  await walk(baseDir);
  return candidates;
}

async function scanVault(dir) {
  let candidates;
  try {
    candidates = await walkForNoteCandidates(dir);
  } catch {
    return { nodes: [], links: [] };
  }
  const files = await runWithConcurrency(candidates, SCAN_READ_CONCURRENCY, async (candidate) => {
    try {
      const content = await fs.promises.readFile(candidate.absolutePath, "utf8");
      return { ...candidate, content };
    } catch {
      return null; // removed mid-scan, or unreadable — skip rather than fail the whole build (mirrors per-note try/catch for frontmatter)
    }
  });
  return parseVaultFiles(files.filter(Boolean));
}

// Main owns the graph data (design.md D3): scans `dir`, parses it into a
// position-free `{ nodes, links }` graph, caches the full (path-bearing)
// version in RAM, and serves a path-stripped copy to callers. Positions are
// owned by the renderer, never by this module. Modeled as a factory (like
// createCanvasStore) — closure state, no module-level singleton, so it is
// unit-testable and main.mjs can hold exactly one instance.
/**
 * @param {{ dir?: string, debounceMs?: number }} options
 */
export function createVaultGraph({ dir, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  if (!dir) throw new Error("createVaultGraph requires a dir");

  let cache = { nodes: [], links: [] }; // full graph, path-bearing — internal only
  let watcher = null;
  let debounceTimer = null;
  let stopped = true; // not watching by default; start() flips this
  let scanGeneration = 0; // bumped on stop() so a stale in-flight rebuild can detect it was cancelled (M-E)
  const updateListeners = new Set();

  // The renderer never sees a filesystem path (design.md D8/L-1) — that
  // field stays on the cached node object here, resolved only via
  // resolveNotePath (used by main.mjs's read-note handler).
  function toPublicGraph(graph) {
    return {
      nodes: graph.nodes.map(({ path: _path, relativePath: _relativePath, ...rest }) => rest),
      links: graph.links.map((link) => ({ ...link })),
    };
  }

  // Always performs a fresh scan (design.md: "Main rescans fully every fire
  // anyway") — independent of whether the watcher is running, so the first
  // `secondbrain:get-graph` on toggle-on returns current data even before
  // start() has fired a single rebuild.
  async function getGraph() {
    const graph = await scanVault(dir);
    cache = graph;
    return toPublicGraph(graph);
  }

  // Resolves a node id to its absolute path from the single cache (design.md
  // D8/L-1: "one map, not two") — never a renderer-supplied path. Returns
  // null for a ghost node, an unknown id, or a node whose file has since
  // been removed from the cache; the caller (main.mjs) treats null as
  // refuse-the-read.
  function resolveNotePath(id) {
    const node = cache.nodes.find((n) => n.id === id && !n.ghost);
    return node ? node.path : null;
  }

  function scheduleRebuild() {
    if (stopped || debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (stopped) return;
      const generation = ++scanGeneration;
      scanVault(dir)
        .then((graph) => {
          // Toggled off, or superseded by a newer scan, while this one was
          // in flight — never emit a stale graph-updated after stop() (M-E).
          if (stopped || generation !== scanGeneration) return;
          cache = graph;
          const payload = toPublicGraph(graph);
          for (const listener of updateListeners) listener(payload);
        })
        .catch(() => {
          // Best-effort rebuild; the existing cache remains authoritative.
        });
    }, debounceMs);
  }

  // Idempotent (M3): a no-op if already watching, so HUD open/close churn
  // can't stack fs.watch streams. Resolves the real path before watching
  // (design.md D8/H3) and no-ops (rather than throwing) if the vault
  // doesn't exist yet — the caller (main.mjs) is responsible for only
  // calling start() once the vault exists and the galaxy is actually open.
  function start() {
    if (!stopped) return;
    let realDir;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    try {
      watcher = fs.watch(realDir, { recursive: true }, () => scheduleRebuild());
      stopped = false;
    } catch {
      // e.g. a platform without recursive-watch support — freshness
      // degrades to rescan-on-open (getGraph) only (design.md M2).
      watcher = null;
    }
  }

  // Tears the watcher down, clears any pending debounce timer, and bumps
  // the generation guard so an in-flight rebuild can never emit after this
  // point (M-E) — safe to call even if never started.
  function stop() {
    stopped = true;
    scanGeneration++;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // best-effort
      }
      watcher = null;
    }
  }

  // Mirrors the onCanvasApply preload pattern: returns an unsubscribe
  // closure so the galaxy layer's useEffect can clean up on unmount (M4).
  function onUpdate(callback) {
    updateListeners.add(callback);
    return () => updateListeners.delete(callback);
  }

  return { getGraph, start, stop, onUpdate, resolveNotePath };
}
