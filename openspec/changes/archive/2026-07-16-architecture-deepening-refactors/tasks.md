## 1. `notifyIris` voice-announcement consolidation

- [x] 1.1 Add a `notifyIris(lines, { bufferIfOffline })` helper in `electron/main.mjs` that sends via `liveSession.sendRealtimeInput` when connected, else pushes onto `pendingClaudeAnnouncements` when `bufferIfOffline` is true, else drops
- [x] 1.2 Route `announceAgentSelection` and `announceWorkspaceUpdate` through `notifyIris(..., { bufferIfOffline: true })`, removing their current `if (!liveSession) return;` drop
- [x] 1.3 Route `askUserQuestionViaVoice` and `announceClaudeCompletion` through `notifyIris(..., { bufferIfOffline: true })`, preserving their existing buffering behavior
- [x] 1.4 Manually verify: disconnect the voice session (or trigger a reconnect window), switch the active role and the project folder, reconnect, and confirm both announcements are spoken instead of silently lost
- [x] 1.5 Manually verify: with the voice session connected throughout, confirm role-select, workspace-change, PO-question, and task-completion announcements are still all spoken immediately, matching current behavior

## 2. Shared Claude message-stream parser

- [x] 2.1 Create `electron/claude-stream.mjs` exporting a parser function that takes a message/event object plus `{ onSessionId, onActivity, onResult }` callbacks, covering the `system`/`init`, `assistant` content-part, and terminal `result` cases
- [x] 2.2 Create a single shared `summarizeToolInput` in `electron/claude-stream.mjs` using the union of both sides' fallback chains (DEV's `url`/`pattern`/`description` fields plus PO's `AskUserQuestion` `questions[0].question` unwrap)
- [x] 2.3 Update `electron/main.mjs`'s `handleClaudeStreamEvent` to delegate to the shared parser, wiring `rememberClaudeSessionId`/`pushActivity` as callbacks; remove the old inline duplicate logic and local `summarizeToolInput`
- [x] 2.4 Update `electron/po-session.mjs`'s `routeMessage` to delegate to the shared parser, wiring its existing `onSessionId`/`onActivity` callbacks and `turn.resolve()`; remove the old inline duplicate logic and local `summarizeToolInput`
- [x] 2.5 Manually verify: run one DEV task end-to-end and confirm the Work Stream panel shows the same session id, activity lines, and completion output as before the change
- [x] 2.6 Manually verify: run one PO turn end-to-end (including at least one tool call) and confirm the Work Stream panel output is unchanged from before the change

## 3. `PendingQuestion` state machine

- [x] 3.1 Implement a `PendingQuestion` type/object in `electron/main.mjs` with `raise(question, { timeoutMs })`, `answer(selection)`, `expire()`, and `abandon()`, all funneling through one internal settle-once primitive
- [x] 3.2 Replace the `pendingPoQuestion` global and `clearPendingPoQuestion`/`resolvePendingPoQuestion`/`settlePendingPoQuestionForWorkstream` functions with calls into the new `PendingQuestion` object, preserving the exact external entry points used by `po-session.mjs`'s `onAskUserQuestion` injection, the `answer_po_question` Gemini tool, and `po:answer-question` IPC handler
- [x] 3.3 Update the three `createWorkstream`/`selectWorkstream`/`setWorkstreamCwd` call sites to call `PendingQuestion.abandon()` before `closePoSession(id)`, preserving existing sequencing
- [x] 3.4 Manually verify (`voice-decision-relay` spec scenarios): PO asks a structured question mid-turn and it's read aloud
- [x] 3.5 Manually verify: answering by voice resolves the same turn with full prior context intact
- [x] 3.6 Manually verify: answering via the UI (`window.iris.answerPoQuestion`) also resolves correctly, and a second answer attempt after resolution is a no-op
- [x] 3.7 Manually verify: an unanswered question times out and falls back to the recommended option
- [x] 3.8 Manually verify: resetting the session while a question is pending settles it and tears down the PO session without an orphaned process

## 4. Renderer: `useAudioPipeline` hook

- [x] 4.1 Create `src/useAudioPipeline.ts` owning the 11 audio refs (plus `muted` state) and `startAudioCapture`/`stopAudioCapture`/`flushPlayback`/`playGeminiAudio`/`toggleMute`, exposing `{ audioLevelRef, sessionStartRef, muted, start, stop, flushPlayback, playGeminiAudio, toggleMute }`
- [x] 4.2 Preserve `stopAudioCapture`'s exact teardown order (disconnect processor → disconnect source → stop tracks → close context → null refs) inside the hook
- [x] 4.3 Update `src/App.tsx` to consume `useAudioPipeline`, removing the extracted refs/functions and wiring the hook's `start`/`stop` into the existing `start()`/`stop()` orchestration and `onAudioChunk`/`onAudioInterrupt` listeners
- [x] 4.4 Manually verify: a full start → talk (confirm mic level meter moves) → hear Gemini response → stop → restart cycle works with no console errors and no dangling `AudioContext`
- [x] 4.5 Manually verify: mute toggle still stops outgoing audio without tearing down the session

## 5. Renderer: `useHoldToScroll` hook

- [x] 5.1 Create `src/useHoldToScroll.ts` taking `(resolveContainer, hand, { disabled })` and running the existing dead-zone/center/reach RAF scroll loop, including the live-ref-mirroring pattern needed for RAF access to current `hand` — `resolveContainer` takes a `HandPoint` and returns the element to scroll (or null), so the main deck's "whichever of two panels the hand is over" selection and `ExpandedReader`'s single fixed container both fit the same hook
- [x] 5.2 Update the Comms/Work panel scroll effect in `src/App.tsx` to use `useHoldToScroll`, passing its existing `expandedTaskId`/`showHistory`-derived `disabled` condition
- [x] 5.3 Update `ExpandedReader`'s scroll effect in `src/App.tsx` to use `useHoldToScroll` against its `bodyRef`
- [x] 5.4 Manually verify: open-palm hold-to-scroll still works in the Comms panel, the Work Stream panel, and inside an expanded task reader, with the same dead-zone feel as before

## 6. Final checks

- [x] 6.1 Run `npm run build` and confirm `tsc --noEmit` and the Vite build both pass
- [x] 6.2 Re-read the diff against `design.md`'s Decisions section to confirm no unintended scope crept in (no `runQueue`/`ExecutionSlot` or typed-`SidecarEvent` changes, per the stated Non-Goals)
