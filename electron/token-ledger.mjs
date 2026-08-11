// The token account (token-accounting): what each of the two paid engines has
// reported consuming this app session. Pure and Electron-free — the clock is
// injected, and there is no timer here at all (the throttle that keeps a burst
// of Live messages from becoming a burst of IPC belongs to
// electron/capabilities/token-usage.mjs, which owns the lifecycle).
//
// EVERY absence is `null` — the same one rule system-telemetry.mjs states in its
// header, for the same reason. An engine that has reported nothing has
// `total: null`, never `0`: zero is a real value once an engine has reported
// (an exchange that consumed nothing countable), and absence is the ordinary
// state of the build engine when no Claude credential is configured. Rendering
// that as `0` asserts a measurement nobody took.
//
// Nothing downstream may read these numbers. They reach the renderer's camera
// overlays and the diagnostic log, and stop — no prompt, no verb, no run, no
// spoken answer, no session store. The spec requires it, and the reason is
// sharper than it is for host telemetry: a model that can see its own
// consumption starts reasoning about it. The mechanism that acts on spend
// already exists and is enforced in configuration — run-budget's turn and spend
// ceilings, and the `limited` terminal status.

/** A number that is actually a number, or 0. Never NaN, never a string coerced. */
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Whether any of the named keys carries a real number — "did the engine report at all". */
function anyNumeric(source, keys) {
  if (!source || typeof source !== "object") return false;
  return keys.some((key) => typeof source[key] === "number" && Number.isFinite(source[key]));
}

const GEMINI_PARTS = ["promptTokenCount", "responseTokenCount", "thoughtsTokenCount", "toolUsePromptTokenCount"];

/**
 * @param {{
 *   now?: () => number,
 *   onChange?: (snapshot: any) => void,
 * }} [deps]
 */
