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

/** Where ambient session capture's flushed conversation text lands (ambient-memory). */
export function sessionsSpoolDir(vaultDir) {
  return path.join(vaultDir, "inbox", "sessions");
}

/**
 * Where listen-only mode's meeting record lands (listen-mode-hears-system-
 * audio D7). A fourth area, inside `inbox/` like the other three, so
 * vault-graph-parse.mjs's existing `inbox/` exclusion keeps it out of the
 * galaxy with no new code — it matches on `segments[0]`, so any depth under
 * `inbox/` is already covered.
 */
export function meetingsSpoolDir(vaultDir) {
  return path.join(vaultDir, "inbox", "meetings");
}

/**
 * An ISO-8601 timestamp in the MACHINE'S OWN time zone, offset included —
 * `2026-08-06T09:30:15+07:00` rather than `toISOString()`'s `02:30:15Z`.
 *
 * Meeting records are read by the person who was in the meeting, so a UTC
 * timestamp is not merely inconvenient: for anyone east of Greenwich an early
 * meeting is filed under the PREVIOUS DAY, which breaks the one thing the
 * per-engagement record exists to support — finding, or deleting, the meeting
 * you recorded this morning. The offset is kept so the value stays unambiguous
 * to anything reading it later.
 */
export function localIsoString(date = new Date()) {
  const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, "0");
  // getTimezoneOffset() counts minutes WEST of UTC, so it is negated to read
  // as the "+07:00" an ISO offset expects.
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const offset = `${sign}${pad(Math.trunc(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
}

/**
 * One file per ENGAGEMENT of listen-only mode, not one per day like
 * spoolFileFor above. A meeting is not a day, and the whole argument for a
 * separate area is that a record must stay identifiable if consent is
 * withdrawn — appending two meetings into one file makes "delete the one I
 * recorded this morning" unanswerable.
 *
 * Named in local time (see localIsoString) so the name matches the clock the
 * user was watching. The offset is dropped from the basename — it carries a
 * colon, and a local name needs no qualifier — but it is kept in the record's
 * own header, so nothing that reads the file has to guess.
 */
export function meetingFileFor(date = new Date()) {
  return `meeting-${localIsoString(date).slice(0, 19).replace(/[:]/g, "-")}.md`;
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
  return appendSpoolRecordTo({ dir, name: spoolFileFor(now()), content, io });
}

/**
 * The same append, to a NAMED file rather than to today's — what meeting
 * retention needs, since its unit is one engagement of listen-only mode rather
 * than one day (see meetingFileFor above). Never rejects, on the same terms.
 *
 * @param {{ dir: string, name: string, content: string, io?: typeof fs }} input
 * @returns {Promise<{ ok: boolean, file?: string, error?: string }>}
 */
export async function appendSpoolRecordTo({ dir, name, content, io = fs }) {
  const file = path.join(dir, name);
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

// ---------------------------------------------------------------------------
// Structural edits between existing notes (shared-focus design D7): three
// enumerated named operations, each backed by a pure text transform so it is
// testable against a string with no filesystem involved — never a general
// "write this content to this note" primitive, which would be an arbitrary-
// write surface reachable from a model. The caller (electron/capabilities/
// second-brain.mjs) resolves note identities to paths and re-asserts the
// vault boundary before any of these ever see a path.

/** Escapes `text` for use inside a RegExp literal. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches a `[[targetId]]` wikilink, with or without a `|alias` or
// `#heading` suffix — the same shapes vault-graph-parse.mjs's own
// WIKILINK_RE resolves, so a link this module writes (or removes) is the
// exact shape the graph already parses. Target only, case-insensitive: note
// identities are matched case-insensitively when the graph builds them.
function wikilinkPattern(targetId, flags = "i") {
  return new RegExp(`\\[\\[${escapeRegExp(targetId)}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, flags);
}

/** True when `markdown` already contains a wikilink to `targetId`. */
export function hasWikilink(markdown, targetId) {
  return wikilinkPattern(targetId).test(markdown);
}

/**
 * Appends `[[targetId]]` to `markdown`, unless a link to it is already
 * present — a repeated link request is not an error and must not duplicate
 * text (spec: "An already-present link is not duplicated").
 */
export function withLinkedNote(markdown, targetId) {
  if (hasWikilink(markdown, targetId)) return markdown;
  const trimmed = markdown.replace(/\s+$/, "");
  return `${trimmed}\n\n[[${targetId}]]\n`;
}

/** Removes every wikilink to `targetId` from `markdown`, tidying up the blank lines it leaves behind. */
export function withoutLinkedNote(markdown, targetId) {
  return markdown
    .replace(wikilinkPattern(targetId, "gi"), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Rewrites `markdown`'s frontmatter `tags` field to `tags`, preserving the
 * body and every other frontmatter field untouched. Malformed frontmatter is
 * reported rather than guessed at or corrupted (spec: "a note with malformed
 * frontmatter is reported rather than corrupted").
 * @returns {{ ok: true, content: string } | { ok: false, error: string }}
 */
export function withTags(markdown, tags) {
  let parsed;
  try {
    parsed = matter(markdown);
  } catch (error) {
    return { ok: false, error: `Malformed frontmatter: ${/** @type {Error} */ (error).message}` };
  }
  const data = { ...parsed.data, tags: [...tags] };
  return { ok: true, content: matter.stringify(parsed.content, data) };
}

/** Reads `filePath`, resolving `{ ok: false, error }` instead of rejecting. */
async function readNote(filePath) {
  try {
    return { ok: true, content: await fs.promises.readFile(filePath, "utf8") };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}

/**
 * Links two existing notes to each other: inserts `[[idB]]` into `pathA` and
 * `[[idA]]` into `pathB`, atomically, idempotently. Both files are read
 * before either is written, so a note that cannot be read leaves the other
 * untouched rather than producing a one-directional link.
 * @param {{ pathA: string, idA: string, pathB: string, idB: string }} input
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function linkNotes({ pathA, idA, pathB, idB }) {
  const [a, b] = await Promise.all([readNote(pathA), readNote(pathB)]);
  if (!a.ok) return { ok: false, error: a.error };
  if (!b.ok) return { ok: false, error: b.error };
  try {
    await Promise.all([
      writeFileAtomicAsync(pathA, withLinkedNote(a.content, idB), "utf8"),
      writeFileAtomicAsync(pathB, withLinkedNote(b.content, idA), "utf8"),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}

/**
 * Removes the link between two notes in both directions. Mirrors
 * `linkNotes`'s all-or-nothing read, and reports success when the link was
 * already absent (nothing to do, not an error).
 * @param {{ pathA: string, idA: string, pathB: string, idB: string }} input
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function unlinkNotes({ pathA, idA, pathB, idB }) {
  const [a, b] = await Promise.all([readNote(pathA), readNote(pathB)]);
  if (!a.ok) return { ok: false, error: a.error };
  if (!b.ok) return { ok: false, error: b.error };
  try {
    await Promise.all([
      writeFileAtomicAsync(pathA, withoutLinkedNote(a.content, idB), "utf8"),
      writeFileAtomicAsync(pathB, withoutLinkedNote(b.content, idA), "utf8"),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}

/**
 * Replaces a note's tags in place.
 * @param {{ path: string, tags: string[] }} input
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function setNoteTags({ path: notePath, tags }) {
  const note = await readNote(notePath);
  if (!note.ok) return { ok: false, error: note.error };
  const rewritten = withTags(note.content, tags);
  if (!rewritten.ok) return rewritten;
  try {
    await writeFileAtomicAsync(notePath, rewritten.content, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message };
  }
}
