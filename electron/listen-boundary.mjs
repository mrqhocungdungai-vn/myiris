// Chunk-boundary sequence for listening mode. See
// openspec/changes/add-listening-mode/design.md Decision 5 for why this
// exact ordering is measured, not aesthetic: closing the session before a
// FRESH resumable handle (one issued after THIS boundary's `activityEnd`)
// arrives loses the entire chunk, because the server issues no resumption
// checkpoint while an activity is open.
//
// `session` is an injected driver so this runs without a live Gemini
// connection (docs/TESTING.md's injected-dependencies convention) — main.mjs
// supplies the real one; tests supply a fake. Shape:
//   sendActivityEnd(): void
//   onTurnComplete(cb): unsubscribe — cb() called on the NEXT turnComplete
//   onFreshResumptionHandle(cb): unsubscribe — cb(handle) called on the NEXT
//     resumable handle. Subscribing here rather than reading a cached value
//     is what makes freshness structural: a handle from before this boundary
//     began was never pushed to a listener that didn't exist yet, so it
//     cannot satisfy this wait.
//   disconnect(): void
function waitForEvent(subscribe, timeoutMs, setTimeoutFn, clearTimeoutFn, onTimeout) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeoutFn(() => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      onTimeout?.();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = subscribe((value) => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(timer);
      resolve(value === undefined ? true : value);
    });
  });
}

/**
 * @param {any} session
 * @param {{
 *   turnCompleteTimeoutMs?: number,
 *   handleTimeoutMs?: number,
 *   setTimeoutFn?: typeof setTimeout,
 *   clearTimeoutFn?: typeof clearTimeout,
 *   onMissing?: (kind: string) => void,
 * }} [options]
 */
export async function runBoundary(
  session,
  {
    turnCompleteTimeoutMs = 8000,
    handleTimeoutMs = 8000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onMissing = () => {},
  } = {},
) {
  session.sendActivityEnd();

  const turnCompleted = await waitForEvent(session.onTurnComplete, turnCompleteTimeoutMs, setTimeoutFn, clearTimeoutFn, () =>
    onMissing("turnComplete"),
  );

  const handle = await waitForEvent(
    session.onFreshResumptionHandle,
    handleTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    () => onMissing("resumptionHandle"),
  );

  session.disconnect();

  return {
    turnCompleteMissing: !turnCompleted,
    handleMissing: !handle,
    handle: handle || null,
  };
}
