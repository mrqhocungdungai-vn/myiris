// The one module that owns writing to the second-brain vault (vault-write-path
// design D1). `run-inbox.mjs` keeps owning what a run record looks like and
// calls in here for the write; the capture tool (electron/capabilities/
// second-brain.mjs) calls in here directly. One writer means one place to
// change when the spool's location or naming moves — two independent writers
// into the same directory is how the `inbox/` galaxy exclusion got missed in
// the first place.
//
// Two spool-append shapes, deliberately (design D2): `appendSpoolRecordSync`
// preserves the run-finalize path's existing synchronous, never-throws
// contract verbatim; `appendSpoolRecord` is async so the capture tool's reply
// to Gemini reflects what actually happened on disk. Neither throws or
// rejects — both resolve `{ ok: false, error }` instead, because a full disk
// must never turn into an unhandled rejection in the main process.
//
// `createNotePage` is atomic (via atomic-file.mjs) because a page is parsed by
// the live `fs.watch` rebuild — a half-written page would be scanned as a
// malformed note. A half-written spool append is invisible to the graph
// (inbox/ is excluded, see vault-graph-parse.mjs), so an append needs no
// temp+rename.
//
// Electron-free; `fs` is injected so this is testable without touching disk.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { writeFileAtomicAsync } from "./atomic-file.mjs";

/** One file per day, so a spool is trivially readable and trivially bounded. */
export function spoolFileFor(date = new Date()) {
  const iso = date.toISOString().slice(0, 10);
  return `${iso}.md`;
}

/** Where a voice capture lands, awaiting curation (design D3). */
export function captureSpoolDir(vaultDir) {
  return path.join(vaultDir, "inbox", "captures");
}

/** Where a finished run's outcome record lands (run-inbox.mjs). */
export function runSpoolDir(vaultDir) {
  return path.join(vaultDir, "inbox", "runs");
}

/**
 * Appends `content` to today's spool file under `dir`, synchronously. Never
 * throws: bookkeeping must not be able to disturb work that has already
 * finished, and a full disk is not a reason to lose it. Reports the failure
 * through `onError` and the return value instead.
 *
 * @param {{ dir: string, content: string, now?: () => Date, io?: typeof fs, onError?: (error: Error) => void }} input
 * @returns {{ ok: boolean, file?: string, error?: string }}
 */
export function appendSpoolRecordSync({ dir, content, now = () => new Date(), io = fs, onError }) {
  const file = path.join(dir, spoolFileFor(now()));
  try {
    io.mkdirSync(dir, { recursive: true });
    io.appendFileSync(file, content, "utf8");
    return { ok: true, file };
  } catch (error) {
    onError?.(/** @type {Error} */ (error));
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}

/**
 * Appends `content` to today's spool file under `dir`, asynchronously — the
 * shape a request/response tool handler needs so its reply reflects what
 * actually happened on disk, rather than a model's claim of success. Never
 * rejects: resolves `{ ok: false, error }` instead.
 *
 * @param {{ dir: string, content: string, now?: () => Date, io?: typeof fs }} input
 * @returns {Promise<{ ok: boolean, file?: string, error?: string }>}
 */
export async function appendSpoolRecord({ dir, content, now = () => new Date(), io = fs }) {
  const file = path.join(dir, spoolFileFor(now()));
  try {
    await io.promises.mkdir(dir, { recursive: true });
    await io.promises.appendFile(file, content, "utf8");
    return { ok: true, file };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}

// A model-supplied title arrives from something that heard audio through a
// microphone; it is not a filename (design D8). Keeps letters/numbers in any
// script (so a Vietnamese title is not mangled), spaces, underscores, and
// hyphens; everything else — path separators, "..", a null byte, colons,
// quotes — becomes a hyphen, which also means a traversal sequence like
// "../../etc/passwd" can never reassemble into one.
function sanitizeTitle(rawTitle) {
  const safe = String(rawTitle ?? "")
    .replace(/[^\p{L}\p{N} _-]/gu, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return safe || "Untitled";
}

/**
 * Writes a curated note page: YAML frontmatter (title, tags, date) plus body,
 * atomically (temp+rename), so the live vault watcher never scans a
 * half-written page as malformed. The title is sanitized to a safe basename
 * and the resolved path is asserted inside the vault before writing — the
 * same discipline `secondbrain:read-note` applies on the read side.
 *
 * @param {{ vaultDir: string, title: string, tags?: string[], body?: string, now?: () => Date }} input
 * @returns {Promise<{ ok: boolean, file?: string, error?: string }>}
 */
export async function createNotePage({ vaultDir, title, tags = [], body = "", now = () => new Date() }) {
  const safeTitle = sanitizeTitle(title);
  const resolvedVault = path.resolve(vaultDir);
  const resolvedFile = path.resolve(resolvedVault, `${safeTitle}.md`);
  if (resolvedFile !== resolvedVault && !resolvedFile.startsWith(resolvedVault + path.sep)) {
    return { ok: false, error: "resolved note path escapes the vault" };
  }
  const content = matter.stringify(body, { title: safeTitle, tags, date: now().toISOString() });
  try {
    await fs.promises.mkdir(resolvedVault, { recursive: true });
    await writeFileAtomicAsync(resolvedFile, content, "utf8");
    return { ok: true, file: resolvedFile };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}