export function createTokenLedger({ now = () => Date.now(), onChange = () => {} } = {}) {
  // `at` is load-bearing beyond display: it is the event signal the ring's
  // alert detects a finished run by, so it is the time that account last
  // CHANGED and is never rewritten when nothing changed. A rewrite on an
  // unchanged account would fire the badge for an event that did not happen.
  const gemini = {
    total: /** @type {number|null} */ (null),
    last: /** @type {number|null} */ (null),
    at: /** @type {number|null} */ (null),
  };
  const claude = {
    total: /** @type {number|null} */ (null),
    last: /** @type {number|null} */ (null),
    cacheRead: /** @type {number|null} */ (null),
    at: /** @type {number|null} */ (null),
  };

  // The dual-regime accumulator's state (design D3). The Live API does not
  // state whether `totalTokenCount` is per-message or cumulative for the
  // session, observed behaviour differs across model versions, and this repo
  // pins one model that will eventually move — so nothing here assumes which
  // it is receiving.
  let lastTotal = 0;
  let carried = 0;

  // Idempotence by run id (spec: "One unit of work counts once"). A second
  // observation of the same finished run cannot double its tokens, and cannot
  // move `claude.at` — which would announce one run twice.
  const countedRuns = new Set();

  /**
   * Flat scalars, structured-clone-trivial: this crosses the IPC boundary as-is,
   * so nothing here may be a Date, a Map, or a getter.
   */
  function snapshot() {
    return {
      gemini: { total: gemini.total, last: gemini.last, at: gemini.at },
      claude: { total: claude.total, last: claude.last, cacheRead: claude.cacheRead, at: claude.at },
    };
  }

  /**
   * The voice engine reported usage.
   *
   * Correct under both regimes without being told which it is receiving
   * (design D3): a reading at or above the last one is cumulative, a reading
   * below it means the counter restarted or the figures are per-exchange. Both
   * come out monotone by construction — which is the property that matters
   * most, because Live sessions rotate on a connection lifetime limit during
   * ordinary use and a total dropping to zero mid-conversation would read as a
   * bug in the panel rather than as a new socket.
   */
  function recordGeminiUsage(usageMetadata) {
    if (!usageMetadata || typeof usageMetadata !== "object") return;

    // A message with no numeric figure at all is ignored rather than recorded
    // as a zero (spec: "Nothing is invented"). `totalTokenCount` when the API
    // sends it; otherwise the parts, read defensively so a missing key
    // contributes 0 and never NaN.
    const hasTotal = typeof usageMetadata.totalTokenCount === "number" && Number.isFinite(usageMetadata.totalTokenCount);
    if (!hasTotal && !anyNumeric(usageMetadata, GEMINI_PARTS)) return;
    const reading = Math.max(
      0,
      hasTotal ? usageMetadata.totalTokenCount : GEMINI_PARTS.reduce((sum, key) => sum + num(usageMetadata[key]), 0),
    );

    if (reading < lastTotal) {
      // The counter went backwards: a rotated socket, a resumed session, or
      // per-exchange figures. Everything counted so far is banked rather than
      // dropped or re-counted, which is the whole reason this is not a plain
      // sum and not a plain assignment.
      carried += lastTotal;
      console.log(`[IRIS][tokens] gemini counter restarted (banked ${carried}) — new socket or per-message figures`);
    }
    lastTotal = reading;
    const next = carried + reading;

    // Unchanged means unchanged: no timestamp, no emit. A repeated identical
    // cumulative reading is the ordinary case on a quiet socket.
    if (gemini.total !== null && next === gemini.total) return;
    gemini.last = next - (gemini.total ?? 0);
    gemini.total = next;
    gemini.at = now();
    onChange(snapshot());
  }

  /**
   * A finished run reported its usage.
   *
   * Called once per run at the queue's `onFinalized` seam, whatever the
   * terminal status is — `limited`, `unanswered` and `failed` runs spent tokens
   * too, and an account that counts only successes understates precisely the
   * runs a user most wants to see.
   *
   * `run.usage.usage` rather than `run.usage`: runUsageFrom
   * (electron/claude-stream.mjs) nests the SDK's passthrough of the API shape
   * one level under `usage`, alongside cost and turn count.
   */
  function recordClaudeRun(run) {
    if (!run || typeof run !== "object") return;
    const runId = typeof run.run_id === "string" && run.run_id ? run.run_id : null;
    if (runId && countedRuns.has(runId)) return;

    const usage = run.usage?.usage;
    // No usage means nothing to count and no id to remember — a run whose
    // usage arrives later must still be countable when it does.
    if (!usage || typeof usage !== "object") return;

    // Cache reads routinely exceed everything else by an order of magnitude
    // while costing a fraction per token, so they are their own figure and
    // never enter the headline (design D5). Folding them in would make the
    // headline climb far faster than consumption actually rises, which defeats
    // the reason the account is kept in tokens rather than in currency.
    const headline = num(usage.input_tokens) + num(usage.output_tokens) + num(usage.cache_creation_input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);

    if (runId) countedRuns.add(runId);
    claude.total = (claude.total ?? 0) + headline;
    claude.last = headline;
    claude.cacheRead = (claude.cacheRead ?? 0) + cacheRead;
    // A counted run always stamps `at`: the run IS the event, and a run that
    // consumed nothing countable still finished. Idempotence above is what
    // keeps one run from stamping it twice.
    claude.at = now();

    // The one thing written to disk for any of this (design D9). The panel
    // exists only while the camera is on, so without this line a session's
    // consumption is unrecoverable the moment the window closes — and the
    // diagnostic log is documented as where an investigation goes. Nothing
    // reads it programmatically.
    console.log(
      `[IRIS][tokens] claude run=${runId || "(no id)"} status=${run.status || "(none)"} ` +
        `verb=${run.verb || "(none)"} tokens=${headline} cacheRead=${cacheRead} total=${claude.total}`,
    );
    onChange(snapshot());
  }

  return { snapshot, recordGeminiUsage, recordClaudeRun };
}
