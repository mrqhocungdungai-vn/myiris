// Capture what the main process already writes (diagnostic-logging D1), by
// wrapping `process.stdout.write` / `process.stderr.write`.
//
// A sibling of stdio-resilience.mjs in both placement and reasoning: those two
// streams are already treated as the seam where main's diagnostics can be
// reached without touching a single call site.
//
// The alternative — importing a logger at each of the dozen `console.log` sites
// — was rejected because it changes a dozen modules for a concern none of them
// has, and because it can only ever capture what somebody remembered to
// convert. A dependency printing a warning is the line most worth having and
// the one that route can never reach.
//
// Electron-free and dependency-free (main-process-structure).

/** Marks a stream as already wrapped, so a second install cannot stack. */
const INSTALLED = Symbol.for("iris.logTee.installed");

/**
 * Wrap one stream's `write`, emitting complete lines to `onLine`.
 *
 * THREE THINGS THIS MUST NOT DO, each of which would be a behavior change in
 * the app for the log's benefit:
 *
 * 1. Change what reaches the original destination. The original `write` is
 *    called with exactly what it was given.
 * 2. Change what the caller sees. `write` returns a backpressure boolean the
 *    caller may act on, so the original's return value is passed straight back.
 * 3. Throw. A fault in the capture must cost the capture and nothing else, so
 *    the tap is wrapped and the original call happens regardless.
 *
 * A write is not a line: one call may carry several lines, or half of one, so
 * completed lines are emitted and any remainder is held until it completes or
 * until `uninstall` flushes it.
 *
 * @param {any} stream
 * @param {(line: string) => void} onLine
 * @returns {(() => void) | null} uninstall, or null if this stream was unusable or already wrapped
 */
export function teeStream(stream, onLine) {
  if (!stream || typeof stream.write !== "function") return null;
  if (stream[INSTALLED] === true) return null;

  // The ORIGINAL function object, unbound, and called with `.call(stream, …)`
  // below. `.bind()` would create a new function, so uninstall would restore a
  // copy rather than what was there — indistinguishable in behavior, but it
  // makes "did anything wrap this?" unanswerable by identity, which is exactly
  // what uninstall has to answer.
  const original = stream.write;
  let pending = "";

  function emit(text) {
    pending += text;
    let cut = pending.indexOf("\n");
    while (cut !== -1) {
      const line = pending.slice(0, cut);
      pending = pending.slice(cut + 1);
      if (line.length > 0) onLine(line);
      cut = pending.indexOf("\n");
    }
  }

  const wrapped = function write(chunk, encoding, callback) {
    try {
      // A Buffer is the common case for a piped stream; an explicit encoding
      // only matters for a Buffer, and `toString()` defaults to utf8 for the
      // string case where the argument is irrelevant.
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString(/** @type {BufferEncoding} */ (typeof encoding === "string" ? encoding : "utf8"))
            : String(chunk ?? "");
      emit(text);
    } catch {
      // The capture failed. The write below must still happen — that is the
      // whole point of the ordering.
    }
    return original.call(stream, chunk, encoding, callback);
  };

  stream.write = wrapped;
  stream[INSTALLED] = true;

  return function uninstall() {
    // Only restore what we installed: if something else wrapped `write` after
    // us, replacing it would silently unhook that instead.
    if (stream.write === wrapped) stream.write = original;
    stream[INSTALLED] = false;
    if (pending.length > 0) {
      const remainder = pending;
      pending = "";
      try {
        onLine(remainder);
      } catch {
        // Nothing left to salvage; we are tearing down.
      }
    }
  };
}

/**
 * Capture both of the main process's output streams.
 *
 * `onLine` receives `(line, src)` where `src` names which stream it came from —
 * the spec requires a reader be able to tell the app's own account from a
 * dependency's output, and after this merge they arrive through the same door.
 *
 * @param {{ stdout?: any, stderr?: any, onLine: (line: string, src: string) => void }} deps
 * @returns {() => void} uninstall everything this call installed
 */
export function installLogTee({ stdout = process.stdout, stderr = process.stderr, onLine }) {
  const uninstalls = [
    teeStream(stdout, (line) => onLine(line, "main.stdout")),
    teeStream(stderr, (line) => onLine(line, "main.stderr")),
  ].filter(Boolean);
  return () => {
    for (const uninstall of uninstalls) uninstall();
  };
}
