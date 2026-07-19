## Context

Five deepening opportunities were identified in an architecture review of `electron/main.mjs` (the Gemini↔Claude delegation core), `electron/po-session.mjs` (the PO's resident Agent SDK session), and `src/App.tsx` (the renderer). All five are behavior-preserving refactors except the `SYSTEM_EVENT_*` consolidation, which also fixes a live bug (silent announcement loss across a Gemini Live reconnect). There is no test runner or linter in this repo (`CLAUDE.md`); `npm run build` (`tsc --noEmit` + `vite build`) is the only automated check, so each decision below favors changes that are easy to verify manually and hard to get subtly wrong, over changes that would need new test infrastructure to feel safe.

## Goals / Non-Goals

**Goals:**
- Concentrate each of the five identified invariants/duplications behind one narrow interface, per the deletion test: deleting the new abstraction should concentrate complexity, not just relocate it.
- Preserve every existing observable behavior described in `openspec/specs/voice-decision-relay/spec.md` and `openspec/specs/po-live-session/spec.md` exactly, except the one documented bug fix.
- Keep DEV's one-shot subprocess path and PO's persistent SDK-session path architecturally separate, per `CLAUDE.md`'s "deliberately different, separately-evolving mechanisms" boundary — shared parsing logic must not blur that line into a shared "role" flag.

**Non-Goals:**
- No new capability or user-facing feature. `session-announcements` is a new *spec* (naming behavior that already exists for two of the four call sites), not new functionality.
- No change to the `runQueue`/`finalizeRun`/`startNextInQueue` execution-slot mechanism (a related but separate deepening candidate, deliberately out of scope here to keep this change reviewable).
- No change to `electron/preload.cjs`'s IPC surface or `src/vite-env.d.ts`'s event typing (a separate candidate — typed `SidecarEvent` discriminated union — also out of scope).
- No change to `useHandControl.ts` itself; `useHoldToScroll` consumes its output but doesn't alter it.

## Decisions

### 1. `notifyIris(lines, { bufferIfOffline })` replaces four independent call sites
All four functions (`announceAgentSelection`, `announceWorkspaceUpdate`, `askUserQuestionViaVoice`, `announceClaudeCompletion`) already build an array of prose lines and then either call `liveSession.sendRealtimeInput` or fall through to some "not connected" handling. `notifyIris` takes over exactly that last step: if `liveSession` exists, send immediately; otherwise, if `bufferIfOffline` is true, push onto the existing `pendingClaudeAnnouncements` array for redelivery on reconnect (reusing the mechanism `askUserQuestionViaVoice`/`announceClaudeCompletion` already have), else drop (preserved for any call site that genuinely should not survive a disconnect — none currently need `bufferIfOffline: false`, but the parameter keeps today's per-call-site control point explicit rather than hard-coding "always buffer").
- **Alternative considered**: make all four always buffer unconditionally (delete the parameter). Rejected — keeping the flag costs one boolean and preserves the option for a future call site that genuinely wants fire-and-forget semantics, without requiring readers to infer that from a bare function name.
- **Where the buffered queue redelivers**: unchanged — the existing reconnect handler that drains `pendingClaudeAnnouncements` continues to do so; `notifyIris` only changes how items get *into* that queue.

### 2. `PendingQuestion` object owns the raise/answer/expire/abandon invariant
Today, `pendingPoQuestion` is a bare module-level object mutated from five functions, and a code comment (`main.mjs:1281-1286`) documents a prior bug from exactly this shape (re-checking the global after nulling it silently hung a PO turn). The new `PendingQuestion` type exposes:
- `raise(question, { timeoutMs })` → registers the pending question and its timeout timer, returns a promise that resolves with the answer.
- `answer(selection)` → resolves the pending promise with a user/voice-provided selection; no-ops if already settled.
- `expire()` → resolves with the recommended-option fallback; called by the timeout timer.
- `abandon()` → resolves with the recommended-option fallback; called on session reset/quit.
- Internally, `answer`/`expire`/`abandon` all funnel through one "settle once" primitive (replacing today's `clearPendingPoQuestion`), so there is exactly one code path that can ever resolve the promise, eliminating the class of bug the existing comment documents by construction rather than by convention.
- **Alternative considered**: keep the current five free functions but add a single `isSettled` guard at the top of each. Rejected — that only patches the specific bug already found; a `PendingQuestion` object makes "there is exactly one pending question, resolved exactly once" a type-level invariant instead of a convention every future call site must remember.
- **Boundary preserved**: `electron/po-session.mjs`'s `buildCanUseTool` still calls out through an injected `onAskUserQuestion(question) => Promise<answer>` function — `PendingQuestion` lives entirely on the `main.mjs` side of that boundary; `po-session.mjs` never imports or knows about it, keeping the SDK session Gemini/IPC-agnostic as designed.
- **Call-site simplification**: the three repeated `settlePendingPoQuestionForWorkstream(id); closePoSession(id);` pairs (in `createWorkstream`, `selectWorkstream`, `setWorkstreamCwd`) become `PendingQuestion.abandon()`-then-`closePoSession(id)`, unchanged in sequencing but now backed by the single settle-once primitive.

### 3. Shared stream parser, parameterized by callbacks
`handleClaudeStreamEvent` (DEV's NDJSON parser) and `routeMessage` (PO's SDK message parser) both branch on the same three cases (`system`/`init` → session id, `assistant` content parts → activity/tool-use text, terminal `result` → completion) with different local plumbing. The shared parser takes a message/event object plus `{ onSessionId, onActivity, onResult }` callbacks — exactly the shape both call sites already have (DEV wires `rememberClaudeSessionId`/`pushActivity`/`finalizeRun`; PO wires `onSessionId`/`onActivity` passed into `deliverPoTurn` plus `turn.resolve()`). `summarizeToolInput` is unified as one function (taking PO's superset behavior — it already unwraps `AskUserQuestion`'s `questions[0].question`, which is a strict superset of DEV's fallback chain and is harmless for DEV's inputs, which never contain a `questions` field).
- **Alternative considered**: leave the two parsers separate but extract only `summarizeToolInput`. Rejected — the review found the *dispatch* logic (not just the tiny summarizer) is the larger duplicated surface, and a schema change to the CLI's NDJSON/SDK message shape is the actual risk this should guard against.
- **Where this lives**: a new shared module (e.g. `electron/claude-stream.mjs`) importable by both `main.mjs` and `po-session.mjs`, keeping the DEV/PO separation at the *dispatch* level (each still owns its own transport — spawned subprocess vs. resident SDK session) while sharing only the message-shape parsing, which is not part of the "deliberately different, separately-evolving" boundary `CLAUDE.md` calls out (that boundary is about session lifecycle/state model, not message-schema parsing).

### 4. `useAudioPipeline` hook
Owns all 11 refs (`inputContextRef`, `inputStreamRef`, `inputSourceRef`, `inputProcessorRef`, `outputContextRef`, `playbackTimeRef`, `playbackSourcesRef`, `inputAnalyserRef`, `outputAnalyserRef`, `audioLevelRef`, `sessionStartRef`) and the five functions that manipulate them (`startAudioCapture`, `stopAudioCapture`, `flushPlayback`, `playGeminiAudio`, `toggleMute`), exposed as `{ audioLevelRef, start, stop, flushPlayback, playGeminiAudio, toggleMute }`. `App.tsx` calls these from its existing `start()`/`stop()` orchestration and the `onAudioChunk`/`onAudioInterrupt` IPC listeners, exactly as today, but no longer holds any audio-specific ref itself.
- **Alternative considered**: split into two hooks (`useMicCapture`, `useGeminiPlayback`) instead of one. Rejected for this change — `flushPlayback` and mute both need to reason about capture and playback together in a few call sites, and the review's single biggest complaint was refs scattered across the *component*, not that one combined hook would itself be too large (11 refs behind one hook is still far shallower than 11 refs behind none). Splitting further is a reasonable future step if the combined hook grows unwieldy, not a blocker now.
- **`setHandControl(true)` side effect inside `start()`** (App.tsx:719, enabling gesture control as a side effect of waking the sidecar) stays in `App.tsx`, not the new hook — it's a cross-concern orchestration decision, not audio pipeline internals.

### 5. `useHoldToScroll` hook
Takes `(containerRef, hand, { disabled })` and runs the existing dead-zone/center/reach RAF scroll loop once, replacing the two near-identical copies (Comms/Work panel, `ExpandedReader`). Both call sites already compute `disabled` from local conditions (`expandedTaskId`/`showHistory` for the main deck, always-enabled for `ExpandedReader`), so the hook takes that as a parameter rather than trying to unify the two components' visibility logic.
- **Alternative considered**: extract just the pure dead-zone/scroll-delta math function and leave the RAF loop/ref-mirroring duplicated. Rejected — the review found the ref-mirroring trick ("live ref shadows state for RAF access") is itself part of the duplication and a source of the two copies' drift (differing dependency arrays); extracting only the math would leave that half unresolved.

## Risks / Trade-offs

- **[Risk]** `PendingQuestion`'s "settle exactly once" refactor touches the most fragile, previously-bug-scarred code path in the app (the PO voice relay). → **Mitigation**: preserve the exact external call signatures used by `po-session.mjs` and the IPC/Gemini-tool answer paths; verify all four `voice-decision-relay` spec scenarios manually (ask mid-turn, voice answer resolves, timeout fallback, session-reset-while-pending) before considering this task done.
- **[Risk]** Sharing the stream parser could subtly change what `activity` text or `claude_session_id` DEV/PO surface if the unified `summarizeToolInput` or dispatch logic doesn't exactly preserve both sides' existing behavior. → **Mitigation**: keep PO's superset `summarizeToolInput` (safe for DEV inputs, verified above) and diff the unified parser's output shape against both current implementations' branches before switching call sites over; manually run one DEV task and one PO turn afterward and compare Work Stream panel output to before the change.
- **[Risk]** Extracting `useAudioPipeline` mid-session could introduce a subtle Web Audio node lifecycle bug (e.g. a ref nulled in the wrong order during teardown) that's hard to notice without manual testing. → **Mitigation**: preserve the exact teardown order from `stopAudioCapture` verbatim inside the hook; manually verify a full start→talk→stop→restart cycle and confirm no console errors/dangling audio after the change.
- **[Risk]** `notifyIris`'s buffer-if-offline default could mask a call site that intentionally wanted fire-and-forget semantics. → **Mitigation**: the parameter is explicit per call site (not a single global default), and all four current call sites' desired behavior is already known from the review (workspace/agent-select should now buffer like the other two already do).
- **Trade-off**: this change intentionally does NOT touch `runQueue`/`ExecutionSlot` or the typed-`SidecarEvent` candidates from the same review, even though they're related — keeping this change to five well-bounded refactors keeps it reviewable in one pass; those two remain open candidates for a future change.

## Migration Plan

No data migration or deployment step is needed — this is a same-process, same-persisted-format refactor (no change to `~/.iris/claude-sessions.json` shape, no new env vars). Recommended sequencing to keep each step independently verifiable:
1. `notifyIris` consolidation (isolated, smallest blast radius, fixes the bug — do first).
2. Shared stream parser (touches both DEV and PO paths — verify both still work before moving on).
3. `PendingQuestion` (most fragile — do after 1 and 2 are confirmed stable, verify all `voice-decision-relay` scenarios).
4. `useAudioPipeline` and `useHoldToScroll` (renderer-only, independent of 1–3 — can be done in either order, or in parallel with the main-process work).

Rollback is simply reverting the relevant commit(s); no flags or staged rollout are needed given the lack of production users beyond local development.

## Open Questions

- None blocking. If a future change tackles the `runQueue`/`ExecutionSlot` or typed-`SidecarEvent` candidates from the same review, this change's `notifyIris` and shared stream parser should be revisited to confirm they still compose cleanly with those (expected to be independent, but not yet verified since they're out of scope here).
