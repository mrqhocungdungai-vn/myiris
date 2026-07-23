## Why

Voice input → Gemini authors a `task` brief → `submit_claude_task` (`main.mjs:1766`) **immediately** `runQueue.submit`s it → the PO turn / DEV run starts and burns Claude tokens. There is no review step. When Gemini's brief is wrong or incomplete, the user only discovers it after tokens are already spent. There is no way to see, edit, or veto the brief before it is dispatched.

## What Changes

Add a **pre-dispatch review gate**: when review mode is on, a submitted brief is *parked* (zero tokens to Claude) and surfaced for the user to Approve, Edit, or Cancel — by voice or UI. Only Approve dispatches it through the existing `runQueue.submit` path.

- **Gate inside `submitClaudeTask`, before `runQueue.submit`.** `submitClaudeTask` is split into `buildRun(params)` + `dispatch(run)`. In **auto** mode, `dispatch` runs inline — behavior is byte-identical to today. In **review** mode, the brief is parked as `{ task, urgency, agent, workstream_id }` (no run, no `run_id` created yet) and the tool returns `parked_for_review` synchronously so Gemini narrates instead of announcing a start.
- **Applies to all roles** (PO, DEV, plain) under one flag.
- **Mode is a main-owned flag** `promptReviewMode`, modeled exactly like `pipelineAvailable`: initialized from `IRIS_PROMPT_REVIEW` (default on), flipped through a single `setPromptReviewMode()` choke point, read by the renderer via a `prompt:status` IPC getter at mount and a `prompt_review_mode` sidecar event on change. The user toggle persists by writing `IRIS_PROMPT_REVIEW` (`0`/`1`) to `~/.iris/.env` via `writeUserConfig` — so `IRIS_PROMPT_REVIEW` is both the default switch and the persisted override (it MUST be added to `ALLOWED_CONFIG_KEYS` or the toggle silently no-ops). Default on at fresh start; `IRIS_PROMPT_REVIEW=0` restores the old auto-send behavior.
- **A parked review is a separate `PendingReview` singleton** — it mirrors the `PendingQuestion` voice/UI settle-once relay but **never** calls `runQueue.suspend/resume`, because a parked review holds no execution slot (the slot may belong to an unrelated DEV run whose idle watchdog must not be paused). At most one review is pending; a new `submit_claude_task` supersedes the previous parked brief.
- **Approve / Edit / Cancel, voice + UI.** New Gemini tool `respond_to_task_review({ decision: "approve" | "cancel" })`; new IPC `window.iris.resolvePromptReview({ action, editedTask })`. First channel to resolve wins; the second is a no-op. Editing is a deck-only in-banner textarea (the edited text becomes the final brief and dispatches straight through `dispatch`, not back through Gemini); in the HUD the banner offers Approve / Cancel / revise-by-voice only. Revise-by-voice is Gemini re-calling `submit_claude_task`, which supersedes the parked brief.
- **Approve dispatches against the parked `workstream_id`** (never a re-read of `activeWorkstream()`), and relays the real `runQueue.submit` outcome (`queued` / `started` / a synchronous terminal rejection such as the DEV no-open-change gate), so voice and UI narrate the true result.
- **On resolution, a `SYSTEM_EVENT_TASK_REVIEW_RESOLVED` is injected** so Gemini learns the outcome of a UI-driven approve/cancel/timeout (it last heard `parked_for_review`).
- **Timeout → cancel, never auto-send.** Unanswered after `IRIS_PROMPT_REVIEW_TIMEOUT_MS` (default 300000) the review is cancelled and Gemini is told it expired. A pending review is **always** cancelled on session reset / workstream switch / project-folder change (wired into the same three paths that already abandon a pending PO question) — this is load-bearing for correctness, not tidiness, because it guarantees the parked `workstream_id` is still valid at approve time.
- **Coexistence with a pending PO question.** Because the gate sits before dispatch, a review can be parked while a PO turn is mid-question. Both may be live at once; the PO question takes visual and voice precedence (it is blocking a token-burning turn) and the review banner stacks beneath it. The renderer keyboard guard is widened to `pendingPoQuestion || pendingReview`, and the system prompt distinguishes `answer_po_question` from `respond_to_task_review`.

## Capabilities

### New Capabilities

- `prompt-review-gate`: a pre-dispatch, slot-independent gate that parks a Gemini-authored brief for user Approve/Edit/Cancel over a voice+UI settle-once relay, with a mode flag, supersede-on-resubmit, timeout→cancel, and cancel-on-reset — so no Claude tokens are spent on an unreviewed brief when review mode is on.

### Modified Capabilities

- `pipeline-availability`: **one MODIFIED requirement** — "Chat-only mode declares no Claude tools…" — the enumerated pipeline tool roster gains `respond_to_task_review` and `set_prompt_review_mode`, which (like every other pipeline tool) are declared only when `pipelineAvailable`. In chat-only mode there is no `submit_claude_task`, so the review gate is inert and its tools are absent.

## Impact

- `electron/main.mjs` — split `submitClaudeTask` into `buildRun`/`dispatch`; add `promptReviewMode` flag + `setPromptReviewMode()` + `PendingReview` singleton (mirrors `PendingQuestion`, no `suspend/resume`); park in `submitClaudeTask` when review-on; two new Gemini tools + declarations (gated on `pipelineAvailable`); `SYSTEM_EVENT_TASK_REVIEW_RESOLVED`; wire cancel into the three reset paths; add `IRIS_PROMPT_REVIEW` to `ALLOWED_CONFIG_KEYS`.
- `electron/preload.cjs` — `resolvePromptReview`, `getPromptStatus`, and the `prompt_review_mode` / `task_review` sidecar channels.
- `src/App.tsx` + `src/components/HudShell.tsx` — review banner (deck: editable textarea; HUD: Approve/Cancel/`.hud-hit`); the PipelineBar mode toggle; widen the keyboard guard.
- `.env.example` — `IRIS_PROMPT_REVIEW` (default 1) and `IRIS_PROMPT_REVIEW_TIMEOUT_MS` (default 300000).
- New capability spec `prompt-review-gate`; one MODIFIED requirement in `pipeline-availability`. `run-execution-queue` unchanged (the gate is entirely before submit). No new dependency, no data migration.
