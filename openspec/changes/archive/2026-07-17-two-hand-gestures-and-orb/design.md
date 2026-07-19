# Design — two-hand-gestures-and-orb

## Context

After `ui-deepspace-restructure`, our renderer layout matches upstream, so this change is mostly file-level adoption of upstream code. Verified facts from the repo comparison:

- **useHandControl**: ours (187 lines, `numHands: 1`, module-level `stableGesture`/`candidateFrames`) vs upstream (265 lines, `numHands: 2`, per-hand `Map` stabilization, `TrackedHand[]` with `id: left|right|single`, mirrored landmarks, `choosePrimary()`/`nearestTo()`). Shared constants identical (`WASM_URL`, `MODEL_URL`, `INPUT_RANGE`, 0.5 smoothing, 0.55 threshold).
- **Gesture→action**: upstream point+dwell 300 ms clicks any `button/a/[data-task-id]/[role=button]`; open palm scrolls `.activity-timeline/.hud-comms/.comms-scroll/.work-scroll/.hud-work/.history-grid`; two open palms resize the reader (ReaderOverlay lines ~58-79); fist closes.
- **Orb**: upstream ReactorCore (377 lines) takes `inputLevelRef`, `outputLevelRef`, `thinking`, `wakeKey`, `rippleKey`; App triggers: thinking swirl when user stops talking before the reply, `wakeKey` double-pulse, `rippleKey` on speech lock-in, flashes on delegate/complete. `lib/sounds.ts` (110 lines, `uiSounds`) synthesizes cues in Web Audio.
- **Handoff/timeline**: `HandoffLayer.tsx` (41), `useHandoffFx.ts` (145, diffs `tasks[]` — Hermes-agnostic), `WorkCard.StepTimeline` (part of 132), `types.ts` `TaskStep`. Upstream feeds steps from `hermes_task_event` (`tool.started`/`tool.completed`/`message.delta`/`reasoning.available`) in App.tsx 495-542 — **that ingestion is Hermes SSE-specific and is not portable**.
- **Our event stream today**: `electron/main.mjs` parses DEV NDJSON line-by-line and routes PO SDK messages the same way; each tool call/note is already pushed to the Work Stream as `claude_task_update` sidecar events. Completion arrives as `claude_completion`.

## Goals / Non-Goals

**Goals:**
- Gesture parity with upstream: two hands, universal point-and-hold, two-palm resize, reticles + skeleton.
- Orb parity: micro-expressions and synthesized sounds, with a mute toggle.
- Handoff comets + step timeline driven by our Claude event stream, equal for PO and DEV.
- No new dependencies, no new IPC channels, MediaPipe pin (`0.10.35` package = WASM_URL) preserved.

**Non-Goals:**
- No wake word, voice sleep, voice UI actions, TaskChooser, SetupPanel (change 3).
- No Glass HUD.
- No change to gesture *vocabulary* beyond upstream's (no custom gestures).
- No change to run-queue, PO relay, or model-selection behavior.

## Decisions

### D1 — Take upstream `useHandControl.ts` wholesale
Replace our hook with upstream's file (same ancestor, same constants). Our single-hand consumers read scalar fields that upstream still exposes (primary-hand compatibility), so consumer breakage is limited to where we intentionally adopt multi-hand UI. Alternative (incrementally add second hand to our hook) rejected: pure re-derivation of an existing, working file.

### D2 — Step ingestion is a pure mapping in App.tsx from existing events
Build `TaskStep[]` in the renderer's `handleSidecarEvent` from `claude_task_update` payloads: a tool-call note opens a step (label = tool name/summary), the next note or terminal event closes the previous one; `claude_completion` closes all. If the current payload shape proves too lossy for start/stop pairing (implementation-time check), extend the **existing** `claude_task_update` payload emitted by `main.mjs`'s NDJSON/SDK parsers with a structured `{phase: "tool_start"|"tool_end"|"note", tool?, detail?}` field — same channel, additive field, DEV and PO both flow through it. Alternative (new dedicated `claude_step` event) rejected: the CLAUDE.md contract says both paths already report through one shape; adding a parallel channel duplicates it.

### D3 — `useHandoffFx` adopted unchanged
It diffs the `tasks[]` array (submitted → comet out, terminal → comet in) and is worker-agnostic. Only the sound-hook names (`taskSent`, `taskDone`, `taskFailed`) and comments mentioning Hermes get renamed to Claude terms.

### D4 — ReactorCore upgraded to upstream prop surface in one step
`state`/`levelRef` becomes `inputLevelRef`/`outputLevelRef`/`thinking`/`wakeKey`/`rippleKey` (+ existing state). `useAudioPipeline` already owns mic and playback levels; expose both refs (upstream's version of the hook does — port that delta too). This deliberately supersedes the D1-exception pin from `ui-deepspace-restructure`.

### D5 — Sounds are opt-out, synthesized only
Adopt `lib/sounds.ts` as-is (Web Audio, no assets). A renderer-local mute toggle (persisted in `localStorage`) gates all cues; default on, matching upstream. SetupPanel's sound toggle (change 3) will later bind to the same flag.

### D6 — Universal dwell-click safety
Upstream's dwell-click targets any `button/a/[data-task-id]/[role=button]`. Our PO question banner buttons and DEV soft-gate `window.confirm` are click-sensitive: dwell-click on PO answer options is **desired** (hands-free answering); `window.confirm` is a native dialog and unreachable by gesture (unchanged behavior, acceptable). No exclusion list needed initially; add a `data-no-gesture` opt-out attribute convention only if smoke testing shows misfires.

## Risks / Trade-offs

- [Two-hand tracking costs more CPU on webcam frames] → MediaPipe GPU delegate already in use upstream with 2 hands; if frame drops appear, keep `numHands: 2` but skip skeleton rendering when the camera dock is hidden.
- [Step pairing from note-shaped events is ambiguous] → D2's additive payload field is the sanctioned fallback; decided at implementation after inspecting real `claude_task_update` payloads.
- [Dwell-click misfires on dense UI (model popover items)] → 300 ms dwell + reticle feedback matches upstream's tuned values; `data-no-gesture` escape hatch per D6.
- [Orb thinking-trigger heuristics fight Gemini VAD timing] → adopt upstream's exact timers first (they're field-tested); tune only if smoke shows false swirls.
- [Sounds annoy during long DEV runs] → mute toggle from day one (D5).

## Migration Plan

Renderer-only feature layer on top of the restructure; land as one branch, `npm run build` + smoke (gesture matrix + orb/timeline walkthrough in tasks.md). Rollback = revert; no persisted state besides the mute flag.

## Open Questions

- None blocking. (D2 payload-shape check and D6 opt-out list resolve at implementation.)
