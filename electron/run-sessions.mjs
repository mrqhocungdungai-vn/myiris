// Session bookkeeping through the SDK's own helpers instead of by inference.
//
// Two jobs:
//
//   1. Is a stored resume id still real? This used to be guessed by regex-
//      matching an error string (`/no conversation|session.*not.*found|unknown
//      session/i`) after a run had already failed. `getSessionInfo()` answers it
//      directly, before the run starts, so a dead id costs nothing instead of
//      costing a failed run.
//   2. Give a session the workstream's label, so the transcript Iris creates
//      carries the name the user chose rather than an auto-generated summary.
//
// **Both helpers read `CLAUDE_CONFIG_DIR` from `process.env` at call time**, and
// this is the whole reason this module exists rather than the two calls being
// inlined. Measured: with the variable unset, `listSessions()` returned 32 of the
// *user's own* Claude Code sessions out of `~/.claude` — the exact boundary Iris
// must never cross, and it would find none of Iris's own sessions either, since
// those live under `~/.myiris/claude-home` (see app-paths.mjs). Every call here
// therefore runs with the variable pinned and restored.
//
// The env is restored in a `finally`, and the pin is the same value
// `computeClaudeWorkerEnv` writes unconditionally, so a run starting while a
// probe is in flight cannot pick up a different value than it would otherwise.
import { getSessionInfo, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { irisClaudeHome } from "./worker-env.mjs";

async function withIrisClaudeHome(fn, { claudeHome = irisClaudeHome(), env = process.env } = {}) {
  const previous = env.CLAUDE_CONFIG_DIR;
  env.CLAUDE_CONFIG_DIR = claudeHome;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete env.CLAUDE_CONFIG_DIR;
    else env.CLAUDE_CONFIG_DIR = previous;
  }
}

/**
 * Whether a stored resume id still names a real session.
 *
 * Returns true when it cannot tell. A resume id can outlive its transcript
 * (history deleted, project moved, config directory relocated), and dropping it
 * lets the next task start fresh instead of failing the same way forever — but
 * dropping a *live* session on the strength of a probe that merely errored would
 * silently discard the user's conversation history, which is far worse than one
 * failed run. So this only reports "dead" when the SDK positively says so.
 *
 * @param {string | null | undefined} sessionId
 * @param {{ dir?: string, getInfo?: typeof getSessionInfo, claudeHome?: string, env?: any }} [options]
 * @returns {Promise<boolean>}
 */
export async function isSessionAlive(sessionId, { dir, getInfo = getSessionInfo, claudeHome, env } = {}) {
  if (!sessionId) return false;
  try {
    const info = await withIrisClaudeHome(() => getInfo(sessionId, dir ? { dir } : undefined), { claudeHome, env });
    return info !== undefined;
  } catch {
    return true;
  }
}

/**
 * Names a session after its workstream. Best-effort and never throws: a title is
 * cosmetic, and failing a run over one would be absurd.
 *
 * @param {string | null | undefined} sessionId
 * @param {string | null | undefined} title
 * @param {{ dir?: string, rename?: typeof renameSession, claudeHome?: string, env?: any }} [options]
 * @returns {Promise<boolean>} whether the title was applied
 */
export async function nameSession(sessionId, title, { dir, rename = renameSession, claudeHome, env } = {}) {
  const label = String(title ?? "").trim();
  if (!sessionId || !label) return false;
  try {
    await withIrisClaudeHome(() => rename(sessionId, label, dir ? { dir } : undefined), { claudeHome, env });
    return true;
  } catch {
    return false;
  }
}
