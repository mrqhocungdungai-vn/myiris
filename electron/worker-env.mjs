// Shared by both role workers (harden-security-boundaries D12): a worker
// subprocess or SDK session gets an environment derived from the parent by
// subtraction, never the parent environment passed through unchanged. A
// worker runs with `bypassPermissions`, has shell and network access with no
// approval prompt, and routinely processes content it did not author — any
// secret sitting in its environment is one `echo $VAR` away from leaving the
// machine. DEV's spawn (main.mjs) and PO's Agent SDK session
// (po-session.mjs) both route through this so the two cannot drift apart.
export function computeWorkerEnv(baseEnv, excludeKeys) {
  const env = { ...baseEnv };
  for (const key of excludeKeys) delete env[key];
  return env;
}

// The single credential policy both roles run under. DEV used to strip
// CLAUDE_CODE_OAUTH_TOKEN on the grounds that `claude -p` authenticated through
// its own /login credential store and never read the env var. That stopped being
// true when Iris began shipping the CLI itself: a bundled binary inside a
// packaged .app has no host /login store to fall back on, so withholding the
// token would leave DEV with no way to authenticate at all.
//
// What survives from the old policy is the part that was about least privilege
// rather than mechanism (harden-security-boundaries D12): a worker runs with
// bypassPermissions, has shell and network access with no approval prompt, and
// routinely processes content it did not author, so it gets only the credentials
// it actually needs.
//
// - GEMINI_API_KEY is always withheld: it is the voice credential and no role
//   has any use for it.
// - A subscription token, when present, wins — the API keys are stripped so a
//   stray ANTHROPIC_API_KEY cannot silently switch the user onto metered
//   billing. This is PO's long-standing rule, now applied to DEV too.
// - With no subscription token, ANTHROPIC_API_KEY is left in place as the
//   metered fallback, which is the only credential an API-key-only user has.
export function computeClaudeWorkerEnv(baseEnv) {
  const excluded = ["GEMINI_API_KEY"];
  if (baseEnv.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    excluded.push("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN");
  }
  return computeWorkerEnv(baseEnv, excluded);
}
