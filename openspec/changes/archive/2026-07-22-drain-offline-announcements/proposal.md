## Why

Every `SYSTEM_EVENT_*` voice announcement that lands while the Gemini Live socket is disconnected is buffered into `pendingClaudeAnnouncements` (`electron/main.mjs:80, 564`) and then **never delivered**. The drain loop that should flush it lives inside the `onopen` callback (`main.mjs:2262`) guarded by `while (... && liveSession)`, but `liveSession` is not assigned until `await ai.live.connect(...)` **resolves** (`main.mjs:2251`), and `onopen` fires *before* that assignment completes. So the guard is always false, the loop is dead code, and the buffer is push-only.

This is not hypothetical. Gemini Live drops the socket roughly every ~10 minutes (periodic reconnect, `main.mjs:66-70`) and DEV runs routinely take minutes; a run that completes inside a reconnect window has its `SYSTEM_EVENT_CLAUDE_COMPLETE` buffered and silently lost — Iris never reads the result, with no log and no error. `SESSION_START`, `AGENT_SELECT`, and `WORKSPACE_UPDATE` are lost the same way. The buffer also grows append-only for the life of the process — a slow memory leak.

The fix already exists 1,200 lines away: `previewVoice` (`main.mjs:1035-1036`) documents this exact trap and sends *after* `connect` resolves. The main path never got the same treatment. This is drift against `session-announcements`, whose spec already requires "Buffered announcements are delivered in order on reconnect."

## What Changes

Lands as **one commit** — a single bug.

- Extract the drain into `drainPendingAnnouncements()` and **remove** the dead `while` loop from `onopen` (`main.mjs:2262-2264`).
- Call `drainPendingAnnouncements()` immediately after `liveSession = await ai.live.connect(...)` resolves (`main.mjs:2251`) — the same shape `previewVoice` uses — so the drain runs against an assigned `liveSession`.
- **Bound the buffer** at the push site (`main.mjs:564`): a ring buffer of the ~20 most-recent announcements, so a long offline stretch cannot grow it without limit. When the bound is exceeded while offline, the oldest announcement is dropped in favor of the most recent — the newest state-change is the one worth speaking.

Not in scope:
- BUG A' (Wave 0.3, done) already decided *which* completions get announced (started + not-cancelled). This change is about the offline *transport* of whatever A' let through — the two do not overlap.
- Any change to `notifyIris`'s immediate-delivery path or its `bufferIfOffline` opt-out — both are correct today.
- The transcript flush, reconnect backoff, or resumption-handle logic in the same function.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-announcements`: the "State-change announcements survive a disconnected voice session" requirement is bounded — buffering now retains a capped number of most-recent announcements rather than an unbounded set. The existing "delivered in order on reconnect" requirement is unchanged in text; the code is being brought back into conformance with it (drift fix, no delta needed for that requirement).

## Impact

- `electron/main.mjs` — a new `drainPendingAnnouncements()` helper, the drain call hoisted to after `connect` resolves, the dead `onopen` loop removed, and a bounded push at line 564. All within `startLive`/`notifyIris`, no new module.
- `session-announcements` living spec — one MODIFIED requirement (the bound).
- No new dependency, no data migration, no env budget. `main.mjs` remains out of automated test scope (Wave 0.0 D5), so verification is the manual drop-a-socket ritual in tasks; if the bounded-push logic is extracted as a tiny pure helper it can carry a unit test.
