// The diagnostic log's writer (diagnostic-logging): JSONL to disk, rotated by
// size, redacted unconditionally.
//
// Electron-free — the filesystem and the clock are injected, so the rotation
// boundary and every redaction shape are tested against a fake disk rather than
// a real one.
//
// This module exists so that a failure in a packaged build can be looked at
// AFTERWARDS. Everything in it follows from that: writes are synchronous
// because the records immediately before a crash are the ones worth having,
// redaction is unconditional because the file is meant to be shared, and every
// stage is wrapped because a log that can take the app down is worse than no
// log at all.
import fs from "node:fs";
import path from "node:path";

/** Ordered, and the file's default is the bottom of it — everything (D7). */
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_KEEP = 4;
/** So the shipped bound is 5 files × 4 MB = 20 MB, stated in .env.example. */
export const LOG_BASENAME = "iris.log";

function rank(level) {
  const known = LEVEL_RANK[String(level).toLowerCase()];
  // Unknown ranks as info rather than as beneath everything, so a level added
  // later shows up rather than being silently dropped from the one record that
  // was supposed to explain a failure.
  return known === undefined ? LEVEL_RANK.info : known;
}

// ---------------------------------------------------------------------------
// Redaction (D4). Unconditional, applied here rather than at the sources,
// because the sources include output this app did not write — a dependency
// printing a token is the case that cannot be fixed upstream, and therefore the
// case this exists for.
//
// It fails toward masking. A log made harder to read is recoverable; a
// credential written to a file that is then pasted into a bug report is not,
// and the whole point of this capability is that the file gets shared.
// ---------------------------------------------------------------------------

const MASK = "[redacted]";

// ORDER MATTERS, and it is the reason these are a list rather than one pattern.
// `Bearer` has to run before the name=value rule: against
// `Authorization: Bearer <token>` the name rule matches first, treats the word
// "Bearer" as the value, masks THAT, and leaves the token in the log.
const REDACTIONS = [
  // Bearer tokens, wherever they appear. First, per the note above.
  /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
  // Provider-shaped keys, matched by their own prefix so they are caught
  // wherever they appear — in prose, inside JSON, in a dependency's output.
  // The character class INCLUDES `-` and `_`: real keys are segmented
  // (`sk-ant-api03-…`, `sk-proj-…`), and a class of only letters and digits
  // stops at the first hyphen and then fails the length test.
  /\b(sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{10,})\b/g,
  // `NAME=value` and `"name": "value"` where the name looks like a secret. The
  // name is kept — knowing WHICH credential was involved is often the whole
  // diagnostic — and only the value goes.
  /((?:api[_-]?key|token|secret|password|passwd|authorization|auth[_-]?token|credential)["']?\s*[:=]\s*["']?)([^\s"',}]{4,})/gi,
  // A JWT is unmistakable and never belongs in a log.
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
];

/**
 * Mask anything that looks like a credential.
 *
 * The masked form SAYS something was removed: a reader has to be able to tell
 * "no token was present" from "a token was here", or the redaction is
 * indistinguishable from the line never having contained one.
 *
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  let out = String(text);
  // Patterns 0 and 2 keep their leading group — the `Bearer `, the key name —
  // and replace only what follows. Patterns 1 and 3 are the whole credential.
  out = out.replace(REDACTIONS[0], (_match, prefix) => `${prefix}${MASK}`);
  out = out.replace(REDACTIONS[1], MASK);
  out = out.replace(REDACTIONS[2], (_match, prefix) => `${prefix}${MASK}`);
  out = out.replace(REDACTIONS[3], MASK);
  return out;
}

/**
 * One record as a JSONL line.
 *
 * `src` is required rather than decorative: after the tee has merged the app's
 * own diagnostics with whatever its dependencies printed, this is the only
 * thing telling a reader which is which (D2).
 *
 * @param {{ at: string, level: string, src: string, msg: string, [key: string]: any }} record
 * @returns {string}
 */
export function formatRecord(record) {
  // JSON encoding is the reason this format was chosen: a captured line can
  // carry a stack trace or an embedded newline, and in a plain-text log that
  // breaks the one invariant a reader needs — that a line is a record.
  return `${JSON.stringify(record)}\n`;
}

/**
 * @param {{
 *   dir?: string,
 *   io?: typeof fs,
 *   now?: () => Date,
 *   maxBytes?: number,
 *   keep?: number,
 *   level?: string,
 *   enabled?: boolean,
 *   basename?: string,
 *   onFault?: (message: string) => void,
 * }} deps
 */
