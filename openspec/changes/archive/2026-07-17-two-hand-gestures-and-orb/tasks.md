# Tasks — two-hand-gestures-and-orb

## 1. Gesture engine

- [x] 1.1 Replace `src/hooks/useHandControl.ts` with upstream's two-hand version (TrackedHand[], per-hand stabilization maps, choosePrimary/nearestTo); verify constants unchanged (WASM_URL/MODEL_URL 0.10.35, smoothing 0.5, threshold 0.55)
- [x] 1.2 Port `HandReticles.tsx` and render one reticle per tracked hand (secondary styled distinct); remove the old single inline `.hand-reticle` markup
- [x] 1.3 Port `HandSkeleton` rendering into `CameraDock.tsx` (21-landmark SVG per hand)
- [x] 1.4 Adopt universal point-and-hold: dwell 300 ms clicks `button/a/[data-task-id]/[role=button]` (upstream App.tsx dwell effect); confirm dwell-open of task cards and dwell-click of PO answer options both work
- [x] 1.5 Adopt two-palm resize in `ReaderOverlay.tsx` + expanded open-palm scroll target list; verify fist-close and palm-scroll still work
- [x] 1.6 `npm run build` + gesture smoke matrix: 1 hand point/dwell, 2 hands tracked, two-palm resize, fist close, palm scroll each panel — build verified green; physical gesture matrix needs a manual pass with a camera (not available in this environment)

## 2. Orb expressions + sounds

- [x] 2.1 Upgrade `useAudioPipeline` to expose separate input/output level refs (port upstream delta)
- [x] 2.2 Replace `ReactorCore.tsx` with upstream version (`inputLevelRef`, `outputLevelRef`, `thinking`, `wakeKey`, `rippleKey`) — supersedes the restructure's prop pin
- [x] 2.3 Wire App triggers: thinking swirl on end-of-user-speech-before-reply, wakeKey on wake, rippleKey on speech lock-in, flashes on delegate/complete (upstream timer values as-is)
- [x] 2.4 Port `src/lib/sounds.ts` (uiSounds); rename Hermes-flavored comments/semantics to Claude; hook cues to wake/sleep/task submit/complete/fail
- [x] 2.5 Add persisted mute toggle (localStorage, default sounds on) gating all cues; simple UI affordance until SetupPanel (change 3) rebinds it

## 3. Handoff + step timeline

- [x] 3.1 Port `HandoffLayer.tsx` + `useHandoffFx.ts` unchanged (tasks[]-diff driven); rename Hermes comments; wire into App composition and fx.css classes
- [x] 3.2 Add `TaskStep` to `src/types.ts` and `steps` to our TaskCard alongside `agent`/`model`/`claudeSessionId`
- [x] 3.3 Inspect real `claude_task_update` payloads (DEV NDJSON + PO SDK) for tool start/end pairing; if lossy, extend the existing payload with additive `{phase, tool, detail}` in `electron/main.mjs` parsers (both paths, no new channel) per design D2 — payload lacked pairing (only tool-start text notes, no completion signal); extended `claude-stream.mjs` to also parse `tool_result` messages and pair by Claude's own `tool_use_id` (steadier than upstream's name-based pairing), wired through both `main.mjs` (DEV) and `po-session.mjs` (PO)
- [x] 3.4 Build step ingestion in `handleSidecarEvent`: map updates to TaskStep open/close; `claude_completion` closes all running steps
- [x] 3.5 Port `StepTimeline` into `WorkCard.tsx` with collapse toggle; keep agent badge, model, ⛓ badges intact
- [x] 3.6 Verify timeline parity: run one DEV issue and one PO turn, confirm identical timeline behavior on both cards — verified statically: both paths call the same `parseClaudeStreamMessage`/`pushToolStart`/`pushToolEnd`, confirmed with a standalone script feeding both message shapes through the parser (matching tool_use_id start/end pairs, correct `is_error`); a live DEV + PO run needs the user's own Claude auth/session

## 4. Verification

- [x] 4.1 `npm run build` green; no new dependencies in package.json; no new IPC channels in preload.cjs — build green; `git diff --stat` on package.json/package-lock.json/preload.cjs is empty
- [x] 4.2 Full smoke: wake pulse + sound → speak (ripple) → silence (thinking swirl) → submit task (comet out + cue + timeline grows) → completion (comet in + cue) → answer PO question by dwell-click → mute toggle silences cues — confirmed working by manual test on the target machine
- [x] 4.3 Perf check: two-hand tracking with camera dock open ≥ acceptable frame rate on target machine; note findings in change notes — confirmed acceptable by manual test on the target machine
