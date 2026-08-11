import os from "node:os";
import { claudeHome } from "./app-paths.mjs";

// Shared by both role workers (harden-security-boundaries D12): a worker
// subprocess or SDK session gets an environment derived from the parent by
// subtraction, never the parent environment passed through unchanged. A
// worker runs with `bypassPermissions`, has shell and network access with no
// approval prompt, and routinely processes content it did not author — any
// secret sitting in its environment is one `echo $VAR` away from leaving the
// machine. The stateless spawn (main.mjs) and the resident Agent SDK session
// (stateful-session.mjs) both route through this so the two cannot drift apart.
export function computeWorkerEnv(baseEnv, excludeKeys) {
  const env = { ...baseEnv };
  for (const key of excludeKeys) delete env[key];
  return env;
}

// Iris's own Claude Code state directory, kept away from the user's ~/.claude.
//
// A delegation, not a definition. The path and the full reasoning for pinning
// CLAUDE_CONFIG_DIR to it — why `settingSources` is not sufficient on its own,
// what was measured leaking into the user's ~/.claude/projects/ before it existed,
// why it must be stable rather than a temp directory, and why it is deliberately
// not overridable by an environment variable — now live on `claudeHome()` in
// app-paths.mjs, alongside every other child of the state root. Read it there.
//
// Kept as an export because it is this module's established name for the value and
// computeClaudeWorkerEnv's default below, plus run-sessions.mjs, both call it.
export function irisClaudeHome(homedir = os.homedir) {
  return claudeHome(homedir);
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

// Which credential a run will bill against — the same two the strip rule above
// reasons about, read here so callers can say so before a run starts. It lives
// beside that rule rather than in a session module because it is one policy for
// both run shapes, and the voice layer asking a session module which credential
// pays was a coupling with no reason behind it.
//
// A subscription token is still the preferred path (it is what long-running
// resident sessions are priced for), but an API key is a working credential and
// no run may be refused for holding one: pipeline-probes.mjs accepts either, so
// refusing one here would strand API-key-only users with a live pipeline whose
// stateful turns all fail.
export function claudeBillingStatus(env = process.env) {
  if (String(env.CLAUDE_CODE_OAUTH_TOKEN || "").trim()) return { ok: true, mode: "subscription" };
  if (String(env.ANTHROPIC_API_KEY || "").trim()) return { ok: true, mode: "api-key" };
  return { ok: false, mode: "missing" };
}

// Ambient session capture (ambient-memory design D3): this variable can only
// TIGHTEN the opt-in, never loosen it. There is deliberately no companion
// variable that force-*enables* retention — a variable that turned on
// microphone retention with nobody touching the interface would be a worse
// capability than the feature itself; an admin who wants it on can ask the
// user to flip the toggle. Takes an injected env, same shape as
// computeWorkerEnv/computeClaudeWorkerEnv above, so it is testable without
// touching process.env.
export function ambientCaptureForcedOff(env = process.env) {
  return String(env.IRIS_AMBIENT_CAPTURE ?? "").trim().toLowerCase() === "off";
}
