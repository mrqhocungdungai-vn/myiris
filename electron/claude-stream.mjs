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
