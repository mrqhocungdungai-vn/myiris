// The SDK hook callbacks both roles install.
//
// Four jobs, deliberately no more (design.md D4/D5):
//
//   PreToolUse          the guard — a spend warning while the run is still
//                       executing, and a small destructive-command denylist
//   PostToolUse         authoritative tool-end boundary (success)
//   PostToolUseFailure  authoritative tool-end boundary (failure)
//   PreCompact          compaction is currently invisible and looks like a stall
//   Notification        runtime state the user would otherwise never see
//
// The step timeline deliberately does NOT move off `parseClaudeStreamMessage`.
// Hooks are an *additional*, authoritative source for the end boundary and the
// error flag: today `is_error` is read off a `tool_result` block, which cannot
// distinguish "the tool failed" from "the tool returned an error-shaped
// payload". The parser keeps producing activity text, and `pushToolStart` /
// `pushToolEnd` keep their signatures, so the run-stream projection and the deck
// are untouched.
//
// PreToolUse stays a guard and never accumulates product telemetry — that is
// what PostToolUse is for, and keeping them apart is what keeps the guard
// reviewable.
//
// Electron-free; every effect is injected.
import { budgetWarning } from "./run-budget.mjs";

// An explicit, short denylist — NOT a sandbox, and the spec says so in those
// words. `bypassPermissions` remains the intentional default for the headless
// worker because no interactive approval exists on that path; this catches
// obvious accidents on the way past, nothing more. A determined or confused
// model can still reach the same effect by other means (a script, a renamed
// binary, a different tool), and Iris must not claim otherwise anywhere in its
// interface or its docs.
const DESTRUCTIVE_PATTERNS = [
  {
    // `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`, and friends. Relative paths are
    // deliberately NOT matched: a run cleaning up its own build output is
    // ordinary work, and blocking it would make the guard something users
    // switch off.
    test: /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rR][a-zA-Z]*f?[a-zA-Z]*\s+(\/|~|\$HOME|\/\*)(\s|$)/,
    why: "a recursive delete rooted outside the working directory",
  },
  {
    test: /\bgit\s+push\b[^\n]*\s(--force|-f)(\s|$)/,
    why: "a force-push, which can destroy commits on a shared branch",
  },
  {
    test: /\bgit\s+reset\s+--hard\b[^\n]*\borigin\//,
    why: "a hard reset onto a remote branch, which discards uncommitted work",
  },
];

/**
 * @param {string} command
 * @returns {string | null} why it is refused, or null to allow
 */
export function destructiveReason(command) {
  const text = String(command ?? "");
  for (const { test, why } of DESTRUCTIVE_PATTERNS) {
    if (test.test(text)) return why;
  }
  return null;
}

// The only in-flight spend figure the SDK exposes. Everything else — the result
// message's `total_cost_usd`, `modelUsage` — arrives once the run is already
// over, which is too late to warn anybody.
//
// The method name is the SDK's own and says exactly what it is. Verified working
// against 0.3.210 (it returned a live, rising figure from inside a PreToolUse
// hook), but it is experimental by declaration, so this degrades to silence
// rather than failing a run: no figure means no warning, never an exception and
// never a number Iris made up. The reported cost of a finished run still comes
// from the result message and is never this.
/**
 * @param {any} queryHandle
 * @returns {Promise<number | null>}
 */
export async function readInFlightCostUsd(queryHandle) {
  const read = queryHandle?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  if (typeof read !== "function") return null;
  try {
    const usage = await read.call(queryHandle);
    const cost = usage?.session?.total_cost_usd;
    return typeof cost === "number" ? cost : null;
  } catch {
    return null;
  }
}

/**
 * Builds the `hooks` option for one run.
 *
 * Takes callbacks rather than a run record, because the two roles have different
 * shapes to bind to: DEV's hooks close over the one run they belong to, while
 * PO's session outlives any single turn and must route to whichever turn is
 * currently in flight. Callbacks let both express that in their own terms.
 *
 * @param {{
 *   budget: { maxBudgetUsd: number },
 *   warnFraction: number,
 *   costUsd: () => Promise<number | null>,
 *   onToolEnd: (toolId: string, isError: boolean) => void,
 *   onActivity: (line: string) => void,
 *   emitEvent: (event: any) => void,
 * }} deps
 */
