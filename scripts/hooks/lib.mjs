// Shared plumbing for the Claude Code hook scripts.
//
// Every hook here follows the same contract: read the event JSON from stdin,
// decide, and exit 0 (proceed) or 2 (block, with stderr returned to the agent as
// correctable feedback). Any other non-zero code is a hook malfunction, which
// Claude Code surfaces to the user without blocking — so a failure that MUST
// block is always exit 2.
//
// The gates themselves live in scripts/gates.mjs and are imported directly, not
// spawned: three Node startups cost 276ms of a 572ms hook when they were.
//
// See the `workflow-quality-gates` capability spec.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Read and parse the hook event JSON from stdin. Never throws. */
export function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    // A hook that cannot read its input must not block work it cannot assess.
    return {};
  }
}

/**
 * Per-session ledger of files written during the current turn.
 *
 * The Stop event does not report which files changed, so PostToolUse records
 * them and Stop reads them back. Kept in the OS temp directory rather than the
 * repo, so an abandoned session leaves nothing behind that git or the app can
 * trip over, and keyed by session id so concurrent sessions cannot collide.
 */
export function ledgerPath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(os.tmpdir(), `iris-gate-ledger-${safe || "unknown"}.txt`);
}

/** Block the workflow step, returning the reason to the agent. */
export function block(lines) {
  for (const line of [].concat(lines)) {
    if (line) console.error(line);
  }
  process.exit(2);
}
