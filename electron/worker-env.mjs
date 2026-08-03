import os from "node:os";
import path from "node:path";

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

// Iris's own Claude Code state directory, kept away from the user's ~/.claude.
//
// `settingSources` is NOT the whole story: a handful of inputs are read and
// written regardless of it, and they all live under CLAUDE_CONFIG_DIR (default
// ~/.claude) — the session transcript for every run, the always-read
// .claude.json global config, and auto-memory. Measured before this existed:
// one DEV run against ~/.iris/workspace left a 57 KB transcript in
// ~/.claude/projects/-Users-...--iris-workspace/. That is the user's own Claude
// Code history directory, and Iris was writing the contents of their projects
// into it.
//
// Pointing the whole directory at Iris's own storage is the documented fix and
// covers all of those inputs at once (the CLI creates the directory, and its
// own .claude.json inside it, on first use — nothing here has to mkdir).
//
// Deliberately NOT overridable by an environment variable: the only interesting
// value to override it *to* is the user's ~/.claude, which is exactly what this
// prevents. Tests inject via the `claudeHome` option instead.
export function irisClaudeHome(homedir = os.homedir) {
  return path.join(homedir(), ".iris", "claude-home");
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
//
// The same policy also pins CLAUDE_CONFIG_DIR (see irisClaudeHome above) and
// disables auto-memory, so neither role can write into the user's ~/.claude.
//
// A side effect worth stating plainly: relocating the config directory also
// cuts off the host Claude Code login. Before this, a run on a machine with an
// interactively logged-in Claude Code authenticated from that keychain entry
// even with no credential in the environment — so the app silently depended on
// the user's own install, the exact coupling this refactor set out to remove,
// and it masked the failure on a machine that never had Claude Code. A
// credential now has to come from the environment, which is what the pipeline
// availability gate already checks.
export function computeClaudeWorkerEnv(baseEnv, { claudeHome = irisClaudeHome() } = {}) {
  const excluded = ["GEMINI_API_KEY"];
  if (baseEnv.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    excluded.push("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN");
  }
  const env = computeWorkerEnv(baseEnv, excluded);
  env.CLAUDE_CONFIG_DIR = claudeHome;
  // Auto-memory is loaded into the system prompt and written back with the
  // ordinary Write/Edit tools — under bypassPermissions that is unprompted.
  // Iris has no use for it, and its notes belong to the user's own sessions.
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return env;
}
