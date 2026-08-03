// Shared message-shape parsing for both Claude transports: DEV's spawned
// `claude -p` NDJSON stdout (electron/main.mjs) and PO's resident Agent SDK
// `for await` stream (electron/po-session.mjs). Both transports carry the
// same underlying message schema (system/init, assistant content parts,
// terminal result) — only how each side dispatches from there differs, via
// the onSessionId/onActivity/onResult callbacks passed in.
export function summarizeToolInput(input = {}) {
  const raw =
    input?.command ??
    input?.query ??
    input?.prompt ??
    input?.file_path ??
    input?.url ??
    input?.pattern ??
    input?.description ??
    input?.questions?.[0]?.question ??
    JSON.stringify(input ?? {});
  return String(raw ?? "").replace(/\s+/g, " ").slice(0, 160);
}

// `onToolStart`/`onToolEnd` give callers the same tool-call boundaries as
// `onActivity`'s "[tool] summary" text, but paired by Claude's own tool_use id
// instead of by name — good enough to drive a live per-task step timeline
// (see openspec/changes/two-hand-gestures-and-orb design.md D2). Optional: a
// caller that only wants the flat activity log can omit them.
/**
 * @param {any} message
 * @param {{
 *   onSessionId?: (sessionId: string) => void,
 *   onActivity?: (text: string) => void,
 *   onToolStart?: (toolId: string, toolName: string, detail: string) => void,
 *   onToolEnd?: (toolId: string, isError: boolean) => void,
 *   onResult?: (message: any) => void,
 * }} [callbacks]
 */
export function parseClaudeStreamMessage(
  message,
  { onSessionId, onActivity, onToolStart, onToolEnd, onResult } = {},
) {
  if (message.type === "system" && message.subtype === "init" && message.session_id) {
    onSessionId?.(message.session_id);
    return;
  }
  if (message.type === "assistant") {
    for (const part of message.message?.content || []) {
      if (part.type === "text" && part.text?.trim()) onActivity?.(part.text);
      if (part.type === "tool_use") {
        onActivity?.(`[${part.name}] ${summarizeToolInput(part.input)}`);
        onToolStart?.(part.id, part.name, summarizeToolInput(part.input));
      }
    }
    return;
  }
  if (message.type === "user") {
    for (const part of message.message?.content || []) {
      if (part.type === "tool_result") onToolEnd?.(part.tool_use_id, part.is_error === true);
    }
    return;
  }
  if (message.type === "result") {
    onResult?.(message);
  }
}

// The cost and usage figures the SDK reports on every terminal result, lifted
// into the shape a run record carries. Read in zero places before this change:
// a voice-dispatched run executed on the user's credential and nothing recorded
// what it spent.
//
// `model_usage` is kept alongside the single `cost_usd` figure rather than
// instead of it, because a run that used subagents spends on more than one model
// and a single top-level number attributes that incorrectly — both measured runs
// in design.md D3 carried two models. Lives here, with the rest of the shared
// message-shape knowledge, so DEV's stream projection and PO's resident session
// read the same fields the same way.
/**
 * @param {any} result
 * @returns {{ cost_usd: number|null, num_turns: number|null, usage: any, model_usage: any } | null}
 */
export function runUsageFrom(result) {
  if (!result || typeof result !== "object") return null;
  return {
    cost_usd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
    num_turns: typeof result.num_turns === "number" ? result.num_turns : null,
    usage: result.usage ?? null,
    model_usage: result.modelUsage ?? null,
  };
}
