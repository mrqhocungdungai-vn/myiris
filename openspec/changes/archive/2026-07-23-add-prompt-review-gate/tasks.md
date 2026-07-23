## 1. Mode flag (main.mjs) — modeled on `pipelineAvailable` (D5)

- [x] 1.1 Add module-level `promptReviewMode`, init from `envFlag("IRIS_PROMPT_REVIEW", true)`
- [x] 1.2 Add `setPromptReviewMode(enabled)` as the single choke point: update the flag, persist by writing `IRIS_PROMPT_REVIEW` (`"0"`/`"1"`) via `writeUserConfig`, and emit a `prompt_review_mode` sidecar event
- [x] 1.3 Add `IRIS_PROMPT_REVIEW` to `ALLOWED_CONFIG_KEYS` (else the toggle silently no-ops) (review #6)
- [x] 1.4 Add IPC `prompt:status` getter returning `{ reviewMode }`; expose it and `resolvePromptReview` + `setPromptReviewMode` on `window.iris` in `preload.cjs`
- [x] 1.5 Read `IRIS_PROMPT_REVIEW_TIMEOUT_MS` (default 300000) via the existing env-budget pattern

## 2. Split submit + park (main.mjs) (D1)

- [x] 2.1 Refactor `submitClaudeTask` into `buildRun(params)` (workstream/role resolution + run object) and `dispatch(run)` (today's `runQueue.submit` + result shaping); auto mode = `dispatch(buildRun(params))`, byte-identical to today
- [x] 2.2 When `promptReviewMode` is on, park `{ task, urgency, agent, workstream_id }` (no run, no run_id) and return `{ status: "parked_for_review" }`
- [x] 2.3 Keep `!task.trim()` rejection ahead of the gate so an empty brief never parks

## 3. `PendingReview` singleton (main.mjs) — no slot coupling (D2)

- [x] 3.1 Add a `PendingReview` object mirroring `PendingQuestion`'s settle-once + `abandon`, but whose `raise`/`settle` do NOT call `runQueue.suspend/resume` (review #1)
- [x] 3.2 `raise` stores the parked brief, emits `SYSTEM_EVENT` (narration) + a `task_review` sidecar event for the UI, arms an `unref`'d timeout; supersede replaces the current pending brief
- [x] 3.3 `settle(outcome)` is a no-op if already settled; `clearTimeout`; used by approve, cancel, timeout, supersede, and reset
- [x] 3.4 Timeout → cancel (never auto-approve); on cancel/timeout inform the voice layer it expired/was not sent (D6)

## 4. Approve / cancel wiring (main.mjs) (D4, D6)

- [x] 4.1 Voice tool handler `respond_to_task_review({ decision })` and IPC `resolvePromptReview({ action, editedTask })` both funnel through `PendingReview.settle`; first-wins, second no-op
- [x] 4.2 Approve: validate `editedTask` (non-empty trimmed, length-capped) else fall back to the parked `task`; dispatch via `dispatch(buildRun({ ...parked, task: finalText }))` using the **parked `workstream_id`**, never `activeWorkstream()`; refuse if that workstream no longer exists (review #3, #9)
- [x] 4.3 Relay the true `runQueue.submit` outcome (`queued`/`started`/terminal) back through the approving channel
- [x] 4.4 Inject `SYSTEM_EVENT_TASK_REVIEW_RESOLVED` on any resolution so Gemini learns the outcome of a UI-driven approve/cancel/timeout (D6, review #5)
- [x] 4.5 Do NOT log `task`/`editedTask` (may contain secrets)

## 5. Reset cancellation (main.mjs) (D4)

- [x] 5.1 Cancel any pending review in the same three paths that call `PendingQuestion.abandon` (`createWorkstream`/`selectWorkstream`/`setWorkstreamCwd`) BEFORE the context changes

## 6. Gemini tools + prompt (main.mjs) (D3, D6, D8)

- [x] 6.1 Declare `respond_to_task_review` and `set_prompt_review_mode`, both gated on `pipelineAvailable` (in the same block as the other pipeline tools)
- [x] 6.2 Update `submit_claude_task`'s description + the system prompt: in review mode narrate a short summary + "full brief on screen" and wait; NEVER call `get_claude_task_status` on a parked brief (no run_id); distinguish `answer_po_question` (blocking PO question) from `respond_to_task_review` (parked brief) (review #2, #5)

## 7. Renderer — banner + toggle (App.tsx, HudShell.tsx) (D3, D7)

- [x] 7.1 Hold `pendingReview` + `reviewMode` state from `prompt:status` (mount) and the `task_review` / `prompt_review_mode` sidecar events
- [x] 7.2 Deck banner: brief in an editable textarea + Approve / Cancel → `window.iris.resolvePromptReview`; edited text sent as `editedTask`
- [x] 7.3 HUD banner: Approve / Cancel only (revise-by-voice), wrapped in `.hud-hit`, kept small so it doesn't blanket the click-through overlay
- [x] 7.4 When a PO question and a review are both pending, render the PO question with precedence and stack the review beneath (deck + HUD)
- [x] 7.5 Widen the keyboard guard to `if (pendingPoQuestion || pendingReview) return`
- [x] 7.6 PipelineBar mode toggle → `window.iris.setPromptReviewMode`; render only when `pipelineAvailable`

## 8. Config + docs

- [x] 8.1 Add `IRIS_PROMPT_REVIEW` (default 1; `=0` restores auto-send) and `IRIS_PROMPT_REVIEW_TIMEOUT_MS` (default 300000) to `.env.example` with one-line comments
- [x] 8.2 If an `editedTask` validator is extracted as a pure helper, add a unit test for it (non-empty trim, length cap)

## 9. Verification (mostly manual — main.mjs + renderer are out of the harness)

- [x] 9.1 Review-on: submit by voice → nothing runs, banner shows, Gemini speaks a summary; Approve → run starts and Gemini announces the real outcome
- [x] 9.2 Edit in the deck textarea then Approve → the edited text is what Claude receives; empty edit is refused
- [x] 9.3 Cancel and timeout never dispatch; Gemini is told it was not sent
- [x] 9.4 Park a PO brief for review while a DEV run holds the slot → the DEV run keeps the slot and its idle watchdog keeps running (D2)
- [x] 9.5 Approve after switching workstream is prevented by reset-cancel; a review never dispatches into the wrong cwd
- [x] 9.6 A pending PO question and a parked review coexist → PO question has precedence, review stacks beneath, both voice tools resolve the right item
- [x] 9.7 `IRIS_PROMPT_REVIEW=0` reproduces today's auto-send behavior byte-for-byte; toggle persists across restart
- [x] 9.8 `npm run build` passes; `npm run package:mac` launches with the banner + toggle working (HUD banner receives clicks via `.hud-hit`)

## 10. Spec and record

- [x] 10.1 `openspec validate add-prompt-review-gate` passes
- [x] 10.2 Commit plan: this is one feature but lands as coherent commits (flag+persistence; submit split+park+PendingReview; approve/cancel/reset wiring + tools/prompt; renderer banner+toggle). Do NOT squash unrelated concerns. Co-Authored-By trailer
- [x] 10.3 After archive, `pipeline-availability` living spec carries the two new tools in the chat-only roster; new `prompt-review-gate` capability is in `openspec/specs/`
