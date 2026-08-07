// Keep a dead stdout from killing the main process.
//
// The main process logs diagnostics with console.log/console.error (see
// renderer-bridge.mjs's emitEvent, which logs every gemini_status and
// sidecar_status). Under `npm run dev` those streams are PIPES, not a terminal:
// concurrently owns the read end. When the read end goes away — the terminal
// window is closed, the dev runner is killed, the log is piped into something
// that exits — the next write fails with EPIPE.
//
// Node surfaces that as an 'error' event on the stream, and a stream error with
// no listener becomes an uncaught exception. So a broken pipe does not merely
// lose a log line: it takes down the main process and shows the user Electron's
// "A JavaScript error occurred in the main process" dialog. The app was working
// fine; only its logging destination went away.
//
// Losing log output when nothing is reading it is correct. Crashing over it is
// not — so the write error is swallowed and everything else is left to the
// normal handler, because an error that is NOT a broken pipe still deserves to
// be loud.
//
// Electron-free and dependency-free (main-process-structure).

/** Write errors that mean "nothing is reading this any more", not "something is wrong". */
const BROKEN_PIPE_CODES = Object.freeze(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]);

/**
 * Whether a stream error is a broken pipe rather than a real fault.
 *
 * Takes `unknown` because what lands in a stream's 'error' event is whatever was
 * emitted — usually a Node system error carrying `code`, but not always, and a
 * plain Error has no `code` at all.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isBrokenPipe(error) {
  const code = /** @type {{ code?: unknown } | null} */ (error)?.code;
  return BROKEN_PIPE_CODES.includes(String(code ?? ""));
}

/**
 * Attach a broken-pipe-tolerant error listener to each stream.
 *
 * Idempotent per stream, so calling it twice cannot install two listeners and
 * cannot exhaust the default max-listeners budget.
 *
 * A non-broken-pipe error is re-thrown asynchronously rather than swallowed:
 * re-throwing inside the listener would be caught by the same stream machinery,
 * so it is handed to the process's uncaught path instead, which is where a real
 * write fault belongs.
 *
 * Takes `unknown[]` rather than a stream type on purpose: it is called with
 * `process.stdout`/`process.stderr`, which are not guaranteed to be streams at
 * all — under some launch modes they can be null — so entries are filtered at
 * runtime rather than assumed by the signature.
 *
 * @param {unknown[]} streams
 * @param {{ rethrow?: (error: unknown) => void }} [deps] injectable for tests
 * @returns {number} how many streams had a listener installed
 */
export function ignoreBrokenPipe(streams, { rethrow = defaultRethrow } = {}) {
  let installed = 0;
  for (const candidate of streams) {
    const stream = /** @type {{ on: Function } & Record<PropertyKey, unknown>} */ (candidate);
    if (!stream || typeof stream.on !== "function") continue;
    if (stream[INSTALLED] === true) continue;
    stream[INSTALLED] = true;
    stream.on("error", (error) => {
      if (isBrokenPipe(error)) return;
      rethrow(error);
    });
    installed += 1;
  }
  return installed;
}

const INSTALLED = Symbol.for("iris.stdioResilience.installed");

function defaultRethrow(error) {
  setImmediate(() => {
    throw error;
  });
}