export function buildRunHooks({ budget, warnFraction, costUsd, onToolEnd, onActivity, emitEvent }) {
  // Once per run: a warning repeated on every tool call would be noise, and
  // noise is how a warning stops being read.
  let warned = false;

  /** @type {import("@anthropic-ai/claude-agent-sdk").HookCallback} */
  async function preToolUse(rawInput) {
    const input = /** @type {import("@anthropic-ai/claude-agent-sdk").PreToolUseHookInput} */ (rawInput);
    // Job 1 — the spend warning. `maxBudgetUsd` stops a run AT the ceiling but
    // says nothing on the way there, and the result message reports the cost
    // only once the run is already over. This is the one place with an
    // in-flight view.
    if (!warned) {
      const warning = budgetWarning(await costUsd(), budget, warnFraction);
      if (warning) {
        warned = true;
        emitEvent({ type: "log", level: "warn", message: warning });
        onActivity(warning);
      }
    }

    // Job 2 — the denylist. Only Bash carries a shell command; every other tool
    // passes straight through.
    if (input.tool_name === "Bash") {
      const command = /** @type {any} */ (input.tool_input)?.command;
      const why = destructiveReason(command);
      if (why) {
        emitEvent({ type: "log", level: "warn", message: `Blocked a destructive command: ${why}.` });
        onActivity(`[blocked] ${why}`);
        return {
          hookSpecificOutput: {
            hookEventName: /** @type {"PreToolUse"} */ ("PreToolUse"),
            permissionDecision: /** @type {"deny"} */ ("deny"),
            // The model reads this, so it says what to do instead rather than
            // only that it was refused.
            permissionDecisionReason:
              `Iris blocked this command: it is ${why}. This guard catches accidents, not a policy you can ` +
              "argue with — narrow the command to the working directory, or ask the user to run it themselves.",
          },
        };
      }
    }
    return { continue: true };
  }

  /** @type {import("@anthropic-ai/claude-agent-sdk").HookCallback} */
  async function postToolUse(rawInput) {
    const input = /** @type {import("@anthropic-ai/claude-agent-sdk").PostToolUseHookInput} */ (rawInput);
    onToolEnd(input.tool_use_id, false);
    return { continue: true };
  }

  /** @type {import("@anthropic-ai/claude-agent-sdk").HookCallback} */
  async function postToolUseFailure(rawInput) {
    const input = /** @type {import("@anthropic-ai/claude-agent-sdk").PostToolUseFailureHookInput} */ (rawInput);
    // The authoritative failure flag. An inferred boundary cannot tell this
    // apart from a tool that completed and returned an error-shaped payload.
    onToolEnd(input.tool_use_id, true);
    if (input.error) onActivity(`[${input.tool_name} failed] ${String(input.error).slice(0, 200)}`);
    return { continue: true };
  }

  /** @type {import("@anthropic-ai/claude-agent-sdk").HookCallback} */
  async function preCompact(rawInput) {
    const input = /** @type {import("@anthropic-ai/claude-agent-sdk").PreCompactHookInput} */ (rawInput);
    // A compaction is a silent multi-second pause with no output. Without this
    // the run looks stalled, and a user who thinks a run has hung stops it.
    const line =
      input.trigger === "manual"
        ? "Compacting the conversation (requested) — this pause is expected."
        : "Context window full — compacting the conversation. This pause is expected; the run continues after it.";
    onActivity(line);
    emitEvent({ type: "log", level: "info", message: line });
    return { continue: true };
  }

  /** @type {import("@anthropic-ai/claude-agent-sdk").HookCallback} */
  async function notification(rawInput) {
    const input = /** @type {import("@anthropic-ai/claude-agent-sdk").NotificationHookInput} */ (rawInput);
    const message = String(input.message ?? "").trim();
    if (message) onActivity(`[claude] ${message}`);
    return { continue: true };
  }

  /** @type {Partial<Record<import("@anthropic-ai/claude-agent-sdk").HookEvent, import("@anthropic-ai/claude-agent-sdk").HookCallbackMatcher[]>>} */
  const hooks = {
    PreToolUse: [{ hooks: [preToolUse] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    PostToolUseFailure: [{ hooks: [postToolUseFailure] }],
    PreCompact: [{ hooks: [preCompact] }],
    Notification: [{ hooks: [notification] }],
  };
  return hooks;
}
