// The token-usage capability (token-accounting): the lifecycle and the
// renderer-facing surface for the account of what each paid engine has
// consumed. token-ledger.mjs does the counting; this owns when its figures are
// pushed and where they go — the same split hud-telemetry.mjs makes with
// system-telemetry.mjs, and registered here for the same reason: capability
// channels register by iteration, so ipc.mjs, main.mjs and wiring.mjs stay
// untouched.
//
// Contributes neither a tool declaration nor a prompt fragment, on the same
// terms hud-telemetry.mjs does — and here that is not merely incidental. The
// spec forbids the account reaching any prompt, verb or tool surface at all: a
// model that can see its own consumption starts reasoning about it, and the
// mechanism that acts on spend is run-budget's ceilings, enforced in
// configuration rather than by instruction.
//
// COUNTING IS NEVER GATED; ONLY THE PUSH IS (design D6). Host sampling is gated
// on the camera because each probe spawns a subprocess. That reasoning does not
// transfer: these figures arrive inside messages the app has already received
// and parsed, so counting them costs a field read and an addition — and a
// counter that only started when the camera came on would under-report every
// session, invisibly, because the figure would be self-consistent and wrong.
import { createTokenLedger } from "../token-ledger.mjs";
import { createTrailingThrottle } from "../coalesce.mjs";

/**
 * A burst of Live messages must not become a burst of IPC. Long enough that a
 * talkative second costs one emit, short enough that the panel still reads as
 * live — the panel's own frame loop is what makes the figure appear promptly,
 * not this interval.
 */
export const EMIT_THROTTLE_MS = 500;

/**
 * @param {{
 *   emitToRenderer: (channel: string, payload: any) => void,
 *   getMainWindow: () => any,
 *   createLedger?: typeof createTokenLedger,
 * }} deps
 */
export function createTokenUsageCapability({ emitToRenderer, getMainWindow, createLedger = createTokenLedger }) {
  // The throttle is constructed before the ledger because the ledger's onChange
  // needs it; its own body reads `ledger` only when the timer fires, which is
  // always after construction. The same late-binding shape wiring.mjs uses.
  const push = createTrailingThrottle(() => {
    // The renderer can be gone without its React cleanup ever having run — a
    // reload, a crashed frame. Dropping the emit is the whole response: unlike
    // the sampler, there is nothing here to stop, because counting continues
    // regardless of whether anything is displaying it.
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    emitToRenderer("token-usage:update", ledger.snapshot());
  }, EMIT_THROTTLE_MS);

  const ledger = createLedger({ onChange: () => push.schedule() });

  /** @type {Array<{ channel: string, kind: "handle"|"on", fn: Function }>} */
  const ipcHandlers = [
    // The snapshot handle is what makes the display gate harmless (design D6).
    // Without it, a panel opened after an hour of conversation would show an
    // apparent fresh start until the next message landed.
    { channel: "token-usage:snapshot", kind: "handle", fn: () => ledger.snapshot() },
    // A plain "the renderer is watching now" marker. Deliberately NOT a gate on
    // counting, and there is no deactivate: an emit to a gone window is already
    // dropped above, and the account is not the renderer's to stop.
    { channel: "token-usage:subscribe", kind: "on", fn: () => push.schedule() },
  ];

  function teardown() {
    // Nothing to flush. The account is per app session and deliberately not
    // persisted (design D6/D11): persisting would put a durable record of usage
    // on disk that nothing in the app needs, and would raise a "since when?"
    // question the panel has no room to answer.
    push.cancel();
  }

  return {
    toolDeclarations: [],
    ipcHandlers,
    teardown,
    // The two feeders: the Live message handler and the run queue's onFinalized
    // seam. Nothing else calls these.
    recordGeminiUsage: (usageMetadata) => ledger.recordGeminiUsage(usageMetadata),
    recordClaudeRun: (run) => ledger.recordClaudeRun(run),
    // Exposed for the capability's own tests; no other module calls this.
    snapshot: () => ledger.snapshot(),
  };
}
