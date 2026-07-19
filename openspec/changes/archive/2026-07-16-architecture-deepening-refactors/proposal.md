## Why

An architecture review of the PO/DEV delegation core (`electron/main.mjs`, `electron/po-session.mjs`) and the renderer (`src/App.tsx`) found five modules that are currently shallow: their real complexity — a mutual-exclusion invariant, a pending-question state machine, two independent parsers for the same message schema, and two duplicated Web Audio/gesture-scroll implementations — is scattered across many small functions or copy-pasted call sites instead of concentrated behind one narrow, testable interface. One of these (the `SYSTEM_EVENT_*` voice-announcement relay) is also a live, silent bug: two of its four call sites drop the announcement entirely when Gemini Live is mid-reconnect, while the other two correctly buffer and redeliver it. Fixing that inconsistency and deepening the other four modules now — while all five are fresh from the same review and before further pipeline/renderer work builds more code on top of the shallow versions — is cheaper than doing it later.

## What Changes

- Consolidate the four `SYSTEM_EVENT_*` voice-announcement call sites (`announceAgentSelection`, `announceWorkspaceUpdate`, `askUserQuestionViaVoice`, `announceClaudeCompletion` in `electron/main.mjs`) behind one `notifyIris(lines, { bufferIfOffline })` helper. **Fixes a real bug**: `announceAgentSelection`/`announceWorkspaceUpdate` currently drop the announcement outright when Gemini Live is disconnected (e.g. mid-reconnect); after this change they buffer and redeliver on reconnect, matching the behavior `askUserQuestionViaVoice`/`announceClaudeCompletion` already have.
- Encapsulate the pending-PO-question relay (`pendingPoQuestion` global plus `clearPendingPoQuestion`/`askUserQuestionViaVoice`/`resolvePendingPoQuestion`/`settlePendingPoQuestionForWorkstream` in `electron/main.mjs`) as a single `PendingQuestion` object owning the "raised → answered/expired/abandoned, exactly once" invariant. Observable behavior is unchanged (still governed by the existing `voice-decision-relay` spec); only the internal implementation is deepened. The cross-file boundary with `electron/po-session.mjs`'s `buildCanUseTool` (which calls out through an injected `onAskUserQuestion` callback) is preserved as-is.
- Share the Claude message-stream parsing currently duplicated between `electron/main.mjs` (`summarizeToolInput`, `handleClaudeStreamEvent`) and `electron/po-session.mjs` (`summarizeToolInput`, `routeMessage`) behind one parser parameterized by `onSessionId`/`onActivity`/`onResult` callbacks. Behavior-preserving; both DEV's NDJSON stream and PO's SDK message stream continue to be handled exactly as today.
- Extract a `useAudioPipeline` hook from `src/App.tsx` that owns the 11 audio-related refs (`inputContextRef` … `sessionStartRef`) and the `startAudioCapture`/`stopAudioCapture`/`flushPlayback`/`playGeminiAudio`/`toggleMute` functions currently scattered across ~500 non-contiguous lines of the component, mirroring the existing `src/useHandControl.ts` extraction pattern.
- Extract a shared `useHoldToScroll` hook used by both the Comms/Work panel scroll effect and `ExpandedReader`'s scroll effect in `src/App.tsx`, replacing the two near-verbatim copies of the dead-zone/center/reach scroll-velocity math (which have already begun to drift from each other).

None of these changes alter user-facing behavior except the `SYSTEM_EVENT_*` fix above, which only makes existing announcements more reliable (no announcement that would previously eventually be spoken is now spoken differently — the fix only recovers announcements that were previously silently lost).

## Capabilities

### New Capabilities
- `session-announcements`: the app notifies the Gemini voice layer of workspace/session/role state changes (agent selection, workspace/project-folder changes), buffering the announcement for redelivery if the voice session is disconnected at the time, so no state-change announcement is silently lost.

### Modified Capabilities
(none — `voice-decision-relay` and `po-live-session`'s existing requirements describe observable behavior that this change preserves; only their internal implementation is deepened)

## Impact

- **Affected code**: `electron/main.mjs` (voice-announcement call sites, pending-question relay, Claude stream parsing, `runQueue`-adjacent code is untouched), `electron/po-session.mjs` (`summarizeToolInput`, `routeMessage`, `buildCanUseTool` — boundary preserved), `src/App.tsx` (audio capture/playback, hold-to-scroll), new `src/useAudioPipeline.ts` and `src/useHoldToScroll.ts` hooks (paralleling the existing `src/useHandControl.ts`).
- **No new dependencies.** No API/IPC contract changes (`electron/preload.cjs`'s `window.iris` surface is unchanged).
- **No test runner is configured** in this repo; `npm run build` (`tsc --noEmit` + `vite build`) is the only automated check, plus manual verification of the affected voice/PO/DEV/audio/gesture flows (see tasks.md).