export function createLogSink({
  dir,
  io = fs,
  now = () => new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
  keep = DEFAULT_KEEP,
  level = "debug",
  enabled = true,
  basename = LOG_BASENAME,
  // Reported to the STREAM, never to the log — reporting a write failure by
  // attempting the write that just failed is a loop with a disk error in it.
  onFault = (message) => {
    try {
      process.stderr.write(`${message}\n`);
    } catch {
      // Nothing is reading. That is the one situation this module must be
      // completely silent about.
    }
  },
} = {}) {
  const threshold = rank(level);
  const file = path.join(dir, basename);

  /** @type {number | null} */
  let fd = null;
  let bytes = 0;
  let live = Boolean(enabled);
  /** A fault disables for the session and reports ONCE, never per failure (D6). */
  let faulted = false;

  function fault(what, error) {
    live = false;
    if (faulted) return;
    faulted = true;
    if (fd !== null) {
      try {
        io.closeSync(fd);
      } catch {
        // Already gone; nothing to salvage.
      }
      fd = null;
    }
    onFault(`[IRIS][log] disabled — could not ${what}: ${error?.message ?? error}`);
  }

  /** @returns {boolean} whether the descriptor is usable */
  function ensureOpen() {
    if (!live) return false;
    if (fd !== null) return true;
    try {
      io.mkdirSync(dir, { recursive: true });
      fd = io.openSync(file, "a");
      // Append mode means the existing file's size counts toward rotation — a
      // restart must not reset the budget, or a crash loop grows the file
      // without bound one session at a time.
      bytes = io.existsSync(file) ? io.statSync(file).size : 0;
      return true;
    } catch (error) {
      fault("open the log", error);
      return false;
    }
  }

  /**
   * Rename aside and start fresh, dropping anything past `keep` (D5).
   * `iris.log` → `iris.1.log` → … → `iris.<keep>.log` → deleted.
   */
  function rotate() {
    try {
      if (fd !== null) {
        io.closeSync(fd);
        fd = null;
      }
      // Walk DOWN so each rename lands on a slot the previous step just freed.
      for (let index = keep; index >= 1; index -= 1) {
        const from = index === 1 ? file : path.join(dir, `iris.${index - 1}.log`);
        const to = path.join(dir, `iris.${index}.log`);
        if (!io.existsSync(from)) continue;
        if (index === keep) {
          try {
            io.unlinkSync(to);
          } catch {
            // Not there yet; the rename below creates it.
          }
        }
        io.renameSync(from, to);
      }
      bytes = 0;
    } catch (error) {
      fault("rotate the log", error);
    }
  }

  /**
   * Write one record. Never throws.
   *
   * @param {{ level?: string, src?: string, msg?: string, [key: string]: any }} record
   */
  function write(record) {
    if (!live) return;
    const recordLevel = String(record?.level ?? "info");
    if (rank(recordLevel) < threshold) return;
    if (!ensureOpen()) return;

    let line;
    try {
      const { level: _level, src, msg, at: _at, ...rest } = record ?? {};
      // Redaction happens HERE, on the assembled record, so no source can
      // bypass it and no future caller has to remember it (D4).
      //
      // The four known fields are written FIRST so a line stays readable when
      // it is read the way it usually will be — with eyes, in a terminal, not
      // through a parser.
      line = redact(
        formatRecord({
          at: now().toISOString(),
          level: recordLevel,
          src: String(src ?? "app"),
          msg: String(msg ?? ""),
          ...rest,
        }),
      );
    } catch (error) {
      // A record that cannot even be serialized (a circular structure reaching
      // this from a caller's extra fields) must not take the sink with it.
      fault("format a record", error);
      return;
    }

    try {
      const chunk = Buffer.from(line, "utf8");
      io.writeSync(/** @type {number} */ (fd), chunk);
      bytes += chunk.length;
    } catch (error) {
      fault("write the log", error);
      return;
    }

    // After the write, not before: a record accepted for writing is never lost
    // to rotation (spec: "Rotation SHALL NOT lose records that were accepted").
    if (bytes >= maxBytes) rotate();
  }

  function close() {
    if (fd === null) return;
    try {
      io.closeSync(fd);
    } catch {
      // Shutting down anyway.
    }
    fd = null;
  }

  return {
    write,
    close,
    isEnabled: () => live,
    currentFile: () => file,
  };
}

/**
 * Resolve the sink's configuration from the environment.
 *
 * Defaults record EVERYTHING at EVERY level in BOTH build modes (D7) — the
 * opposite of the camera strip's rule, and deliberately not coupled to it. A
 * displayed log is a glance and can decide in advance what is interesting; a
 * written log is an investigation, and that decision cannot be taken before the
 * failure it has to explain.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function logConfigFromEnv(env = process.env) {
  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    // Off is explicit and narrow: only "0" and "off" disable it, so a typo
    // leaves logging ON rather than silently removing the thing a user is
    // relying on to explain a failure.
    enabled: !["0", "off", "false"].includes(String(env.IRIS_LOG ?? "").toLowerCase()),
    level: String(env.IRIS_LOG_LEVEL ?? "debug").toLowerCase(),
    maxBytes: number(env.IRIS_LOG_MAX_BYTES, DEFAULT_MAX_BYTES),
    keep: number(env.IRIS_LOG_KEEP, DEFAULT_KEEP),
  };
}
